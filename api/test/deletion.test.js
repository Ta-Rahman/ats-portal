// Löschlauf (P5 Regel 4) Ende-zu-Ende: echte hochgeladene Datei, fehlende Datei, verwaiste Dateien,
// Sperre gegen parallele Läufe, CLI als eigener Prozess, Zeitplan.
// Die Testbewerbungen bekommen einen Abschluss im Jahr 1999 und werden mit Stichtag 2000-01-01
// gelöscht – Seed-Bewerbungen (Fristen ab 2026) werden dabei nie erfasst. Eigene Zeilen im
// Löschprotokoll (id > Stand vor den Tests) und eigene Dateien werden am Ende entfernt.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { stat, unlink, utimes, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import pg from 'pg';
import { createApp } from '../src/app.js';
import { pool, query } from '../src/db.js';
import { formatSummary, runDeletion } from '../src/services/deletion.service.js';
import { msUntilNext } from '../src/scheduler.js';
import {
  RECRUITER_EMAIL, cleanup, cleanupSessions, closedTestApplication, findApplicationByToken, postApplication,
  publishedJobId, removeDeletionLogRowsAfter, seedUserId, testEnv, uploadPath, validFields,
} from './helpers.js';

const run = promisify(execFile);
const app = createApp(testEnv());
const CUTOFF = new Date('2000-01-01T00:00:00Z');
const GRACE = 3600;
const OLD = new Date(Date.now() - 2 * GRACE * 1000); // älter als die Schonfrist

let jobId;
let logBefore;
let seedApplications;
const extraFiles = new Set(); // von Tests direkt angelegte Dateien (verwaist bzw. ohne UUID-Namen)

const countSeedApplications = async () =>
  (await query(`SELECT count(*)::int AS n FROM application WHERE email NOT LIKE '%@api-test.invalid'`)).rows[0].n;

const newLogRows = async () =>
  (await query('SELECT * FROM deletion_log WHERE id > $1 ORDER BY id', [logBefore])).rows;

const exists = (name) => stat(uploadPath(name)).then(() => true, (err) => {
  if (err.code === 'ENOENT') return false;
  throw err;
});

// Abgeschlossene Testbewerbung (über die API mit Lebenslauf) mit Abschluss 1999 → fällig zum Stichtag.
async function dueApplication(stage = 'withdrawn') {
  const { token } = await closedTestApplication(app, jobId, stage);
  await query(
    `UPDATE application SET closed_at = '1999-01-01', delete_after = retention_deadline('1999-01-01')
      WHERE access_token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')`,
    [token],
  );
  return findApplicationByToken(token);
}

async function extraFile(name, mtime) {
  await writeFile(uploadPath(name), '%PDF-1.4 Testdatei\n');
  if (mtime) await utimes(uploadPath(name), mtime, mtime);
  extraFiles.add(name);
}

before(async () => {
  await cleanup();
  jobId = await publishedJobId();
  logBefore = (await query('SELECT coalesce(max(id), 0) AS id FROM deletion_log')).rows[0].id;
  seedApplications = await countSeedApplications();
});

afterEach(async () => {
  await cleanup();
  for (const name of extraFiles) await unlink(uploadPath(name)).catch(() => {});
  extraFiles.clear();
  await removeDeletionLogRowsAfter(logBefore);
  assert.equal(await countSeedApplications(), seedApplications, 'Seed-Bewerbungen unverändert');
});

after(async () => {
  await cleanupSessions();
  await app.locals.sessionStore.close();
  await pool.end();
});

