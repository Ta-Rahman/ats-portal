// Integrationstests der öffentlichen Stellen-Endpunkte gegen die geseedete Datenbank.
// Nur lesend. Erwartungswerte werden aus der Datenbank ermittelt und zusätzlich gegen die
// feste Zahl aus dem Seed (db/init/04_seed.sql) geprüft.
// Aufruf: docker compose exec -T api npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool, query } from '../src/db.js';
import { testEnv } from './helpers.js';

const app = createApp(testEnv());
const SEED_PUBLISHED_COUNT = 5; // 04_seed.sql: 5 veröffentlicht, 1 Entwurf, 2 geschlossen

let publishedIds;
let draftId;
let closedId;

async function ids(sql, params = []) {
  const { rows } = await query(sql, params);
  return rows.map((r) => r.id);
}

before(async () => {
  publishedIds = await ids(`SELECT id FROM job WHERE status = 'published' ORDER BY id`);
  [draftId] = await ids(`SELECT id FROM job WHERE status = 'draft' ORDER BY id LIMIT 1`);
  [closedId] = await ids(`SELECT id FROM job WHERE status = 'closed' ORDER BY id LIMIT 1`);
});

after(() => pool.end());

const sortedIds = (jobs) => jobs.map((j) => j.id).sort((a, b) => a - b);

function assertValidationError(res, field) {
  assert.equal(res.status, 400);
  assert.match(res.headers['content-type'], /application\/json/);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  assert.ok(res.body.error.details.some((d) => d.field === field), `Detail für Feld ${field} fehlt`);
}

// --- GET /api/jobs ---------------------------------------------------------------------------

test('Liste liefert genau die veröffentlichten Stellen (Seed: 5)', async () => {
  const res = await request(app).get('/api/jobs');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /application\/json/);
  assert.equal(publishedIds.length, SEED_PUBLISHED_COUNT);
  assert.equal(res.body.jobs.length, SEED_PUBLISHED_COUNT);
  assert.deepEqual(sortedIds(res.body.jobs), publishedIds);
  assert.ok(!res.body.jobs.some((j) => j.id === draftId || j.id === closedId));
});

test('Liste ist nach Veröffentlichungsdatum absteigend sortiert', async () => {
  const res = await request(app).get('/api/jobs');
  const dates = res.body.jobs.map((j) => Date.parse(j.published_at));
  assert.deepEqual(dates, [...dates].sort((a, b) => b - a));
});

test('Filter location=Leipzig liefert nur veröffentlichte Stellen in Leipzig', async () => {
  const expected = await ids(
    `SELECT id FROM job WHERE status = 'published' AND location = $1 ORDER BY id`, ['Leipzig']);
  const res = await request(app).get('/api/jobs').query({ location: 'Leipzig' });
  assert.equal(res.status, 200);
  assert.ok(expected.length > 0);
  assert.deepEqual(sortedIds(res.body.jobs), expected);
  assert.ok(res.body.jobs.every((j) => j.location === 'Leipzig'));
});

test('Filter employment_type=part_time liefert nur Teilzeitstellen', async () => {
  const expected = await ids(
    `SELECT id FROM job WHERE status = 'published' AND employment_type = $1 ORDER BY id`, ['part_time']);
  const res = await request(app).get('/api/jobs').query({ employment_type: 'part_time' });
  assert.equal(res.status, 200);
  assert.ok(expected.length > 0);
  assert.deepEqual(sortedIds(res.body.jobs), expected);
  assert.ok(res.body.jobs.every((j) => j.employment_type === 'part_time'));
});

test('Beide Filter kombiniert (Remote + full_time)', async () => {
  const expected = await ids(
    `SELECT id FROM job WHERE status = 'published' AND location = $1 AND employment_type = $2 ORDER BY id`,
    ['Remote', 'full_time']);
  const res = await request(app).get('/api/jobs').query({ location: 'Remote', employment_type: 'full_time' });
  assert.equal(res.status, 200);
  assert.ok(expected.length > 0);
  assert.deepEqual(sortedIds(res.body.jobs), expected);
});

test('Ungültige employment_type → 400 mit JSON-Fehler', async () => {
  const res = await request(app).get('/api/jobs').query({ employment_type: 'freelance' });
  assertValidationError(res, 'employment_type');
});

