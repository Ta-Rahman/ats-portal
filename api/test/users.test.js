// Nutzerverwaltung (UC12, nur Admin): anlegen mit Passwortregel, Rolle ändern, (de)aktivieren,
// Selbstschutz, Schutz des letzten aktiven Admins bei gleichzeitigen Änderungen (Trigger, AT011).
// Alle angelegten Nutzer haben E-Mail-Adressen unter @api-test.invalid und werden wieder gelöscht.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createApp } from '../src/app.js';
import { pool, query } from '../src/db.js';
import {
  ADMIN_EMAIL, TEST_DOMAIN, cleanupSessions, cleanupUsers, createTestUser, login, seedUserId, sleep, testEnv,
} from './helpers.js';

const app = createApp(testEnv());
const GOOD_PASSWORD = 'Kaffeetasse-Fahrrad-42';
const USER_KEYS = ['created_at', 'display_name', 'email', 'id', 'is_active', 'role'];
let admin; // { agent, csrf, res }
let adminId;
let counter = 0;

const newEmail = () => `neu-${process.pid}-${++counter}@${TEST_DOMAIN}`;
const send = (method, path, body) => admin.agent[method](`/api/admin${path}`).set('X-CSRF-Token', admin.csrf).send(body);
const createUser = (overrides = {}) => send('post', '/users', {
  email: newEmail(), display_name: 'Clara Testperson', role: 'recruiter', password: GOOD_PASSWORD, ...overrides,
});

before(async () => {
  await cleanupUsers();
  admin = await login(app, ADMIN_EMAIL);
  adminId = admin.res.body.user.id;
});

afterEach(async () => {
  await cleanupSessions();
  await cleanupUsers();
  admin = await login(app, ADMIN_EMAIL); // eigene Sitzung wurde mit aufgeräumt
});

after(async () => {
  await cleanupSessions();
  await cleanupUsers();
  await app.locals.sessionStore.close();
  await pool.end();
});

test('Liste: alle Nutzer ohne Passwort-Hash', async () => {
  const res = await send('get', '/users');
  assert.equal(res.status, 200);
  assert.ok(res.body.users.length >= 2);
  for (const u of res.body.users) assert.deepEqual(Object.keys(u).sort(), USER_KEYS);
  assert.ok(!res.text.includes('password') && !res.text.includes('$2a$'));
});

test('Anlegen → 201 ohne Hash; bcrypt Kosten 12; neuer Nutzer kann sich anmelden (Rolle recruiter)', async () => {
  const email = newEmail();
  const res = await createUser({ email: `  ${email.toUpperCase()}  `.replace(TEST_DOMAIN.toUpperCase(), TEST_DOMAIN) });
  assert.equal(res.status, 201, res.text);
  assert.deepEqual(Object.keys(res.body.user).sort(), USER_KEYS);
  assert.equal(res.body.user.role, 'recruiter');
  assert.equal(res.body.user.is_active, true);
  const { rows } = await query('SELECT password_hash FROM internal_user WHERE id = $1', [res.body.user.id]);
  assert.match(rows[0].password_hash, /^\$2[aby]\$12\$/);

  const user = await login(app, email, GOOD_PASSWORD); // Groß-/Kleinschreibung der E-Mail egal
  assert.equal(user.res.status, 200, user.res.text);
  assert.equal((await user.agent.get('/api/admin/jobs')).status, 200);
  assert.equal((await user.agent.get('/api/admin/users')).status, 403);
});

test('Doppelte E-Mail (andere Groß-/Kleinschreibung) → 409 EMAIL_TAKEN, ohne E-Mail im Text', async () => {
  const email = newEmail();
  assert.equal((await createUser({ email })).status, 201);
  const res = await createUser({ email: email.toUpperCase().replace(TEST_DOMAIN.toUpperCase(), TEST_DOMAIN) });
  assert.equal(res.status, 409);
  assert.deepEqual(res.body.error, { code: 'EMAIL_TAKEN', message: 'Diese E-Mail-Adresse ist bereits vergeben.' });
});

const POLICY = [
  ['14 Zeichen', 'Kaffeetasse-12', 400, 'mindestens 15 Zeichen'],
  ['15 Zeichen', 'Kaffeetasse-123', 201],
  ['64 Zeichen', 'Fahrradklingel '.repeat(4) + 'abcd', 201],
  ['65 Zeichen', 'Fahrradklingel '.repeat(4) + 'abcde', 400, 'höchstens 64 Zeichen'],
  ['40 × ä (80 Byte)', 'ä'.repeat(40), 400, 'höchstens 72 Byte'],
  ['Leerzeichen und Umlaute (keine Zusammensetzungsregeln)', 'grüne äpfel über brücken', 201],
  ['ein wiederholtes Zeichen', 'x'.repeat(20), 400, 'einzigen wiederholten Zeichen'],
  ['enthält „Passwort“', 'MeinPasswort-ist-lang', 400, 'naheliegende Wörter'],
  ['enthält den Namen', 'testperson-sehr-lang', 400, 'Teile von Name'],
];

for (const [label, password, status, fragment] of POLICY) {
  test(`Passwortregel: ${label} → ${status}`, async () => {
    const res = await createUser({ password });
    assert.equal(res.status, status, res.text);
    if (fragment) {
      const messages = res.body.error.details.filter((d) => d.field === 'password').map((d) => d.message);
      assert.ok(messages.some((m) => m.includes(fragment)), JSON.stringify(res.body));
    }
  });
}

