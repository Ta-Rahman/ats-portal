// Integrationstests: Bewerbung absenden (UC3) – POST /api/jobs/:id/applications, GET /api/consent.
// Läuft im api-Container gegen die geseedete Datenbank und das Upload-Volume.
// Aufräumen: alle Testbewerbungen (@api-test.invalid) samt Dateien vor dem Lauf und nach jedem Test.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool, query } from '../src/db.js';
import { CONSENT } from '../src/consent.js';
import { sanitizeFilename } from '../src/storage.js';
import {
  MAX_FILE_BYTES, cleanup, countTestApplications, findApplicationByToken, jobIdWithStatus, pdfBuffer,
  postApplication, publishedJobId, sha256hex, testEnv, uploadFiles, uploadPath, validFields,
} from './helpers.js';

const app = createApp(testEnv());
const WEB_URL = process.env.WEB_TEST_URL ?? 'http://web';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let jobId;
let draftId;
let closedId;
let filesBefore;

before(async () => {
  await cleanup();
  jobId = await publishedJobId();
  draftId = await jobIdWithStatus('draft');
  closedId = await jobIdWithStatus('closed');
  filesBefore = (await uploadFiles()).length;
});

afterEach(cleanup);

after(async () => {
  await cleanup();
  await pool.end();
});

// Prüft eine abgelehnte Bewerbung: Status, Fehlercode, Meldung am Feld; nichts gespeichert.
async function assertRejected(res, status, code, field, message) {
  assert.equal(res.status, status, res.text);
  assert.match(res.headers['content-type'], /application\/json/);
  assert.equal(res.body.error.code, code);
  const detail = res.body.error.details?.find((d) => d.field === field);
  assert.ok(detail, `Meldung für Feld ${field} fehlt: ${res.text}`);
  if (message) assert.equal(detail.message, message);
  assert.equal(await countTestApplications(), 0, 'keine Bewerbung gespeichert');
  assert.equal((await uploadFiles()).length, filesBefore, 'keine Datei gespeichert');
}

// --- Erfolgsfälle ------------------------------------------------------------------------------

test('Gültige Bewerbung → 201, nur Token in der Antwort; Bewerbung, Anhang und Datei angelegt', async () => {
  const pdf = pdfBuffer(2048);
  const fields = validFields({ phone: '+49 000 1111111', cover_letter: 'Kurzes Anschreiben.' });
  const res = await postApplication(app, jobId, fields, [{ buffer: pdf, filename: 'Lebenslauf.pdf' }]);

  assert.equal(res.status, 201, res.text);
  assert.deepEqual(Object.keys(res.body), ['token']);
  assert.equal(res.headers['cache-control'], 'no-store');
  const { token } = res.body;
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  for (const value of [fields.first_name, fields.last_name, fields.email, fields.phone]) {
    assert.ok(!res.text.includes(value), 'keine personenbezogenen Daten in der Antwort');
  }

  const row = await findApplicationByToken(token);
  assert.ok(row, 'Bewerbung über sha256(token) gefunden');
  assert.notEqual(row.access_token_hash, token);
  assert.equal(row.access_token_hash, sha256hex(token));
  assert.equal(row.job_id, jobId);
  assert.equal(row.stage, 'received');
  assert.equal(row.email, fields.email);
  assert.equal(row.phone, fields.phone);
  assert.equal(row.consent_version, CONSENT.version);
  assert.ok(Math.abs(Date.now() - row.consent_given_at.getTime()) < 60_000, 'consent_given_at = Serverzeit');
  assert.equal(row.rating, null);
  assert.equal(row.closed_at, null);
  assert.equal(row.delete_after, null);

  assert.match(row.storage_key, UUID);
  assert.equal(row.mime_type, 'application/pdf');
  assert.equal(row.size_bytes, pdf.length);
  assert.equal(row.original_filename, 'Lebenslauf.pdf');
  assert.deepEqual(await readFile(uploadPath(row.storage_key)), pdf, 'Datei liegt unter storage_key im Volume');
  assert.ok(!(await uploadFiles()).includes('Lebenslauf.pdf'), 'nie unter dem Originalnamen gespeichert');
});

test('Datei mit genau 5 MB → 201', async () => {
  const res = await postApplication(app, jobId, validFields(), [{ buffer: pdfBuffer(MAX_FILE_BYTES) }]);
  assert.equal(res.status, 201, res.text);
  const row = await findApplicationByToken(res.body.token);
  assert.equal(row.size_bytes, MAX_FILE_BYTES);
});