test('Fällige Bewerbung mit echter Datei: Datei, Bewerbung, Notiz, Historie weg; eine Protokollzeile', async () => {
  const due = await dueApplication('rejected');
  await query(`INSERT INTO note (application_id, author_id, body) VALUES ($1, $2, 'Notiz zum Löschtest')`,
    [due.id, await seedUserId(RECRUITER_EMAIL)]);
  assert.ok(await exists(due.storage_key), 'Datei liegt vor dem Lauf im Volume');

  const summary = await runDeletion({ cutoff: CUTOFF, orphanGraceSeconds: GRACE });
  assert.equal(summary.skipped, false);
  assert.equal(summary.applications, 1);
  assert.equal(summary.files, 1);
  assert.equal(summary.filesRemoved, 1);
  assert.equal(summary.filesMissing, 0);
  assert.equal(summary.errors, 0);
  console.log(formatSummary(summary));

  assert.equal(await exists(due.storage_key), false, 'Datei entfernt');
  for (const table of ['application', 'attachment', 'note', 'status_history']) {
    const column = table === 'application' ? 'id' : 'application_id';
    const { rows } = await query(`SELECT count(*)::int AS n FROM ${table} WHERE ${column} = $1`, [due.id]);
    assert.equal(rows[0].n, 0, table);
  }
  const log = await newLogRows();
  assert.equal(log.length, 1);
  assert.deepEqual(
    { job_id: log[0].job_id, stage: log[0].stage_at_deletion, files: log[0].attachments_removed },
    { job_id: jobId, stage: 'rejected', files: 1 },
  );
  assert.equal(log[0].closed_at.toISOString(), '1999-01-01T00:00:00.000Z');
  assert.deepEqual(Object.keys(log[0]).sort(),
    ['attachments_removed', 'closed_at', 'deleted_at', 'id', 'job_id', 'stage_at_deletion']);

  const again = await runDeletion({ cutoff: CUTOFF, orphanGraceSeconds: GRACE });
  assert.equal(again.applications, 0, 'zweiter Lauf löscht nichts');
  assert.equal((await newLogRows()).length, 1);
});

test('Fehlende Datei wird gezählt, ist kein Fehler; Protokollzeile entsteht trotzdem', async () => {
  const due = await dueApplication();
  await unlink(uploadPath(due.storage_key));
  const summary = await runDeletion({ cutoff: CUTOFF, orphanGraceSeconds: GRACE });
  assert.equal(summary.applications, 1);
  assert.equal(summary.filesRemoved, 0);
  assert.equal(summary.filesMissing, 1);
  assert.equal(summary.errors, 0);
  const log = await newLogRows();
  assert.equal(log.length, 1);
  assert.equal(log[0].attachments_removed, 1);
});

test('Nicht fällige und laufende Bewerbungen bleiben samt Datei erhalten', async () => {
  const closedRecently = await findApplicationByToken((await closedTestApplication(app, jobId, 'hired')).token);
  const open = await postApplication(app, jobId, validFields());
  const openRow = await findApplicationByToken(open.body.token);
  const summary = await runDeletion({ cutoff: CUTOFF, orphanGraceSeconds: GRACE });
  assert.equal(summary.applications, 0);
  for (const row of [closedRecently, openRow]) {
    assert.ok((await query('SELECT 1 FROM application WHERE id = $1', [row.id])).rowCount === 1);
    assert.ok(await exists(row.storage_key));
  }
});

test('Verwaiste Dateien: alte entfernt, junge behalten, Dateien mit Anhang-Zeile und fremde Namen unberührt', async () => {
  const oldOrphan = randomUUID();
  const freshOrphan = randomUUID();
  await extraFile(oldOrphan, OLD);
  await extraFile(freshOrphan);
  await extraFile('notiz.txt', OLD); // kein storage_key-Format → wird nie angefasst
  const open = await postApplication(app, jobId, validFields());
  const referenced = (await findApplicationByToken(open.body.token)).storage_key;
  await utimes(uploadPath(referenced), OLD, OLD); // alt, aber mit Anhang-Zeile

  const summary = await runDeletion({ cutoff: CUTOFF, orphanGraceSeconds: GRACE });
  console.log(formatSummary(summary));
  assert.equal(summary.orphansRemoved, 1);
  assert.equal(summary.orphansKept, 1);
  assert.equal(await exists(oldOrphan), false, 'alte verwaiste Datei entfernt');
  assert.equal(await exists(freshOrphan), true, 'junge verwaiste Datei (laufender Upload) behalten');
  assert.equal(await exists(referenced), true, 'Datei mit Anhang-Zeile behalten');
  assert.equal(await exists('notiz.txt'), true, 'Datei ohne UUID-Namen unberührt');
});

