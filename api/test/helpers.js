// Gemeinsame Hilfen für die Tests von Bewerbung und Status-Link.
// Alle Testbewerbungen tragen E-Mail-Adressen unter @api-test.invalid; cleanup() entfernt sie samt
// Dateien wieder, damit der Datenbestand nach "npm test" dem frischen Seed entspricht.
import { createHash } from 'node:crypto';
import { readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import request from 'supertest';
import { query, withTransaction } from '../src/db.js';
import { UPLOAD_DIR } from '../src/storage.js';
import { CONSENT } from '../src/consent.js';
import { hashPassword } from '../src/password.js';

export const TEST_DOMAIN = 'api-test.invalid';
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

let counter = 0;
export const testEmail = (label = 'bewerbung') => `${label}-${process.pid}-${++counter}@${TEST_DOMAIN}`;

export const sha256hex = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

// Gültiges Mini-PDF; mit size wird bis auf genau diese Größe aufgefüllt.
export function pdfBuffer(size) {
  const head = Buffer.from('%PDF-1.4\n1 0 obj <<>> endobj\n', 'latin1');
  const tail = Buffer.from('\ntrailer <<>>\n%%EOF\n', 'latin1');
  if (!size) return Buffer.concat([head, tail]);
  const fill = Buffer.alloc(size - head.length - tail.length, 0x30);
  return Buffer.concat([head, fill, tail]);
}

export function validFields(overrides = {}) {
  return {
    first_name: 'Test',
    last_name: 'Bewerbung',
    email: testEmail(),
    consent: 'true',
    consent_version: CONSENT.version,
    ...overrides,
  };
}

// Sendet eine Bewerbung als multipart/form-data. Felder mit undefined werden weggelassen.
// files: Liste von { field, buffer, filename, contentType }
export function postApplication(app, jobId, fields, files = [{ buffer: pdfBuffer() }]) {
  let req = request(app).post(`/api/jobs/${jobId}/applications`);
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) req = req.field(key, value);
  }
  for (const f of files) {
    req = req.attach(f.field ?? 'cv', f.buffer, {
      filename: f.filename ?? 'lebenslauf.pdf',
      contentType: f.contentType ?? 'application/pdf',
    });
  }
  return req;
}

export async function uploadFiles() {
  return readdir(UPLOAD_DIR);
}

export function uploadPath(storageKey) {
  return path.join(UPLOAD_DIR, storageKey);
}

export async function findApplicationByToken(token) {
  const { rows } = await query(
    `SELECT a.*, t.storage_key, t.original_filename, t.mime_type, t.size_bytes
       FROM application a LEFT JOIN attachment t ON t.application_id = a.id
      WHERE a.access_token_hash = $1`,
    [sha256hex(token)],
  );
  return rows[0] ?? null;
}

export async function countTestApplications() {
  const { rows } = await query(`SELECT count(*)::int AS n FROM application WHERE email LIKE $1`, [`%@${TEST_DOMAIN}`]);
  return rows[0].n;
}

// Entfernt alle Testbewerbungen (Cascade: attachment, status_history) und ihre Dateien.
export async function cleanup() {
  const { rows } = await query(
    `SELECT t.storage_key FROM attachment t JOIN application a ON a.id = t.application_id
      WHERE a.email LIKE $1`,
    [`%@${TEST_DOMAIN}`],
  );
  for (const { storage_key: key } of rows) {
    await unlink(uploadPath(key)).catch((err) => {
      if (err.code !== 'ENOENT') throw err;
    });
  }
  await query(`DELETE FROM application WHERE email LIKE $1`, [`%@${TEST_DOMAIN}`]);
}

// Eigene abgeschlossene Testbewerbung (statt abgeschlossener Seed-Bewerbungen, die der Löschlauf
// nach Ablauf ihrer Frist entfernt): über die öffentliche Route anlegen, dann in einer Transaktion
// über den Trigger in die Endstufe bewegen (wie im Seed: Rückzug als Bewerber:in, sonst Recruiter).
const PATH_TO = {
  hired: ['screening', 'interview', 'offer', 'hired'],
  rejected: ['rejected'],
  withdrawn: ['withdrawn'],
};

export async function closedTestApplication(app, jobId, stage) {
  const res = await postApplication(app, jobId, validFields());
  if (res.status !== 201) throw new Error(`Testbewerbung nicht angelegt: ${res.status} ${res.text}`);
  const { id } = await findApplicationByToken(res.body.token);
  const recruiterId = await seedUserId(RECRUITER_EMAIL);
  await withTransaction(async (client) => {
    for (const to of PATH_TO[stage]) {
      await client.query(
        `SELECT set_config('ats.actor', $1, true), set_config('ats.user_id', $2, true)`,
        [to === 'withdrawn' ? 'applicant' : 'internal', String(recruiterId)],
      );
      await client.query('UPDATE application SET stage = $2 WHERE id = $1', [id, to]);
    }
  });
  return { id, token: res.body.token };
}

export async function publishedJobId() {
  const { rows } = await query(`SELECT id FROM job WHERE status = 'published' ORDER BY id LIMIT 1`);
  return rows[0].id;
}

export async function jobIdWithStatus(status) {
  const { rows } = await query(`SELECT id FROM job WHERE status = $1 ORDER BY id LIMIT 1`, [status]);
  return rows[0].id;
}

// Seed-Token wie in db/init/04_seed.sql: base64url(sha256('seed-token-<nr>'))
export function seedToken(nr) {
  return createHash('sha256').update(`seed-token-${nr}`, 'utf8').digest('base64url');
}