// --- Beschäftigungsarten aus einer Quelle (Tabelle employment_type, Iteration 5) -------------

test('GET /api/employment-types liefert genau die Zeilen der Tabelle employment_type', async () => {
  const { rows } = await query('SELECT code, label FROM employment_type ORDER BY sort_order');
  assert.equal(rows.length, 3, 'Stammdaten: 3 Beschäftigungsarten');
  const res = await request(app).get('/api/employment-types');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { employment_types: rows });
});

// Die Tabelle ist die einzige Quelle: Ein neuer Eintrag gilt sofort als Filterwert (ohne Neustart),
// nach dem Entfernen ist derselbe Wert wieder ungültig. Die Testzeile wird in jedem Fall entfernt.
test('Neue Beschäftigungsart in der Tabelle ist sofort gültig, nach dem Entfernen → 400', async () => {
  const code = 'api_test_art';
  await query(`INSERT INTO employment_type (code, label, sort_order) VALUES ($1, 'API-Test Art', 999)`, [code]);
  try {
    const list = await request(app).get('/api/employment-types');
    assert.ok(list.body.employment_types.some((t) => t.code === code), 'neue Art in der Liste');
    const res = await request(app).get('/api/jobs').query({ employment_type: code });
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(res.body.jobs, []);
  } finally {
    await query('DELETE FROM employment_type WHERE code = $1', [code]);
  }
  const res = await request(app).get('/api/jobs').query({ employment_type: code });
  assertValidationError(res, 'employment_type');
  assert.equal(res.body.error.details[0].message, 'Bitte wählen Sie eine gültige Beschäftigungsart.');
});

test('Unbekannter Parameter → 400', async () => {
  const res = await request(app).get('/api/jobs').query({ foo: 'bar' });
  assertValidationError(res, 'foo');
});

test('Leerer Ort → 400', async () => {
  const res = await request(app).get('/api/jobs?location=');
  assertValidationError(res, 'location');
});

test('Ort mehrfach übergeben → 400', async () => {
  const res = await request(app).get('/api/jobs?location=Leipzig&location=Remote');
  assertValidationError(res, 'location');
});

test('Ort über 100 Zeichen → 400', async () => {
  const res = await request(app).get('/api/jobs').query({ location: 'x'.repeat(101) });
  assertValidationError(res, 'location');
});

test('Gültiger, aber nicht vorhandener Ort → 200 mit leerer Liste', async () => {
  const res = await request(app).get('/api/jobs').query({ location: 'Atlantis' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.jobs, []);
});

test("SQL-Injection-Versuch als Filter (' OR 1=1 --) → leere Liste, Daten unverändert", async () => {
  const before = (await query('SELECT count(*)::int AS n FROM job')).rows[0].n;
  const res = await request(app).get('/api/jobs').query({ location: "' OR 1=1 --" });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.jobs, []);
  const afterCount = (await query('SELECT count(*)::int AS n FROM job')).rows[0].n;
  assert.equal(afterCount, before);
});

// --- GET /api/jobs/:id -----------------------------------------------------------------------

test('Detail einer veröffentlichten Stelle → 200 mit Beschreibung', async () => {
  const id = publishedIds[0];
  const res = await request(app).get(`/api/jobs/${id}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.job.id, id);
  for (const key of ['title', 'location', 'employment_type', 'description', 'published_at']) {
    assert.ok(res.body.job[key], `Feld ${key} fehlt`);
  }
});

test('Detail eines Entwurfs → 404', async () => {
  const res = await request(app).get(`/api/jobs/${draftId}`);
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'NOT_FOUND');
});

test('Detail einer geschlossenen Stelle → 404', async () => {
  const res = await request(app).get(`/api/jobs/${closedId}`);
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'NOT_FOUND');
});

test('Detail einer nicht existierenden Stelle → 404', async () => {
  const res = await request(app).get('/api/jobs/2147483647');
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'NOT_FOUND');
});

for (const badId of ['abc', '0', '-1', '1.5', '2147483648', '1e3']) {
  test(`Ungültige ID "${badId}" → 400`, async () => {
    const res = await request(app).get(`/api/jobs/${badId}`);
    assertValidationError(res, 'id');
  });
}
