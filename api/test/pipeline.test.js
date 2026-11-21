// Integrationstests: interne Bewerbungsansichten (UC7–UC11) – Kanban, Detail, Bewertung,
// Stufenwechsel, Notizen, Verlauf, Lebenslauf-Download.
// Geändert werden nur eigene Testbewerbungen (@api-test.invalid, Cascade entfernt Verlauf und
// Notizen); Seed-Bewerbungen werden nicht verwendet.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { unlink } from 'node:fs/promises';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool, query } from '../src/db.js';
import {
  ADMIN_EMAIL, RECRUITER_EMAIL, cleanup, cleanupSessions, closedTestApplication, findApplicationByToken, login, pdfBuffer,
  postApplication, publishedJobId, seedUserId, testEnv, uploadFiles, uploadPath, validFields,
} from './helpers.js';

const app = createApp(testEnv());
let jobId;
let agent;
let csrf;
let recruiterId;
let filesBefore;

const SCRIPT_LETTER = '<script>alert("xss")</script> & <b>fett</b>\nZweite Zeile';
const PDF = pdfBuffer(4096);
const UMLAUT_NAME = 'Lebenslauf Müller.pdf';

before(async () => {
  await cleanup();
  jobId = await publishedJobId();
  ({ agent, csrf } = await login(app));
  recruiterId = await seedUserId(RECRUITER_EMAIL);
  filesBefore = (await uploadFiles()).length;
});

afterEach(cleanup);

after(async () => {
  await cleanup();
  await cleanupSessions();
  await app.locals.sessionStore.close();
  await pool.end();
});

const send = (a, token, method, path, body) => a[method](`/api/admin${path}`).set('X-CSRF-Token', token).send(body);
const post = (path, body) => send(agent, csrf, 'post', path, body);

// Legt eine Testbewerbung über die öffentliche Route an; liefert DB-Zeile (inkl. storage_key).
async function newApplication(overrides = {}) {
  const res = await postApplication(app, jobId, validFields({ cover_letter: SCRIPT_LETTER, ...overrides }),
    [{ buffer: PDF, filename: UMLAUT_NAME }]);
  assert.equal(res.status, 201, res.text);
  return findApplicationByToken(res.body.token);
}

async function historyRows(applicationId) {
  const { rows } = await query('SELECT * FROM status_history WHERE application_id = $1 ORDER BY id', [applicationId]);
  return rows;
}

// Antwortkörper als Buffer lesen (supertest puffert application/pdf sonst nicht).
function binary(res, cb) {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}

// --- Kanban (UC7) -----------------------------------------------------------------------------

test('Kanban: Stufen in Reihenfolge, alle Bewerbungen der Stelle, erlaubte Ziele je Stufe (intern)', async () => {
  const mine = await newApplication();
  const res = await agent.get(`/api/admin/jobs/${jobId}/applications`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.stages.map((s) => s.code),
    ['received', 'screening', 'interview', 'offer', 'hired', 'rejected', 'withdrawn']);
  const { rows } = await query('SELECT id, stage FROM application WHERE job_id = $1 ORDER BY id', [jobId]);
  assert.deepEqual(res.body.applications.map((a) => [a.id, a.stage]).sort((x, y) => x[0] - y[0]),
    rows.map((r) => [r.id, r.stage]));
  const card = res.body.applications.find((a) => a.id === mine.id);
  assert.deepEqual(Object.keys(card).sort(), ['created_at', 'first_name', 'id', 'last_name', 'rating', 'stage']);
  assert.deepEqual(res.body.transitions.received.map((t) => t.code), ['screening', 'rejected']);
  assert.deepEqual(res.body.transitions.offer.map((t) => t.code), ['hired', 'rejected']);
  for (const terminal of ['hired', 'rejected', 'withdrawn']) assert.equal(res.body.transitions[terminal], undefined);
  assert.ok(!JSON.stringify(res.body.transitions).includes('withdrawn'), 'Rückzug nur für Bewerber:innen');
  assert.equal(res.body.job.id, jobId);
});

test('Kanban einer nicht vorhandenen Stelle → 404', async () => {
  assert.equal((await agent.get('/api/admin/jobs/2147483647/applications')).status, 404);
});