// ---------------------------------------------------------------------------------------------
// Anmeldung und interner Bereich (Iteration 3)
// ---------------------------------------------------------------------------------------------

export const SEED_PASSWORD = 'Entwicklung-2026'; // Dev-Passwort der Seed-Nutzer (README)
export const RECRUITER_EMAIL = 'recruiting@muster-it.example';
export const ADMIN_EMAIL = 'admin@muster-it.example';
export const TEST_JOB_PREFIX = 'API-Test ';

// App-Instanz für Tests: ohne periodisches Aufräumen der Sitzungstabelle (sonst liefe nach
// pool.end() noch ein Timer), weitere Einstellungen (z. B. kurzes Timeout) über overrides.
// Rate-Limits sehr hoch, weil die Tests viele Anfragen von derselben Adresse senden; die
// Rate-Limit-Tests setzen eigene, niedrige Werte (jede App-Instanz hat eigene Zähler).
const GENEROUS_LIMITS = {
  RATE_LIMIT_LOGIN_IP: '100000/60',
  RATE_LIMIT_LOGIN_ACCOUNT: '100000/60',
  RATE_LIMIT_APPLY: '100000/60',
  RATE_LIMIT_STATUS: '100000/60',
  RATE_LIMIT_WITHDRAW: '100000/60',
};

export function testEnv(overrides = {}) {
  // REQUEST_LOG aus: sonst stünde jede Testanfrage im Testprotokoll (eigener Test in requestLog.test.js).
  return { ...process.env, SESSION_PRUNE_SECONDS: '0', REQUEST_LOG: 'false', ...GENEROUS_LIMITS, ...overrides };
}

// Alle in den Tests ausgegebenen Sitzungs-IDs; cleanupSessions() löscht sie wieder.
const issuedSessionIds = new Set();

// Sitzungs-ID aus dem Set-Cookie-Header (Format ats.sid=s:<id>.<Signatur>, URL-kodiert).
export function sessionIdFrom(res) {
  const cookie = (res.headers['set-cookie'] ?? []).find((c) => c.startsWith('ats.sid='));
  if (!cookie) return null;
  const value = decodeURIComponent(cookie.split(';')[0].slice('ats.sid='.length));
  if (!value.startsWith('s:')) return null;
  const sid = value.slice(2, value.lastIndexOf('.'));
  issuedSessionIds.add(sid);
  return sid;
}

// Cookie-Paar "ats.sid=…" aus einer Antwort, um es später ohne Agent erneut zu senden.
export function sessionCookieFrom(res) {
  return (res.headers['set-cookie'] ?? []).find((c) => c.startsWith('ats.sid='))?.split(';')[0] ?? null;
}

// Meldet an und liefert einen Agent (hält das Cookie) samt CSRF-Token.
export async function login(app, email = RECRUITER_EMAIL, password = SEED_PASSWORD) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password });
  sessionIdFrom(res);
  return { agent, res, csrf: res.body.csrf_token, cookie: sessionCookieFrom(res) };
}

export async function countSessions() {
  const { rows } = await query('SELECT count(*)::int AS n FROM session_store.session');
  return rows[0].n;
}

export async function sessionExists(sid) {
  const { rows } = await query('SELECT 1 FROM session_store.session WHERE sid = $1', [sid]);
  return rows.length === 1;
}

export async function cleanupSessions() {
  if (issuedSessionIds.size === 0) return;
  await query('DELETE FROM session_store.session WHERE sid = ANY($1)', [[...issuedSessionIds]]);
  issuedSessionIds.clear();
}

// Temporärer interner Nutzer (E-Mail unter @api-test.invalid). bcrypt-Kosten 4 statt 12, damit
// die Tests schnell bleiben – die Anmeldung prüft mit den Kosten, die im Hash stehen.
let userCounter = 0;
export async function createTestUser({ password = 'Test-Passwort-1', active = true, role = 'recruiter' } = {}) {
  const email = `nutzer-${process.pid}-${++userCounter}@${TEST_DOMAIN}`;
  const { rows } = await query(
    `INSERT INTO internal_user (email, password_hash, display_name, role, is_active)
     VALUES ($1, $2, 'API-Testnutzer', $3, $4) RETURNING id`,
    [email, await hashPassword(password, 4), role, active],
  );
  return { id: rows[0].id, email, password };
}

export async function cleanupUsers() {
  await query(`DELETE FROM internal_user WHERE email LIKE $1`, [`%@${TEST_DOMAIN}`]);
}

// Entfernt Teststellen (Titel "API-Test …") samt ihrer Testbewerbungen und Dateien.
export async function cleanupJobs() {
  await cleanup();
  await query(`DELETE FROM job WHERE title LIKE $1`, [`${TEST_JOB_PREFIX}%`]);
}

export async function seedUserId(email) {
  const { rows } = await query('SELECT id FROM internal_user WHERE email = $1', [email]);
  return rows[0].id;
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Löschprotokoll ist nur anhängbar (Trigger AT012, db/init/02a_loeschlauf.sql). Tests entfernen ihre
// eigenen Zeilen (id > Stand vor dem Test) deshalb mit abgeschalteten Triggern:
// session_replication_role = replica – nur als Superuser möglich und nur in dieser Transaktion.
export async function removeDeletionLogRowsAfter(id) {
  await withTransaction(async (client) => {
    await client.query('SET LOCAL session_replication_role = replica');
    await client.query('DELETE FROM deletion_log WHERE id > $1', [id]);
  });
}
