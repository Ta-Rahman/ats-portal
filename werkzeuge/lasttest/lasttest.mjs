// Lasttest der öffentlichen Stellenliste (GET /api/jobs über nginx), ohne Abhängigkeiten.
//
// Ablauf je Lauf: n parallele Verbindungen (keep-alive, je Verbindung eine Anfrage nach der anderen)
// → Aufwärmphase (wird verworfen) → Messphase. Jede einzelne Antwortzeit wird gespeichert; p50/p90/
// p95/p99 werden exakt daraus berechnet (Rangverfahren: kleinster Wert, unter dem mindestens p %
// der Messungen liegen). Als Fehler zählt jede Antwort mit einem anderen Status als 200 sowie jeder
// Verbindungsfehler und jede Zeitüberschreitung (10 s).
//
// Soll (Bericht Kap. 3.4, bestätigt 11.11.2026): p95 ≤ 100 ms und 0 Fehler bei 20 parallelen
// Verbindungen – in jedem der drei Läufe.
//
// Aufruf (Stack läuft):  npm run lasttest            (schreibt nach docs/belege/iteration5/)
//   node werkzeuge/lasttest/lasttest.mjs [--url U] [--verbindungen 20] [--aufwaermen 5] [--dauer 30]
//                                        [--laeufe 3] [--pause 10] [--soll-p95 100] [--out ordner]
// Exit-Code: 0 = Soll in allen Läufen erfüllt, 2 = Soll verfehlt, 1 = Abbruch.
import http from 'node:http';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function args() {
  const defaults = {
    url: 'http://127.0.0.1:8090/api/jobs', verbindungen: 20, aufwaermen: 5, dauer: 30, laeufe: 3, pause: 10,
    'soll-p95': 100, out: null,
  };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    if (!(key in defaults)) throw new Error(`Unbekannte Option ${argv[i]}`);
    defaults[key] = typeof defaults[key] === 'number' ? Number(argv[i + 1]) : argv[i + 1];
  }
  return defaults;
}

const opt = args();
const target = new URL(opt.url);
const agent = new http.Agent({ keepAlive: true, maxSockets: opt.verbindungen });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Eine Anfrage; liefert { ms, status } oder { ms, error }
function once() {
  return new Promise((resolve) => {
    const start = process.hrtime.bigint();
    const done = (result) => resolve({ ms: Number(process.hrtime.bigint() - start) / 1e6, ...result });
    const req = http.get(target, { agent, timeout: 10_000 }, (res) => {
      res.resume(); // Body vollständig lesen, Zeit endet mit dem letzten Byte
      res.on('end', () => done({ status: res.statusCode, headers: res.headers }));
      res.on('error', (err) => done({ error: err.code ?? err.message }));
    });
    req.on('timeout', () => req.destroy(new Error('TIMEOUT')));
    req.on('error', (err) => done({ error: err.code ?? err.message }));
  });
}

// n Verbindungen arbeiten bis zum Zeitpunkt `until`; gesammelt wird nur, wenn `collect` gesetzt ist.
async function phase(seconds, collect) {
  const until = Date.now() + seconds * 1000;
  const latencies = [];
  const statuses = {};
  const errors = {};
  let first = null;
  async function worker() {
    while (Date.now() < until) {
      const r = await once();
      if (!collect) continue;
      first ??= r;
      latencies.push(r.ms);
      if (r.error) errors[r.error] = (errors[r.error] ?? 0) + 1;
      else statuses[r.status] = (statuses[r.status] ?? 0) + 1;
    }
  }
  const t0 = process.hrtime.bigint();
  await Promise.all(Array.from({ length: opt.verbindungen }, worker));
  const elapsed = Number(process.hrtime.bigint() - t0) / 1e9;
  return { latencies, statuses, errors, first, elapsed };
}

