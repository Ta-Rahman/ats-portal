// Integrationstests: Stellenverwaltung (UC6) – /api/admin/jobs.
// Teststellen heißen "API-Test …" und werden samt Testbewerbungen nach jedem Test entfernt.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool, query } from '../src/db.js';
import {
  RECRUITER_EMAIL, TEST_JOB_PREFIX, cleanupJobs, cleanupSessions, login, postApplication, seedUserId,
  testEnv, validFields,
} from './helpers.js';

const app = createApp(testEnv());
let agent;
let csrf;

before(async () => {
  await cleanupJobs();
  ({ agent, csrf } = await login(app));
});

afterEach(cleanupJobs);

after(async () => {
  await cleanupJobs();
  await cleanupSessions();
  await app.locals.sessionStore.close();
  await pool.end();
});

const send = (method, path, body) => agent[method](`/api/admin${path}`).set('X-CSRF-Token', csrf).send(body);

function jobBody(overrides = {}) {
  return {
    title: `${TEST_JOB_PREFIX}Stelle`,
    location: 'Teststadt',
    employment_type: 'part_time',
    description: 'Beschreibung der Teststelle.\n\nZweiter Absatz.',
    ...overrides,
  };
}

async function createJob(overrides) {
  const res = await send('post', '/jobs', jobBody(overrides));
  assert.equal(res.status, 201, res.text);
  return res.body.job;
}

async function dbJob(id) {
  return (await query('SELECT * FROM job WHERE id = $1', [id])).rows[0];
}

// --- Anlegen und Bearbeiten -------------------------------------------------------------------

test('Anlegen → 201, immer als Entwurf, angelegt von der angemeldeten Person', async () => {
  const job = await createJob();
  assert.equal(job.status, 'draft');
  assert.equal(job.published_at, null);
  assert.equal(job.closed_at, null);
  assert.equal(job.created_by_name, 'Tom Muster (Recruiting)');
  assert.equal(job.description, jobBody().description);
  const row = await dbJob(job.id);
  assert.equal(row.created_by, await seedUserId(RECRUITER_EMAIL));
});

test('Anlegen mit Feld "status" → 400 (Status nur über Veröffentlichen/Schließen)', async () => {
  const res = await send('post', '/jobs', jobBody({ status: 'published' }));
  assert.equal(res.status, 400);
  assert.equal(res.body.error.details[0].field, 'status');
});

test('Anlegen mit ungültigen Feldern → 400 mit deutscher Meldung je Feld', async () => {
  const res = await send('post', '/jobs', { title: 'ab', employment_type: 'mini_job' });
  assert.equal(res.status, 400);
  const byField = Object.fromEntries(res.body.error.details.map((d) => [d.field, d.message]));
  assert.deepEqual(byField, {
    title: 'Der Titel muss mindestens 3 Zeichen lang sein.',
    location: 'Bitte geben Sie einen Ort an.',
    employment_type: 'Bitte wählen Sie eine gültige Beschäftigungsart.',
    description: 'Bitte geben Sie eine Beschreibung an.',
  });
});

test('Entwurf ist nicht öffentlich: Detail 404, Bewerbung 404', async () => {
  const job = await createJob();
  assert.equal((await request(app).get(`/api/jobs/${job.id}`)).status, 404);
  assert.equal((await postApplication(app, job.id, validFields())).status, 404);
});

test('Bearbeiten: nur die übergebenen Felder ändern sich (Entwurf und veröffentlicht)', async () => {
  const job = await createJob();
  const res = await send('patch', `/jobs/${job.id}`, { location: 'Anderer Ort' });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.job.location, 'Anderer Ort');
  assert.equal(res.body.job.title, job.title);
  assert.equal((await send('post', `/jobs/${job.id}/publish`)).status, 200);
  const res2 = await send('patch', `/jobs/${job.id}`, { title: `${TEST_JOB_PREFIX}Neuer Titel` });
  assert.equal(res2.status, 200);
  assert.equal(res2.body.job.title, `${TEST_JOB_PREFIX}Neuer Titel`);
});

test('Bearbeiten ohne Felder bzw. mit unbekanntem Feld → 400', async () => {
  const job = await createJob();
  const empty = await send('patch', `/jobs/${job.id}`, {});
  assert.equal(empty.status, 400);
  assert.equal(empty.body.error.details[0].message, 'Bitte ändern Sie mindestens ein Feld.');
  assert.equal((await send('patch', `/jobs/${job.id}`, { created_by: 1 })).status, 400);
});

// --- Lebenszyklus -----------------------------------------------------------------------------