test('Sperre: Hält ein anderer Lauf die Sperre, wird übersprungen; danach läuft der Lauf normal', async () => {
  const due = await dueApplication();
  const other = new pg.Client();
  await other.connect();
  try {
    await other.query(`SELECT pg_advisory_lock(hashtext('ats-loeschlauf'))`);
    const skipped = await runDeletion({ cutoff: CUTOFF, orphanGraceSeconds: GRACE });
    assert.equal(skipped.skipped, true);
    assert.match(formatSummary(skipped), /übersprungen/);
    assert.equal((await query('SELECT 1 FROM application WHERE id = $1', [due.id])).rowCount, 1, 'nichts gelöscht');
    await other.query(`SELECT pg_advisory_unlock(hashtext('ats-loeschlauf'))`);
  } finally {
    await other.end();
  }
  const done = await runDeletion({ cutoff: CUTOFF, orphanGraceSeconds: GRACE });
  assert.equal(done.applications, 1);
});

test('Zwei gleichzeitige Läufe löschen jede Bewerbung genau einmal (eine Protokollzeile je Bewerbung)', async () => {
  await dueApplication();
  await dueApplication('hired');
  const results = await Promise.all([
    runDeletion({ cutoff: CUTOFF, orphanGraceSeconds: GRACE }),
    runDeletion({ cutoff: CUTOFF, orphanGraceSeconds: GRACE }),
  ]);
  const deleted = results.reduce((n, r) => n + (r.applications ?? 0), 0);
  assert.equal(deleted, 2);
  assert.equal((await newLogRows()).length, 2);
  console.log(`Parallele Läufe: ${results.map((r) => (r.skipped ? 'übersprungen' : `${r.applications} gelöscht`)).join(' / ')}`);
});

test('Stichtag in der Zukunft → Fehler AT009, nichts gelöscht', async () => {
  const due = await dueApplication();
  await assert.rejects(
    runDeletion({ cutoff: new Date(Date.now() + 60_000), orphanGraceSeconds: GRACE }),
    (err) => err.code === 'AT009',
  );
  assert.equal((await query('SELECT 1 FROM application WHERE id = $1', [due.id])).rowCount, 1);
});

test('CLI als eigener Prozess: --stichtag 2000-01-01 → Exit 0 mit Zusammenfassung; Zukunft → Exit 1', async () => {
  const due = await dueApplication();
  const cli = ['src/cli/loeschlauf.js', '--stichtag', '2000-01-01'];
  const first = await run(process.execPath, cli);
  console.log(first.stdout.trim());
  assert.match(first.stdout, /Stichtag 2000-01-01T00:00:00\.000Z: 1 Bewerbung gelöscht, 1 von 1 Dateien entfernt, 0 fehlten/);
  assert.equal(await exists(due.storage_key), false);
  const second = await run(process.execPath, cli);
  assert.match(second.stdout, /: 0 Bewerbungen gelöscht/);

  await assert.rejects(run(process.execPath, ['src/cli/loeschlauf.js', '--stichtag', '2999-01-01']), (err) => {
    assert.equal(err.code, 1);
    assert.match(err.stderr, /Stichtag liegt in der Zukunft/);
    return true;
  });
  await assert.rejects(run(process.execPath, ['src/cli/loeschlauf.js', '--stichtag', '2000-02-30']),
    (err) => err.code === 1);
});

test('Zeitplan: nächster Lauf zur eingestellten Uhrzeit (UTC), heute oder morgen', () => {
  const at = (iso) => Date.parse(iso);
  const h = 60 * 60 * 1000;
  assert.equal(msUntilNext('03:30', at('2026-11-11T01:00:00Z')), 2.5 * h);
  assert.equal(msUntilNext('03:30', at('2026-11-11T04:00:00Z')), 23.5 * h);
  assert.equal(msUntilNext('03:30', at('2026-11-11T03:30:00Z')), 24 * h);
  assert.equal(msUntilNext('00:00', at('2026-12-31T23:59:00Z')), 60 * 1000);
});