test('Echtes PDF als "cv.bin" mit MIME application/octet-stream → 201 (nur der Inhalt zählt)', async () => {
  const res = await postApplication(app, jobId, validFields(), [
    { buffer: pdfBuffer(), filename: 'cv.bin', contentType: 'application/octet-stream' },
  ]);
  assert.equal(res.status, 201, res.text);
  const row = await findApplicationByToken(res.body.token);
  assert.equal(row.mime_type, 'application/pdf');
});

test('Originaler Dateiname wird bereinigt gespeichert (Pfad und Sonderzeichen)', async () => {
  const res = await postApplication(app, jobId, validFields(), [
    { buffer: pdfBuffer(), filename: 'C:\\Users\\x\\Lebens<lauf>| Müller.pdf' },
  ]);
  assert.equal(res.status, 201, res.text);
  const row = await findApplicationByToken(res.body.token);
  assert.equal(row.original_filename, 'Lebenslauf Müller.pdf');
  assert.match(row.storage_key, UUID);
});

test('Steuerzeichen roh im Dateinamen-Header → 400 (multipart-Parser lehnt den Teil ab)', async () => {
  const res = await postApplication(app, jobId, validFields(), [{ buffer: pdfBuffer(), filename: 'a\u0007b.pdf' }]);
  await assertRejected(res, 400, 'VALIDATION_ERROR', '', 'Die Formulardaten konnten nicht gelesen werden.');
});

// Steuerzeichen können auch kodiert (filename*=UTF-8''…) ankommen – dann greift die Bereinigung.
test('sanitizeFilename entfernt Pfade, Steuer- und Sonderzeichen und begrenzt die Länge', () => {
  assert.equal(sanitizeFilename('../../etc/pass\u0000wd\u0007.pdf'), 'passwd.pdf');
  assert.equal(sanitizeFilename('C:\\temp\\a"b*c?.pdf'), 'abc.pdf');
  assert.equal(sanitizeFilename('  \u0001  '), 'lebenslauf.pdf');
  assert.equal(sanitizeFilename('.versteckt.pdf'), 'versteckt.pdf');
  const long = sanitizeFilename(`${'x'.repeat(300)}.pdf`);
  assert.equal(long.length, 255);
  assert.ok(long.endsWith('.pdf'));
});

test('<script> im Anschreiben wird unverändert als Text gespeichert und nicht zurückgegeben', async () => {
  const coverLetter = '<script>alert("xss")</script> & <b>fett</b>';
  const res = await postApplication(app, jobId, validFields({ cover_letter: coverLetter }));
  assert.equal(res.status, 201, res.text);
  assert.match(res.headers['content-type'], /application\/json/);
  assert.ok(!res.text.includes('<script>'));
  const row = await findApplicationByToken(res.body.token);
  assert.equal(row.cover_letter, coverLetter);
});

// --- Datei ------------------------------------------------------------------------------------

test('.exe mit Endung .pdf → 415', async () => {
  const exe = Buffer.concat([Buffer.from('MZ\x90\x00\x03\x00\x00\x00', 'latin1'), Buffer.alloc(200)]);
  const res = await postApplication(app, jobId, validFields(), [{ buffer: exe, filename: 'lebenslauf.pdf' }]);
  await assertRejected(res, 415, 'UNSUPPORTED_MEDIA_TYPE', 'cv',
    'Die Datei ist kein PDF. Bitte laden Sie Ihren Lebenslauf als PDF-Datei hoch.');
});

test('Textdatei mit Endung .pdf und MIME application/pdf → 415', async () => {
  const res = await postApplication(app, jobId, validFields(), [
    { buffer: Buffer.from('Nur Text, kein PDF.\n'), filename: 'lebenslauf.pdf', contentType: 'application/pdf' },
  ]);
  await assertRejected(res, 415, 'UNSUPPORTED_MEDIA_TYPE', 'cv');
});

test('5 MB + 1 Byte → 413', async () => {
  const res = await postApplication(app, jobId, validFields(), [{ buffer: pdfBuffer(MAX_FILE_BYTES + 1) }]);
  await assertRejected(res, 413, 'PAYLOAD_TOO_LARGE', 'cv', 'Die Datei ist größer als 5 MB.');
});