test('Lebenszyklus Entwurf → veröffentlicht → geschlossen mit öffentlicher Sichtbarkeit und Bewerbungen', async () => {
  const job = await createJob();

  const published = await send('post', `/jobs/${job.id}/publish`);
  assert.equal(published.status, 200, published.text);
  assert.equal(published.body.job.status, 'published');
  assert.ok(Math.abs(Date.now() - new Date(published.body.job.published_at).getTime()) < 60_000);
  const list = await request(app).get('/api/jobs');
  assert.ok(list.body.jobs.some((j) => j.id === job.id), 'neue Stelle erscheint in der öffentlichen Liste');
  assert.equal((await request(app).get(`/api/jobs/${job.id}`)).status, 200);
  assert.equal((await postApplication(app, job.id, validFields())).status, 201, 'Bewerbung möglich');

  const closed = await send('post', `/jobs/${job.id}/close`);
  assert.equal(closed.status, 200, closed.text);
  assert.equal(closed.body.job.status, 'closed');
  assert.ok(closed.body.job.closed_at);
  const list2 = await request(app).get('/api/jobs');
  assert.ok(!list2.body.jobs.some((j) => j.id === job.id), 'geschlossene Stelle nicht mehr öffentlich');
  const apply = await postApplication(app, job.id, validFields());
  assert.equal(apply.status, 404, 'geschlossene Stelle nimmt keine Bewerbungen an');
  assert.equal(apply.body.error.message, 'Stelle nicht gefunden oder nicht mehr ausgeschrieben');
});

test('Unzulässige Statuswechsel → 409, Stelle unverändert', async () => {
  const job = await createJob();
  const closeDraft = await send('post', `/jobs/${job.id}/close`);
  assert.equal(closeDraft.status, 409);
  assert.deepEqual(closeDraft.body.error,
    { code: 'JOB_STATUS_CONFLICT', message: 'Nur eine veröffentlichte Stelle kann geschlossen werden.' });
  assert.equal((await dbJob(job.id)).status, 'draft');

  assert.equal((await send('post', `/jobs/${job.id}/publish`)).status, 200);
  const publishedAt = (await dbJob(job.id)).published_at;
  const again = await send('post', `/jobs/${job.id}/publish`);
  assert.equal(again.status, 409, 'zweites Veröffentlichen');
  assert.equal(again.body.error.message, 'Nur ein Entwurf kann veröffentlicht werden.');
  assert.deepEqual((await dbJob(job.id)).published_at, publishedAt, 'published_at unverändert');

  assert.equal((await send('post', `/jobs/${job.id}/close`)).status, 200);
  const closedRow = await dbJob(job.id);
  assert.equal((await send('post', `/jobs/${job.id}/publish`)).status, 409, 'geschlossene Stelle wieder öffnen');
  assert.equal((await send('post', `/jobs/${job.id}/close`)).status, 409, 'zweites Schließen');
  const after = await dbJob(job.id);
  assert.equal(after.status, 'closed');
  assert.deepEqual(after.closed_at, closedRow.closed_at);
});

test('Geschlossene Stelle ist nicht mehr bearbeitbar → 409', async () => {
  const job = await createJob();
  await send('post', `/jobs/${job.id}/publish`);
  await send('post', `/jobs/${job.id}/close`);
  const res = await send('patch', `/jobs/${job.id}`, { location: 'Neu' });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'JOB_CLOSED');
  assert.equal((await dbJob(job.id)).location, 'Teststadt');
});

test('Nicht vorhandene Stelle → 404 (lesen, bearbeiten, veröffentlichen, schließen); ungültige ID → 400', async () => {
  const id = 2147483647;
  assert.equal((await agent.get(`/api/admin/jobs/${id}`)).status, 404);
  assert.equal((await send('patch', `/jobs/${id}`, { location: 'x' })).status, 404);
  assert.equal((await send('post', `/jobs/${id}/publish`)).status, 404);
  assert.equal((await send('post', `/jobs/${id}/close`)).status, 404);
  assert.equal((await agent.get('/api/admin/jobs/abc')).status, 400);
});

// --- Liste ------------------------------------------------------------------------------------

test('Liste: alle Stellen jeden Status mit Anzahl der Bewerbungen je Stufe (gegen SQL geprüft)', async () => {
  const res = await agent.get('/api/admin/jobs');
  assert.equal(res.status, 200);
  const { rows } = await query(`SELECT j.id, j.status, a.stage, count(a.id)::int AS n
                                  FROM job j LEFT JOIN application a ON a.job_id = j.id
                                 GROUP BY j.id, j.status, a.stage`);
  const expected = {};
  for (const r of rows) {
    expected[r.id] ??= { status: r.status, counts: {}, total: 0 };
    if (r.stage) {
      expected[r.id].counts[r.stage] = r.n;
      expected[r.id].total += r.n;
    }
  }
  assert.equal(res.body.jobs.length, Object.keys(expected).length);
  for (const job of res.body.jobs) {
    assert.equal(job.status, expected[job.id].status);
    assert.deepEqual(job.stage_counts, expected[job.id].counts, `Stelle ${job.id}`);
    assert.equal(job.application_count, expected[job.id].total);
  }
  const statuses = new Set(res.body.jobs.map((j) => j.status));
  assert.deepEqual([...statuses].sort(), ['closed', 'draft', 'published']);
  assert.deepEqual(res.body.stages.map((s) => [s.code, s.label]), [
    ['received', 'Eingegangen'], ['screening', 'Sichtung'], ['interview', 'Interview'], ['offer', 'Angebot'],
    ['hired', 'Eingestellt'], ['rejected', 'Abgelehnt'], ['withdrawn', 'Zurückgezogen'],
  ]);
});