test('Ungültige Rolle, unbekanntes Feld, ungültige E-Mail → 400', async () => {
  assert.equal((await createUser({ role: 'superuser' })).status, 400);
  assert.equal((await createUser({ is_active: false })).status, 400);
  assert.equal((await createUser({ email: 'keine-adresse' })).status, 400);
});

test('Rolle ändern wirkt sofort auf die offene Sitzung (recruiter → admin → recruiter)', async () => {
  const created = (await createUser()).body.user;
  const user = await login(app, created.email, GOOD_PASSWORD);
  assert.equal((await user.agent.get('/api/admin/users')).status, 403);

  const up = await send('put', `/users/${created.id}/role`, { role: 'admin' });
  assert.equal(up.status, 200, up.text);
  assert.equal(up.body.user.role, 'admin');
  assert.equal((await user.agent.get('/api/admin/users')).status, 200, 'gleiche Sitzung, jetzt Admin');

  assert.equal((await send('put', `/users/${created.id}/role`, { role: 'recruiter' })).status, 200);
  assert.equal((await user.agent.get('/api/admin/users')).status, 403);
});

test('Deaktivieren: offene Sitzung → 401, Anmeldung → 401; Reaktivieren: Anmeldung wieder möglich', async () => {
  const created = (await createUser()).body.user;
  const user = await login(app, created.email, GOOD_PASSWORD);
  assert.equal((await user.agent.get('/api/admin/jobs')).status, 200);

  const off = await send('post', `/users/${created.id}/deactivate`);
  assert.equal(off.status, 200, off.text);
  assert.equal(off.body.user.is_active, false);
  assert.equal((await user.agent.get('/api/admin/jobs')).status, 401, 'offene Sitzung sofort ungültig');
  assert.equal((await login(app, created.email, GOOD_PASSWORD)).res.status, 401);

  const on = await send('post', `/users/${created.id}/activate`);
  assert.equal(on.body.user.is_active, true);
  assert.equal((await login(app, created.email, GOOD_PASSWORD)).res.status, 200);
});

test('Eigenes Konto herabstufen oder deaktivieren → 409 SELF_CHANGE_NOT_ALLOWED, bleibt Admin', async () => {
  for (const [method, path, body] of [['put', `/users/${adminId}/role`, { role: 'recruiter' }],
    ['post', `/users/${adminId}/deactivate`]]) {
    const res = await send(method, path, body);
    assert.equal(res.status, 409, res.text);
    assert.equal(res.body.error.code, 'SELF_CHANGE_NOT_ALLOWED');
  }
  const { rows } = await query('SELECT role, is_active FROM internal_user WHERE id = $1', [adminId]);
  assert.deepEqual(rows[0], { role: 'admin', is_active: true });
  assert.equal((await send('get', '/users')).status, 200);
});

test('Nicht vorhandener Nutzer → 404 (Rolle, deaktivieren, aktivieren)', async () => {
  assert.equal((await send('put', '/users/2147483647/role', { role: 'admin' })).status, 404);
  assert.equal((await send('post', '/users/2147483647/deactivate')).status, 404);
  assert.equal((await send('post', '/users/2147483647/activate')).status, 404);
});

// Gleichzeitig: Transaktion 1 deaktiviert den Seed-Admin, Transaktion 2 den einzigen weiteren Admin.
// Ohne Sperre sähe jede den anderen Admin noch als aktiv → kein Admin mehr. Der Trigger reiht beide
// hintereinander; nach dem COMMIT von Transaktion 1 scheitert Transaktion 2 mit AT011.
// Der Seed-Admin wird danach wieder aktiviert (Zeile wie vorher, Fingerabdruck unverändert).
test('Letzter Admin bei gleichzeitigen Änderungen: zweite Transaktion wartet und scheitert mit AT011', async () => {
  const seedAdminId = await seedUserId(ADMIN_EMAIL);
  const seedRowBefore = (await query('SELECT t::text AS row FROM internal_user t WHERE id = $1', [seedAdminId])).rows[0].row;
  const other = await createTestUser({ role: 'admin' });
  const { rows: active } = await query(`SELECT count(*)::int AS n FROM internal_user WHERE role = 'admin' AND is_active`);
  assert.equal(active[0].n, 2, 'Ausgangslage: genau zwei aktive Admins');

  const c1 = new pg.Client();
  const c2 = new pg.Client();
  await c1.connect();
  await c2.connect();
  try {
    await c1.query('BEGIN');
    await c1.query('UPDATE internal_user SET is_active = false WHERE id = $1', [seedAdminId]);
    await c2.query('BEGIN');
    const second = c2.query('UPDATE internal_user SET is_active = false WHERE id = $1', [other.id])
      .then(() => 'ok', (err) => err.code);
    // warten, bis Transaktion 2 tatsächlich an der Sperre steht
    const pid2 = c2.processID;
    for (let i = 0; i < 50; i += 1) {
      const { rows } = await query('SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1', [pid2]);
      if (rows[0]?.wait_event_type === 'Lock') break;
      await sleep(20);
    }
    const { rows: waiting } = await query('SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1', [pid2]);
    assert.equal(waiting[0].wait_event_type, 'Lock', 'Transaktion 2 wartet auf die Sperre');
    await c1.query('COMMIT');
    assert.equal(await second, 'AT011');
    await c2.query('ROLLBACK');
  } finally {
    await c1.end();
    await c2.end();
    await query('UPDATE internal_user SET is_active = true WHERE id = $1', [seedAdminId]);
  }
  const seedRowAfter = (await query('SELECT t::text AS row FROM internal_user t WHERE id = $1', [seedAdminId])).rows[0].row;
  assert.equal(seedRowAfter, seedRowBefore, 'Seed-Admin wiederhergestellt');
});