test('Ohne Datei → 400 mit Meldung am Feld cv', async () => {
  const res = await postApplication(app, jobId, validFields(), []);
  await assertRejected(res, 400, 'VALIDATION_ERROR', 'cv', 'Bitte laden Sie Ihren Lebenslauf als PDF hoch.');
});

test('Zwei Dateien → 400', async () => {
  const res = await postApplication(app, jobId, validFields(), [{ buffer: pdfBuffer() }, { buffer: pdfBuffer() }]);
  await assertRejected(res, 400, 'VALIDATION_ERROR', 'cv', 'Bitte laden Sie nur eine Datei hoch.');
});

test('Datei in einem anderen Feld als cv → 400', async () => {
  const res = await postApplication(app, jobId, validFields(), [{ field: 'anhang', buffer: pdfBuffer() }]);
  await assertRejected(res, 400, 'VALIDATION_ERROR', 'anhang');
});

// --- Felder -----------------------------------------------------------------------------------

test('Ohne Einwilligung → 400 (Feld consent)', async () => {
  const res = await postApplication(app, jobId, validFields({ consent: undefined }));
  await assertRejected(res, 400, 'VALIDATION_ERROR', 'consent', 'Bitte bestätigen Sie die Einwilligung.');
});

test('Einwilligung "false" → 400 (Feld consent)', async () => {
  const res = await postApplication(app, jobId, validFields({ consent: 'false' }));
  await assertRejected(res, 400, 'VALIDATION_ERROR', 'consent');
});

test('Veraltete Version des Einwilligungstextes → 400 (Feld consent_version)', async () => {
  const res = await postApplication(app, jobId, validFields({ consent_version: 'v0-alt' }));
  await assertRejected(res, 400, 'VALIDATION_ERROR', 'consent_version',
    'Der Einwilligungstext wurde aktualisiert. Bitte laden Sie die Seite neu.');
});

test('Fehlende Version des Einwilligungstextes → 400 mit eigener Meldung (Feld consent_version)', async () => {
  const res = await postApplication(app, jobId, validFields({ consent_version: undefined }));
  await assertRejected(res, 400, 'VALIDATION_ERROR', 'consent_version',
    'Die Version des Einwilligungstextes fehlt. Bitte laden Sie die Seite neu.');
});

test('Datenschutzhinweis nennt den Rückzug nicht doppelt (Version v2-2026-11)', () => {
  assert.equal(CONSENT.version, 'v2-2026-11');
  assert.ok(CONSENT.privacyNote.includes('Über Ihren persönlichen Status-Link sehen Sie jederzeit den Stand. '));
  assert.ok(!CONSENT.privacyNote.includes('und können die Bewerbung zurückziehen'));
});

test('Ungültige E-Mail → 400 (Feld email)', async () => {
  const res = await postApplication(app, jobId, validFields({ email: 'keine-adresse' }));
  await assertRejected(res, 400, 'VALIDATION_ERROR', 'email', 'Bitte geben Sie eine gültige E-Mail-Adresse an.');
});

test('Unbekanntes Feld → 400 (Feld foo)', async () => {
  const res = await postApplication(app, jobId, validFields({ foo: 'bar' }));
  await assertRejected(res, 400, 'VALIDATION_ERROR', 'foo', 'Unbekanntes Feld „foo“.');
});

test('Mehrere Fehler → 400 mit je einer deutschen Meldung pro Feld', async () => {
  const res = await postApplication(app, jobId,
    validFields({ first_name: '', last_name: 'x'.repeat(101), phone: 'abc', cover_letter: 'x'.repeat(10001) }), []);
  assert.equal(res.status, 400);
  const byField = Object.fromEntries(res.body.error.details.map((d) => [d.field, d.message]));
  assert.deepEqual(byField, {
    first_name: 'Bitte geben Sie Ihren Vornamen an.',
    last_name: 'Der Nachname darf höchstens 100 Zeichen lang sein.',
    phone: 'Die Telefonnummer darf nur Ziffern, Leerzeichen und + - / ( ) enthalten.',
    cover_letter: 'Das Anschreiben darf höchstens 10 000 Zeichen lang sein.',
    cv: 'Bitte laden Sie Ihren Lebenslauf als PDF hoch.',
  });
});

test('Kein multipart (JSON-Body) → 400', async () => {
  const res = await request(app).post(`/api/jobs/${jobId}/applications`).send({ first_name: 'Test' });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  assert.equal(await countTestApplications(), 0);
});

