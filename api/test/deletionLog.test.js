// Löschprotokoll (UC13, nur Admin): Zeitraumfilter, Rechte, keine personenbezogenen Felder.
// Eigene Protokollzeilen (Löschzeitpunkt 2001) werden direkt angelegt und am Ende entfernt.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { pool, query } from '../src/db.js';
import {
  ADMIN_EMAIL, cleanupSessions, login, publishedJobId, removeDeletionLogRowsAfter, testEnv,
} from './helpers.js';

const app = createApp(testEnv());
const ENTRY_KEYS = ['attachments_removed', 'closed_at', 'deleted_at', 'id', 'job_id', 'job_title',
  'stage_at_deletion', 'stage_label'];
let logBefore;
let jobId;
let ids;
let admin;

before(async () => {
  logBefore = (await query('SELECT coalesce(max(id), 0) AS id FROM deletion_log')).rows[0].id;
  jobId = await publishedJobId();
  const { rows } = await query(
    `INSERT INTO deletion_log (job_id, stage_at_deletion, closed_at, deleted_at, attachments_removed)
     VALUES ($1, 'rejected',  '2000-07-01 09:00+00', '2001-01-15 10:00+00', 1),
            ($1, 'withdrawn', '2000-08-01 09:00+00', '2001-03-01 00:00+00', 0)
     RETURNING id`,
    [jobId],
  );
  ids = rows.map((r) => r.id);
  admin = await login(app, ADMIN_EMAIL);
});

after(async () => {
  await removeDeletionLogRowsAfter(logBefore);
  await cleanupSessions();
  await app.locals.sessionStore.close();
  await pool.end();
});

const get = (query_) => admin.agent.get(`/api/admin/deletion-log${query_}`);
const idsIn = (res) => res.body.entries.map((e) => e.id).filter((id) => ids.includes(id));

test('Recruiter → 403, Admin → 200', async () => {
  const recruiter = await login(app);
  assert.equal((await recruiter.agent.get('/api/admin/deletion-log')).status, 403);
  assert.equal((await get('')).status, 200);
});

test('Einträge enthalten nur Felder ohne Personenbezug (keine Namen, E-Mail, Telefon, Token, Anschreiben)', async () => {
  const res = await get('?from=2001-01-01&to=2001-12-31');
  assert.equal(res.status, 200);
  assert.equal(res.body.entries.length, 2);
  for (const e of res.body.entries) assert.deepEqual(Object.keys(e).sort(), ENTRY_KEYS);
  assert.ok(!res.text.includes('@'), 'keine E-Mail-Adresse');
  const first = res.body.entries.find((e) => e.id === ids[0]);
  assert.equal(first.stage_label, 'Abgelehnt');
  assert.equal(first.job_id, jobId);
  assert.ok(first.job_title);
});

test('Zeitraumfilter (UTC, Grenzen einschließlich), neueste zuerst', async () => {
  assert.deepEqual(idsIn(await get('?from=2001-01-01&to=2001-01-31')), [ids[0]]);
  assert.deepEqual(idsIn(await get('?from=2001-01-15&to=2001-01-15')), [ids[0]], 'Tag des Löschens eingeschlossen');
  assert.deepEqual(idsIn(await get('?from=2001-01-16&to=2001-02-28')), []);
  assert.deepEqual(idsIn(await get('?from=2001-03-01')), [ids[1]]);
  assert.deepEqual(idsIn(await get('?to=2001-02-28')), [ids[0]]);
  assert.deepEqual(idsIn(await get('')), [ids[1], ids[0]], 'ohne Filter alle, neueste zuerst');
});

test('Ungültige Filter → 400 mit deutscher Meldung', async () => {
  for (const [q, field] of [['?from=2001-02-30', 'from'], ['?from=15.01.2001', 'from'],
    ['?from=2001-03-01&to=2001-01-01', 'to'], ['?name=x', 'name']]) {
    const res = await get(q);
    assert.equal(res.status, 400, q);
    assert.equal(res.body.error.details[0].field, field, q);
  }
});