// --- Detail (UC7) -----------------------------------------------------------------------------

test('Detail: Personendaten, Anschreiben mit <script> unverändert als JSON-Text, Anhang, erlaubte Ziele', async () => {
  const mine = await newApplication({ phone: '+49 000 2222222' });
  const res = await agent.get(`/api/admin/applications/${mine.id}`);
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /^application\/json/);
  assert.equal(res.headers['cache-control'], 'no-store');
  const a = res.body.application;
  assert.equal(a.cover_letter, SCRIPT_LETTER, 'Anschreiben unverändert');
  assert.equal(a.first_name, 'Test');
  assert.equal(a.email, mine.email);
  assert.equal(a.phone, '+49 000 2222222');
  assert.equal(a.stage, 'received');
  assert.equal(a.stage_label, 'Eingegangen');
  assert.equal(a.job.id, jobId);
  assert.equal(a.consent_version, mine.consent_version);
  assert.deepEqual(a.attachments.map((x) => [x.original_filename, x.size_bytes]), [[UMLAUT_NAME, PDF.length]]);
  assert.deepEqual(a.allowed_targets.map((t) => t.code), ['screening', 'rejected']);
  assert.deepEqual(a.notes, []);
  assert.deepEqual(a.history, []);
  assert.ok(!('access_token_hash' in a), 'kein Token-Hash in der Antwort');
  assert.ok(!res.text.includes(mine.access_token_hash));
});

// Eigene zurückgezogene Bewerbung statt einer Seed-Bewerbung (die der Löschlauf nach Fristablauf entfernt).
test('Detail einer Bewerbung nach Rückzug: Verlaufseintrag ohne Nutzer (Bewerber:in)', async () => {
  const { id } = await closedTestApplication(app, jobId, 'withdrawn');
  const res = await agent.get(`/api/admin/applications/${id}`);
  assert.equal(res.status, 200);
  const last = res.body.application.history.at(-1);
  assert.equal(last.to_stage, 'withdrawn');
  assert.equal(last.changed_by_name, null);
  assert.deepEqual(res.body.application.allowed_targets, []);
});

test('Detail einer nicht vorhandenen Bewerbung → 404', async () => {
  assert.equal((await agent.get('/api/admin/applications/2147483647')).status, 404);
});

// --- Stufenwechsel (UC9) und Verlauf (UC11) ---------------------------------------------------

test('Erlaubter Wechsel received → screening mit Kommentar → 200; Verlauf mit Sitzungsnutzer und Kommentar', async () => {
  const mine = await newApplication();
  const res = await post(`/applications/${mine.id}/stage`, { to_stage: 'screening', comment: '  Profil passt.  ' });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.application.stage, 'screening');
  assert.deepEqual(res.body.application.allowed_targets.map((t) => t.code), ['interview', 'rejected']);
  const history = await historyRows(mine.id);
  assert.equal(history.length, 1);
  assert.equal(history[0].from_stage, 'received');
  assert.equal(history[0].to_stage, 'screening');
  assert.equal(history[0].changed_by, recruiterId, 'changed_by = angemeldete Person');
  assert.equal(history[0].comment, 'Profil passt.');
  assert.equal(res.body.application.history[0].changed_by_name, 'Tom Muster (Recruiting)');
  assert.equal(res.body.application.history[0].comment, 'Profil passt.');
});

test('changed_by folgt der Sitzung: Wechsel durch Admin wird dem Admin zugeschrieben, ohne Kommentar NULL', async () => {
  const mine = await newApplication();
  const admin = await login(app, ADMIN_EMAIL);
  const res = await send(admin.agent, admin.csrf, 'post', `/applications/${mine.id}/stage`, { to_stage: 'screening' });
  assert.equal(res.status, 200, res.text);
  const [row] = await historyRows(mine.id);
  assert.equal(row.changed_by, await seedUserId(ADMIN_EMAIL));
  assert.equal(row.comment, null);
});

