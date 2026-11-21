// Integrationstests: Status-Link (UC4) und Rückzug (UC5) – /api/status/:token[/withdraw].
// Eigene Testbewerbungen (@api-test.invalid) werden über die API angelegt und danach entfernt;
// eine offene Seed-Bewerbung wird nur gelesen.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool, query } from '../src/db.js';
import {
  cleanup, closedTestApplication, findApplicationByToken, postApplication, publishedJobId, seedToken, testEnv,
  validFields,
} from './helpers.js';

const app = createApp(testEnv());
const INVALID_LINK = 'Dieser Status-Link ist ungültig oder die Bewerbung wurde bereits gelöscht.';
const STATUS_KEYS = ['can_withdraw', 'delete_after', 'job_title', 'stage', 'stage_label', 'submitted_at'];

let jobId;

before(async () => {
  await cleanup();
  jobId = await publishedJobId();
});

afterEach(cleanup);

after(async () => {
  await cleanup();
  await pool.end();
});

async function submit(overrides = {}) {
  const fields = validFields({ phone: '+49 000 2222222', ...overrides });
  const res = await postApplication(app, jobId, fields);
  assert.equal(res.status, 201, res.text);
  return { token: res.body.token, fields };
}

const unknownToken = () => randomBytes(32).toString('base64url');

// Zustand einer Bewerbung (Zeile + Anzahl Verlaufseinträge), um "unverändert" zu prüfen
async function snapshot(token) {
  const { rows } = await query(
    `SELECT a::text AS row_text, (SELECT count(*) FROM status_history h WHERE h.application_id = a.id)::int AS history
       FROM application a WHERE a.access_token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')`,
    [token],
  );
  return rows[0];
}

// --- GET /api/status/:token -------------------------------------------------------------------

test('Status einer neuen Bewerbung → 200 mit genau den vorgesehenen Feldern', async () => {
  const { token } = await submit();
  const res = await request(app).get(`/api/status/${token}`);
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.body.status).sort(), STATUS_KEYS);
  const { rows } = await query('SELECT title FROM job WHERE id = $1', [jobId]);
  assert.equal(res.body.status.job_title, rows[0].title);
  assert.equal(res.body.status.stage, 'received');
  assert.equal(res.body.status.stage_label, 'Eingegangen');
  assert.equal(res.body.status.can_withdraw, true);
  assert.equal(res.body.status.delete_after, null);
  assert.ok(!Number.isNaN(Date.parse(res.body.status.submitted_at)));
});

test('Status-Antwort enthält weder Name noch E-Mail noch Telefon', async () => {
  const { token, fields } = await submit({ first_name: 'Vornametest', last_name: 'Nachnametest' });
  const res = await request(app).get(`/api/status/${token}`);
  assert.equal(res.status, 200);
  for (const value of [fields.first_name, fields.last_name, fields.email, fields.phone]) {
    assert.ok(!res.text.includes(value), `Antwort enthält ${value}`);
  }
});

test('Status: Cache-Control no-store und Referrer-Policy no-referrer', async () => {
  const { token } = await submit();
  const res = await request(app).get(`/api/status/${token}`);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.headers['referrer-policy'], 'no-referrer');
});

test('Unbekannter Token → 404', async () => {
  const res = await request(app).get(`/api/status/${unknownToken()}`);
  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { error: { code: 'NOT_FOUND', message: INVALID_LINK } });
});

for (const bad of ['abc', 'A'.repeat(42), 'A'.repeat(44), `${'A'.repeat(42)}!`]) {
  test(`Token im falschen Format (${bad.length} Zeichen) → 400, gleiche Meldung wie 404`, async () => {
    const res = await request(app).get(`/api/status/${encodeURIComponent(bad)}`);
    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { error: { code: 'INVALID_TOKEN', message: INVALID_LINK } });
  });
}

// Seed-Bewerbung Nr. 7 ist im Seed offen und wird daher nicht vom Löschlauf erfasst. Geprüft wird die
// Ableitung des Tokens; die Stufe wird mit der Datenbank verglichen (sie kann sich bei manueller Nutzung
// der Entwicklungsumgebung ändern).
test('Seed-Token (abgeleitet wie im Seed) liefert den Status der Seed-Bewerbung', async () => {
  const res = await request(app).get(`/api/status/${seedToken(7)}`);
  assert.equal(res.status, 200);
  const { rows } = await query(
    `SELECT a.stage, s.is_terminal FROM application a JOIN pipeline_stage s ON s.code = a.stage
      WHERE a.access_token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')`,
    [seedToken(7)],
  );
  assert.equal(res.body.status.stage, rows[0].stage);
  assert.equal(res.body.status.can_withdraw, !rows[0].is_terminal);
});

