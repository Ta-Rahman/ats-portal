// Tests des Webservers (nginx im web-Container) von außen, wie ein Browser ihn sieht.
// Laufen auf dem Host gegen die gestartete Umgebung (npm run test:web), nicht im Container –
// das Zugriffsprotokoll von nginx ist nur über `docker compose logs web` sichtbar.
// Basis-URL: WEB_TEST_URL oder http://127.0.0.1:<WEB_HOST_PORT|8090>.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = process.env.WEB_TEST_URL ?? `http://127.0.0.1:${process.env.WEB_HOST_PORT ?? 8090}`;

// Policy der SPA aus web/nginx.conf und der API aus api/src/app.js (helmet)
const SPA_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; "
  + "connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
const API_CSP = "default-src 'none';frame-ancestors 'none';base-uri 'none';form-action 'none'";

// fetch fasst mehrfach gesendete Header mit ", " zusammen – ein zweiter CSP-Header fiele so auf.
const csp = (res) => res.headers.get('content-security-policy');

async function assetPaths() {
  const html = await (await fetch(`${BASE}/`)).text();
  const paths = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(paths.some((p) => p.endsWith('.js')), 'index.html verweist auf ein JS-Bundle');
  assert.ok(paths.some((p) => p.endsWith('.css')), 'index.html verweist auf eine CSS-Datei');
  return paths;
}

test('CSP der SPA auf allen Seiten und Dateien, ohne unsafe-inline/unsafe-eval', async () => {
  const pages = ['/', '/stellen', '/stellen/1', '/stellen/1/bewerben', '/status/abc', '/intern/anmelden',
    '/intern/stellen', '/gibt-es-nicht'];
  for (const p of [...pages, ...(await assetPaths())]) {
    const res = await fetch(`${BASE}${p}`);
    assert.equal(res.status, 200, `${p}: Status`);
    assert.equal(csp(res), SPA_CSP, `${p}: CSP`);
    assert.doesNotMatch(csp(res), /unsafe-inline|unsafe-eval|data:/, `${p}: unsichere Quelle`);
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer', `${p}: Referrer-Policy`);
  }
});

// Dateien aus web/public/ (Iteration 6). Fehlt eine Datei, liefert try_files index.html mit Status 200 –
// daher zusätzlich der Content-Type.
const PUBLIC_FILES = [
  ['/fonts/geist-latin-wght-normal.woff2', 'font/woff2'],
  ['/marke/lockup-horizontal.svg', 'image/svg+xml'],
  ['/favicon.svg', 'image/svg+xml'],
];

test('Selbst gehostete Dateien (Schrift, Logo, Favicon): Status 200, CSP und Content-Type', async () => {
  for (const [p, type] of PUBLIC_FILES) {
    const res = await fetch(`${BASE}${p}`);
    assert.equal(res.status, 200, `${p}: Status`);
    assert.equal(res.headers.get('content-type'), type, `${p}: Content-Type`);
    assert.equal(csp(res), SPA_CSP, `${p}: CSP`);
  }
});

test('index.html enthält kein Inline-Skript und keinen Inline-Stil', async () => {
  const html = await (await fetch(`${BASE}/`)).text();
  assert.equal([...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/g)].length, 0, 'Inline-<script>');
  assert.equal([...html.matchAll(/<style\b/g)].length, 0, '<style>-Block');
  assert.equal([...html.matchAll(/\sstyle=/g)].length, 0, 'style-Attribut');
});

test('API-Antworten über nginx: genau eine CSP, die der API', async () => {
  for (const p of ['/api/jobs', '/api/jobs/abc', '/api/status/abc', '/api/gibt-es-nicht']) {
    const res = await fetch(`${BASE}${p}`);
    assert.equal(csp(res), API_CSP, `${p}: CSP`);
    assert.equal(res.headers.get('x-frame-options'), 'DENY', `${p}: X-Frame-Options`);
  }
});

// --- Zugriffsprotokoll von nginx (stdout des web-Containers) ---------------------------------

function webLogSince(since) {
  const r = spawnSync('docker', ['compose', 'logs', 'web', '--no-log-prefix', '--since', since],
    { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, `docker compose logs: ${r.stderr}`);
  return r.stdout + r.stderr; // nginx schreibt das Zugriffsprotokoll auf stdout
}
const count = (text, needle) => text.split(needle).length - 1;

test('Zugriffsprotokoll: kein Token und kein Query-String (Status-Routen und übrige Routen)', async () => {
  const since = new Date(Date.now() - 2000).toISOString();
  const token = randomBytes(32).toString('base64url'); // Format eines echten Tokens, unbekannt → 404
  const values = Array.from({ length: 4 }, () => `wert${randomBytes(6).toString('hex')}`);
  for (const p of [`/status/${token}?ref=${values[0]}`, `/api/status/${token}?ref=${values[1]}`,
    `/api/status/${token}/withdraw?ref=${values[2]}`, `/api/jobs?location=${values[3]}`]) {
    await fetch(`${BASE}${p}`, { method: p.includes('/withdraw') ? 'POST' : 'GET' });
  }
  // Gegenprobe zuerst: Die Anfragen müssen im Protokoll angekommen sein (maskiert).
  let log = '';
  for (let i = 0; i < 20 && count(log, '/status/[token]') < 3; i += 1) {
    await new Promise((r) => setTimeout(r, 250));
    log = webLogSince(since);
  }
  assert.ok(count(log, '/status/[token]') >= 3, 'maskierte Status-Zeilen im Protokoll');
  assert.ok(log.includes('"GET /api/jobs HTTP/1.1"'), 'Stellenliste ohne Query im Protokoll');
  assert.equal(count(log, token), 0, 'Token im Zugriffsprotokoll');
  for (const v of values) assert.equal(count(log, v), 0, `Query-Wert ${v} im Zugriffsprotokoll`);
});