test('Unzulässige Wechsel → 409, kein Verlaufseintrag: überspringen, Rückzug (nur Bewerber:in), gleiche Stufe', async () => {
  const mine = await newApplication();
  const cases = [
    ['offer', 'Dieser Stufenwechsel ist nicht erlaubt.'],
    ['withdrawn', 'Dieser Stufenwechsel ist nicht erlaubt.'],
    ['received', 'Die Bewerbung befindet sich bereits in dieser Stufe.'],
  ];
  for (const [target, message] of cases) {
    const res = await post(`/applications/${mine.id}/stage`, { to_stage: target });
    assert.equal(res.status, 409, `${target}: ${res.text}`);
    assert.deepEqual(res.body.error, { code: 'TRANSITION_NOT_ALLOWED', message });
  }
  assert.equal((await historyRows(mine.id)).length, 0);
  const { rows } = await query('SELECT stage FROM application WHERE id = $1', [mine.id]);
  assert.equal(rows[0].stage, 'received');
});

test('Endstufe (→ rejected): closed_at und delete_after = closed_at + 6 Monate; danach kein Wechsel mehr (409)', async () => {
  const mine = await newApplication();
  const res = await post(`/applications/${mine.id}/stage`, { to_stage: 'rejected', comment: 'Absage' });
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.body.application.allowed_targets, []);
  const { rows } = await query(
    `SELECT closed_at IS NOT NULL AND delete_after = closed_at + interval '6 months' AS ok FROM application WHERE id = $1`,
    [mine.id]);
  assert.equal(rows[0].ok, true);
  assert.ok(res.body.application.closed_at && res.body.application.delete_after);
  const again = await post(`/applications/${mine.id}/stage`, { to_stage: 'screening' });
  assert.equal(again.status, 409);
});

test('Stufenwechsel mit ungültiger Stufe oder zu langem Kommentar → 400; nicht vorhandene Bewerbung → 404', async () => {
  const mine = await newApplication();
  const bad = await post(`/applications/${mine.id}/stage`, { to_stage: 'gibtsnicht' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.details[0].message, 'Bitte wählen Sie eine gültige Stufe.');
  const long = await post(`/applications/${mine.id}/stage`, { to_stage: 'screening', comment: 'x'.repeat(2001) });
  assert.equal(long.status, 400);
  assert.equal((await historyRows(mine.id)).length, 0);
  assert.equal((await post('/applications/2147483647/stage', { to_stage: 'screening' })).status, 404);
});

// --- Bewertung (UC8) --------------------------------------------------------------------------

test('Bewertung 3 → 200 und gespeichert; 0, 6, 2.5, "3", fehlend → 400', async () => {
  const mine = await newApplication();
  const ok = await send(agent, csrf, 'put', `/applications/${mine.id}/rating`, { rating: 3 });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.body.application.rating, 3);
  for (const body of [{ rating: 0 }, { rating: 6 }, { rating: 2.5 }, { rating: '3' }, {}]) {
    const res = await send(agent, csrf, 'put', `/applications/${mine.id}/rating`, body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.body.error.details[0].message, 'Die Bewertung muss eine ganze Zahl von 1 bis 5 sein.');
  }
  const { rows } = await query('SELECT rating FROM application WHERE id = $1', [mine.id]);
  assert.equal(rows[0].rating, 3);
  assert.equal((await send(agent, csrf, 'put', '/applications/2147483647/rating', { rating: 2 })).status, 404);
});

test('Bewertung einer abgeschlossenen Bewerbung (abgelehnt, zurückgezogen) → 409 RATING_FROZEN, unverändert', async () => {
  // abgelehnt durch Recruiter, Bewertung vorher 4
  const rejected = await newApplication();
  assert.equal((await send(agent, csrf, 'put', `/applications/${rejected.id}/rating`, { rating: 4 })).status, 200);
  assert.equal((await post(`/applications/${rejected.id}/stage`, { to_stage: 'rejected' })).status, 200);
  // zurückgezogen durch Bewerber:in über den Status-Link, ohne Bewertung
  const submitted = await postApplication(app, jobId, validFields());
  assert.equal(submitted.status, 201);
  assert.equal((await request(app).post(`/api/status/${submitted.body.token}/withdraw`)).status, 200);
  const withdrawn = await findApplicationByToken(submitted.body.token);

  for (const [row, value, expected] of [[rejected, 2, 4], [rejected, 4, 4], [withdrawn, 3, null]]) {
    const res = await send(agent, csrf, 'put', `/applications/${row.id}/rating`, { rating: value });
    assert.equal(res.status, 409, res.text);
    assert.deepEqual(res.body.error, {
      code: 'RATING_FROZEN',
      message: 'Die Bewerbung ist abgeschlossen; die Bewertung kann nicht mehr geändert werden.',
    });
    const { rows } = await query('SELECT rating FROM application WHERE id = $1', [row.id]);
    assert.equal(rows[0].rating, expected);
  }
});