// --- POST /api/status/:token/withdraw ---------------------------------------------------------

test('Rückzug → 200; Stufe withdrawn, Historie als Bewerber:in, Löschfrist gesetzt', async () => {
  const { token } = await submit();
  const res = await request(app).post(`/api/status/${token}/withdraw`);
  assert.equal(res.status, 200, res.text);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.body.status.stage, 'withdrawn');
  assert.equal(res.body.status.stage_label, 'Zurückgezogen');
  assert.equal(res.body.status.can_withdraw, false);
  assert.ok(res.body.status.delete_after);

  const row = await findApplicationByToken(token);
  assert.equal(row.stage, 'withdrawn');
  assert.ok(row.closed_at);
  const { rows } = await query(
    `SELECT from_stage, to_stage, changed_by, delete_after = closed_at + interval '6 months' AS frist_ok
       FROM status_history h JOIN application a ON a.id = h.application_id WHERE a.id = $1`,
    [row.id],
  );
  assert.deepEqual(rows, [{ from_stage: 'received', to_stage: 'withdrawn', changed_by: null, frist_ok: true }]);
});

test('Zweiter Rückzug → 409, keine weitere Historie', async () => {
  const { token } = await submit();
  assert.equal((await request(app).post(`/api/status/${token}/withdraw`)).status, 200);
  const res = await request(app).post(`/api/status/${token}/withdraw`);
  assert.equal(res.status, 409);
  assert.deepEqual(res.body, {
    error: {
      code: 'ALREADY_CLOSED',
      message: 'Die Bewerbung ist bereits abgeschlossen und kann nicht mehr zurückgezogen werden.',
    },
  });
  const row = await findApplicationByToken(token);
  const { rows } = await query('SELECT count(*)::int AS n FROM status_history WHERE application_id = $1', [row.id]);
  assert.equal(rows[0].n, 1);
});

// Eigene abgeschlossene Bewerbungen statt Seed-Bewerbungen: Abgeschlossene Seed-Bewerbungen
// entfernt der Löschlauf nach Ablauf ihrer Frist (Nr. 1 und 2 seit Herbst 2026).
for (const stage of ['hired', 'rejected', 'withdrawn']) {
  test(`Rückzug einer abgeschlossenen Bewerbung (${stage}) → 409, Daten unverändert`, async () => {
    const { token } = await closedTestApplication(app, jobId, stage);
    const before = await snapshot(token);
    assert.ok(before);
    const res = await request(app).post(`/api/status/${token}/withdraw`);
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'ALREADY_CLOSED');
    assert.deepEqual(await snapshot(token), before);
  });
}

test('Rückzug mit unbekanntem Token → 404, mit falschem Format → 400', async () => {
  const unknown = await request(app).post(`/api/status/${unknownToken()}/withdraw`);
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error.message, INVALID_LINK);
  const malformed = await request(app).post('/api/status/abc/withdraw');
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.error.message, INVALID_LINK);
});

// --- Token-Schutz -----------------------------------------------------------------------------

test('Klartext-Token erscheint in keiner Konsolenausgabe und in keiner gespeicherten Zeile', async (t) => {
  const calls = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug']) {
    t.mock.method(console, method, (...args) => calls.push(args));
  }
  const { token } = await submit();
  await request(app).get(`/api/status/${token}`);
  await request(app).post(`/api/status/${token}/withdraw`);
  await request(app).post(`/api/status/${token}/withdraw`); // 409
  const logged = calls.map((args) => args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : String(a))).join(' '));
  assert.ok(!logged.some((line) => line.includes(token)), 'Token in Konsolenausgabe');

  const { rows } = await query(
    `SELECT (SELECT count(*) FROM application a WHERE a::text LIKE '%' || $1 || '%')
          + (SELECT count(*) FROM attachment t WHERE t::text LIKE '%' || $1 || '%')
          + (SELECT count(*) FROM status_history h WHERE h::text LIKE '%' || $1 || '%') AS n`,
    [token],
  );
  assert.equal(Number(rows[0].n), 0, 'Token im Klartext gespeichert');
});