function percentile(sorted, p) {
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

const f = (ms) => `${ms.toFixed(1)} ms`;

function evaluate(run) {
  const sorted = Float64Array.from(run.latencies).sort();
  const total = sorted.length;
  const non200 = Object.entries(run.statuses).filter(([s]) => s !== '200').reduce((a, [, c]) => a + c, 0);
  const connErrors = Object.values(run.errors).reduce((a, c) => a + c, 0);
  return {
    total,
    rps: total / run.elapsed,
    p50: percentile(sorted, 50), p90: percentile(sorted, 90), p95: percentile(sorted, 95),
    p99: percentile(sorted, 99), max: sorted[total - 1], min: sorted[0],
    errors: non200 + connErrors, non200, connErrors,
  };
}

function report(nr, run, r) {
  const rateHeaders = Object.keys(run.first?.headers ?? {}).filter((h) => h.startsWith('ratelimit') || h === 'retry-after');
  const sollOk = r.p95 <= opt['soll-p95'] && r.errors === 0;
  return [
    `# Lasttest Lauf ${nr} – ${new Date().toISOString()}`,
    `Ziel: GET ${target.href} (über nginx)`,
    `Parallele Verbindungen: ${opt.verbindungen} (keep-alive) · Aufwärmen: ${opt.aufwaermen} s (verworfen) · `
      + `Messung: ${opt.dauer} s (tatsächlich ${run.elapsed.toFixed(2)} s)`,
    `Rate-Limit-Header in der ersten Antwort: ${rateHeaders.length ? rateHeaders.join(', ') : 'keine'}`,
    '',
    `Anfragen gesamt:   ${r.total}`,
    `Anfragen/s:        ${r.rps.toFixed(1)}`,
    `Antwortzeit min:   ${f(r.min)}`,
    `Antwortzeit p50:   ${f(r.p50)}`,
    `Antwortzeit p90:   ${f(r.p90)}`,
    `Antwortzeit p95:   ${f(r.p95)}`,
    `Antwortzeit p99:   ${f(r.p99)}`,
    `Antwortzeit max:   ${f(r.max)}`,
    `Statuscodes:       ${Object.entries(run.statuses).map(([s, c]) => `${s}: ${c}`).join(', ') || '–'}`,
    `Verbindungsfehler: ${Object.entries(run.errors).map(([e, c]) => `${e}: ${c}`).join(', ') || '0'}`,
    `Fehler gesamt:     ${r.errors} (Status ≠ 200: ${r.non200}, Verbindung/Zeitüberschreitung: ${r.connErrors})`,
    '',
    `Soll: p95 ≤ ${opt['soll-p95']} ms und 0 Fehler → ${sollOk ? 'erfüllt' : 'NICHT erfüllt'} `
      + `(p95 ${f(r.p95)}, Fehler ${r.errors})`,
    '',
  ].join('\n');
}

function sh(cmd, cmdArgs) {
  const r = spawnSync(cmd, cmdArgs, { cwd: REPO_ROOT, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : `(nicht ermittelbar: Exit ${r.status})`;
}

// Rechnerkontext ohne personenbezogene Angaben (kein Rechnername, kein Benutzername)
function context() {
  const cpus = os.cpus();
  const gib = (b) => `${(b / 1024 ** 3).toFixed(1)} GiB`;
  const dockerInfo = sh('docker', ['info', '--format',
    'Engine {{.ServerVersion}} · {{.OperatingSystem}} · Kernel {{.KernelVersion}} · CPUs {{.NCPU}}']);
  const dockerMem = Number(sh('docker', ['info', '--format', '{{.MemTotal}}']));
  const dockerPlatform = sh('docker', ['version', '--format', '{{.Server.Platform.Name}}']);
  const requestLog = sh('docker', ['compose', 'exec', '-T', 'api', 'printenv', 'REQUEST_LOG']);
  return [
    '# Rechnerkontext des Lasttests (ohne Rechner- und Benutzernamen)',
    `CPU: ${cpus[0]?.model?.trim()} · ${cpus.length} logische Prozessoren`,
    `Arbeitsspeicher: ${gib(os.totalmem())}`,
    `Betriebssystem: ${os.version()} (${os.type()} ${os.release()}, ${os.arch()})`,
    `Node.js (Lastgenerator): ${process.version}`,
    `Docker: ${dockerPlatform}`,
    `Docker-VM: ${dockerInfo} · Speicher ${Number.isFinite(dockerMem) ? gib(dockerMem) : '?'}`,
    'Container-Limits: keine in docker-compose.yml (alle Dienste teilen sich die Docker-VM)',
    `REQUEST_LOG im api-Container: ${requestLog} (Zugriffsprotokoll je Anfrage aktiv wie im Normalbetrieb)`,
    'Hinweis: Lastgenerator und Anwendung laufen auf demselben Rechner; Weg Host → Docker-Portweiterleitung → '
      + 'nginx → API → PostgreSQL.',
    '',
  ].join('\n');
}

const results = [];
try {
  const probe = await once();
  if (probe.error || probe.status !== 200) throw new Error(`Probeanfrage: ${probe.error ?? `HTTP ${probe.status}`}`);
  if (opt.out) {
    mkdirSync(opt.out, { recursive: true });
    writeFileSync(path.join(opt.out, 'lasttest_kontext.txt'), context());
  }
  for (let nr = 1; nr <= opt.laeufe; nr += 1) {
    if (nr > 1) await sleep(opt.pause * 1000);
    await phase(opt.aufwaermen, false);
    const run = await phase(opt.dauer, true);
    const r = evaluate(run);
    const text = report(nr, run, r);
    process.stdout.write(`${text}\n`);
    if (opt.out) writeFileSync(path.join(opt.out, `lasttest_lauf${nr}.txt`), text);
    results.push(r);
  }
} catch (err) {
  console.error(`Lasttest abgebrochen: ${err.message}`);
  process.exit(1);
} finally {
  agent.destroy();
}

const allOk = results.every((r) => r.p95 <= opt['soll-p95'] && r.errors === 0);
const summary = [
  '# Lasttest – Zusammenfassung',
  `GET ${target.pathname} · ${opt.verbindungen} Verbindungen · ${opt.dauer} s je Lauf · Soll p95 ≤ ${opt['soll-p95']} ms, 0 Fehler`,
  '| Lauf | Anfragen | Anfragen/s | p50 | p95 | max | Fehler | Soll |',
  '|---|---|---|---|---|---|---|---|',
  ...results.map((r, i) => `| ${i + 1} | ${r.total} | ${r.rps.toFixed(1)} | ${f(r.p50)} | ${f(r.p95)} | ${f(r.max)} | `
    + `${r.errors} | ${r.p95 <= opt['soll-p95'] && r.errors === 0 ? 'erfüllt' : 'NICHT erfüllt'} |`),
  '',
  `Soll in allen Läufen erfüllt: ${allOk ? 'ja' : 'nein'}`,
  '',
].join('\n');
process.stdout.write(summary);
if (opt.out) writeFileSync(path.join(opt.out, 'lasttest_zusammenfassung.txt'), summary);
process.exit(allOk ? 0 : 2);