// --- Notizen (UC10) ---------------------------------------------------------------------------

test('Notiz → 201 mit Autor; erscheint im Detail; leer → 400; nicht vorhandene Bewerbung → 404', async () => {
  const mine = await newApplication();
  const res = await post(`/applications/${mine.id}/notes`, { body: 'Telefonat vereinbart.' });
  assert.equal(res.status, 201, res.text);
  assert.equal(res.body.note.body, 'Telefonat vereinbart.');
  assert.equal(res.body.note.author_name, 'Tom Muster (Recruiting)');
  const { rows } = await query('SELECT author_id FROM note WHERE id = $1', [res.body.note.id]);
  assert.equal(rows[0].author_id, recruiterId);
  const detail = await agent.get(`/api/admin/applications/${mine.id}`);
  assert.deepEqual(detail.body.application.notes.map((n) => n.body), ['Telefonat vereinbart.']);

  const empty = await post(`/applications/${mine.id}/notes`, { body: '   ' });
  assert.equal(empty.status, 400);
  assert.equal(empty.body.error.details[0].message, 'Bitte geben Sie einen Notiztext ein.');
  assert.equal((await post('/applications/2147483647/notes', { body: 'x' })).status, 404);
});

// --- Download des Lebenslaufs -----------------------------------------------------------------

test('Download ohne Sitzung → 401', async () => {
  const mine = await newApplication();
  const { rows } = await query('SELECT id FROM attachment WHERE application_id = $1', [mine.id]);
  const res = await request(app).get(`/api/admin/attachments/${rows[0].id}`);
  assert.equal(res.status, 401);
  assert.doesNotMatch(res.headers['content-type'], /pdf/);
});

test('Download mit Sitzung → 200, PDF als Anhang (RFC 5987 für Umlaute), nosniff, no-store, bytegleich', async () => {
  const mine = await newApplication();
  const { rows } = await query('SELECT id FROM attachment WHERE application_id = $1', [mine.id]);
  const res = await agent.get(`/api/admin/attachments/${rows[0].id}`).buffer(true).parse(binary);
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'application/pdf');
  assert.equal(res.headers['content-disposition'],
    `attachment; filename="Lebenslauf M?ller.pdf"; filename*=UTF-8''Lebenslauf%20M%C3%BCller.pdf`);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(Number(res.headers['content-length']), PDF.length);
  assert.ok(Buffer.isBuffer(res.body) && res.body.equals(PDF), 'Datei bytegleich mit dem Upload');
});

test('Download: nicht vorhandener Anhang → 404; fehlende Datei → 404 ohne Pfad in der Antwort', async (t) => {
  assert.equal((await agent.get('/api/admin/attachments/2147483647')).status, 404);
  const mine = await newApplication();
  const { rows } = await query('SELECT id, storage_key FROM attachment WHERE application_id = $1', [mine.id]);
  await unlink(uploadPath(rows[0].storage_key));
  t.mock.method(console, 'error', () => {}); // erwartete Server-Logmeldung nicht ins Protokoll
  const res = await agent.get(`/api/admin/attachments/${rows[0].id}`);
  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { error: { code: 'NOT_FOUND', message: 'Die Datei zu diesem Anhang wurde nicht gefunden.' } });
  assert.ok(!res.text.includes(rows[0].storage_key) && !res.text.includes('/app/uploads'));
});

test('Nach den Tests dieser Datei: keine zusätzlichen Dateien im Upload-Volume', async () => {
  await cleanup();
  assert.equal((await uploadFiles()).length, filesBefore);
});