// --- Stelle -----------------------------------------------------------------------------------

for (const [label, getId] of [['Entwurf', () => draftId], ['geschlossene Stelle', () => closedId],
  ['nicht existierende Stelle', () => 2147483647]]) {
  test(`Bewerbung auf ${label} → 404`, async () => {
    const res = await postApplication(app, getId(), validFields());
    assert.equal(res.status, 404, res.text);
    assert.equal(res.body.error.code, 'NOT_FOUND');
    assert.equal(res.body.error.message, 'Stelle nicht gefunden oder nicht mehr ausgeschrieben');
    assert.equal(await countTestApplications(), 0);
    assert.equal((await uploadFiles()).length, filesBefore);
  });
}

test('Ungültige Stellen-ID → 400', async () => {
  const res = await postApplication(app, 'abc', validFields());
  assert.equal(res.status, 400);
  assert.equal(res.body.error.details[0].field, 'id');
});

// --- Einwilligungstext ------------------------------------------------------------------------

test('GET /api/consent liefert Version, Einwilligungstext und Datenschutzhinweis', async () => {
  const res = await request(app).get('/api/consent');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.consent, {
    version: CONSENT.version, text: CONSENT.text, privacy_note: CONSENT.privacyNote,
  });
});

// --- Atomarität -------------------------------------------------------------------------------

test('DB-Fehler nach dem Schreiben der Datei → 500, keine Zeile, keine verwaiste Datei', async (t) => {
  t.mock.method(console, 'error', () => {}); // erwarteten Serverfehler nicht ins Testprotokoll
  // Temporärer Trigger: lässt nur den Anhang mit dem Marker-Dateinamen scheitern – also NACH
  // dem Schreiben der Datei und dem INSERT der Bewerbung in derselben Transaktion.
  await query(`CREATE FUNCTION api_test_fail_attachment() RETURNS trigger LANGUAGE plpgsql AS $$
               BEGIN RAISE EXCEPTION 'Testfehler (Atomarität)'; END $$`);
  await query(`CREATE TRIGGER api_test_fail_attachment BEFORE INSERT ON attachment FOR EACH ROW
               WHEN (NEW.original_filename = 'atomaritaet-test.pdf')
               EXECUTE FUNCTION api_test_fail_attachment()`);
  try {
    const seqBefore = (await query(`SELECT last_value FROM application_id_seq`)).rows[0].last_value;
    const res = await postApplication(app, jobId, validFields(), [
      { buffer: pdfBuffer(), filename: 'atomaritaet-test.pdf' },
    ]);
    assert.equal(res.status, 500);
    assert.deepEqual(res.body, { error: { code: 'INTERNAL_ERROR', message: 'Interner Serverfehler' } });
    const seqAfter = (await query(`SELECT last_value FROM application_id_seq`)).rows[0].last_value;
    assert.ok(BigInt(seqAfter) > BigInt(seqBefore), 'INSERT der Bewerbung lief, wurde zurückgerollt');
    assert.equal(await countTestApplications(), 0, 'keine verwaiste Bewerbung');
    assert.equal((await uploadFiles()).length, filesBefore, 'keine verwaiste Datei');
  } finally {
    await query('DROP TRIGGER IF EXISTS api_test_fail_attachment ON attachment');
    await query('DROP FUNCTION IF EXISTS api_test_fail_attachment()');
  }
});

// --- Erreichbarkeit der Datei -----------------------------------------------------------------

test('Hochgeladene Datei ist über den Webserver nicht abrufbar', async () => {
  const res = await postApplication(app, jobId, validFields());
  assert.equal(res.status, 201);
  const { storage_key: key } = await findApplicationByToken(res.body.token);
  // Die SPA-Rückfallregel liefert für jeden Pfad index.html mit 200 – entscheidend ist der Inhalt.
  for (const p of [`/${key}`, `/uploads/${key}`, `/app/uploads/${key}`, `/api/uploads/${key}`]) {
    const r = await fetch(`${WEB_URL}${p}`);
    const body = Buffer.from(await r.arrayBuffer());
    assert.ok(!body.subarray(0, 5).equals(Buffer.from('%PDF-')), `${p}: liefert das PDF`);
    assert.doesNotMatch(r.headers.get('content-type') ?? '', /application\/pdf/, `${p}: Content-Type PDF`);
  }
});
