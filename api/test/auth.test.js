// Integrationstests: Anmeldung interner Nutzer – POST /api/auth/login, POST /api/auth/logout,
// GET /api/auth/me; Cookie-Flags, neue Sitzungs-ID beim Login, Timeouts, deaktivierte Nutzer.
// Aufräumen: alle in den Tests ausgegebenen Sitzungen und temporären Nutzer (@api-test.invalid).
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool, query } from '../src/db.js';
import { verifyPassword } from '../src/password.js';
import { LOGIN_FAILED_MESSAGE } from '../src/services/auth.service.js';
import { HTTPS_REQUIRED_MESSAGE } from '../src/routes/auth.routes.js';
import {
  RECRUITER_EMAIL, SEED_PASSWORD, cleanupSessions, cleanupUsers, createTestUser, login, seedUserId,
  sessionCookieFrom, sessionExists, sessionIdFrom, sleep, testEnv,
} from './helpers.js';

const apps = [];
function newApp(overrides) {
  const app = createApp(testEnv(overrides));
  apps.push(app);
  return app;
}
const app = newApp();

afterEach(async () => {
  await cleanupSessions();
  await cleanupUsers();
});

after(async () => {
  for (const a of apps) await a.locals.sessionStore.close();
  await pool.end();
});

const FAILED_BODY = { error: { code: 'INVALID_CREDENTIALS', message: LOGIN_FAILED_MESSAGE } };
const UNAUTHENTICATED_BODY = { error: { code: 'UNAUTHENTICATED', message: 'Bitte melden Sie sich an.' } };

function cookieAttributes(res) {
  const cookie = (res.headers['set-cookie'] ?? []).find((c) => c.startsWith('ats.sid='));
  assert.ok(cookie, `kein Sitzungs-Cookie: ${JSON.stringify(res.headers['set-cookie'])}`);
  return cookie.split(';').slice(1).map((p) => p.trim().toLowerCase());
}

// --- Anmeldung --------------------------------------------------------------------------------

test('Login mit Seed-Recruiter → 200, Nutzer und CSRF-Token, Cookie HttpOnly + SameSite=Lax, ohne Secure', async () => {
  const { res } = await login(app);
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(Object.keys(res.body).sort(), ['csrf_token', 'user']);
  assert.deepEqual(res.body.user, {
    id: await seedUserId(RECRUITER_EMAIL), email: RECRUITER_EMAIL,
    display_name: 'Tom Muster (Recruiting)', role: 'recruiter',
  });
  assert.match(res.body.csrf_token, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(!res.text.includes('password'), 'kein Passwort/Hash in der Antwort');
  assert.equal(res.headers['cache-control'], 'no-store');

  const attrs = cookieAttributes(res);
  assert.ok(attrs.includes('httponly'));
  assert.ok(attrs.includes('samesite=lax'));
  assert.ok(attrs.includes('path=/'));
  assert.ok(!attrs.includes('secure'), 'lokal (COOKIE_SECURE=false) ohne Secure');
  assert.ok(attrs.some((a) => a.startsWith('expires=')), 'Ablauf = Leerlauf-Timeout');

  const sid = sessionIdFrom(res);
  const { rows } = await query('SELECT sess FROM session_store.session WHERE sid = $1', [sid]);
  assert.equal(rows[0].sess.userId, res.body.user.id, 'Sitzung serverseitig in session_store.session');
});

test('COOKIE_SECURE=true: hinter HTTPS-Proxy (X-Forwarded-Proto: https) trägt das Cookie Secure', async () => {
  const secureApp = newApp({ COOKIE_SECURE: 'true' });
  const res = await request(secureApp).post('/api/auth/login')
    .set('X-Forwarded-Proto', 'https')
    .send({ email: RECRUITER_EMAIL, password: SEED_PASSWORD });
  assert.equal(res.status, 200, res.text);
  sessionIdFrom(res);
  assert.ok(cookieAttributes(res).includes('secure'));
});

// Fehlkonfiguration (Secure an, aber kein HTTPS): Früher antwortete die Anmeldung mit 200, der Browser
// verwarf das Cookie, und im Store blieb eine verwaiste Sitzung. Jetzt: ausdrückliche Ablehnung.
test('COOKIE_SECURE=true über unverschlüsseltes http → 403 HTTPS_REQUIRED, kein Cookie, keine Sitzung', async () => {
  const secureApp = newApp({ COOKIE_SECURE: 'true' });
  const countSessions = async () => Number((await query('SELECT count(*) FROM session_store.session')).rows[0].count);
  const before = await countSessions();
  for (const proto of [undefined, 'http']) {
    const req = request(secureApp).post('/api/auth/login');
    if (proto) req.set('X-Forwarded-Proto', proto);
    const res = await req.send({ email: RECRUITER_EMAIL, password: SEED_PASSWORD });
    assert.equal(res.status, 403, `X-Forwarded-Proto ${proto ?? '(fehlt)'}`);
    assert.equal(res.body.error.code, 'HTTPS_REQUIRED');
    assert.equal(res.body.error.message, HTTPS_REQUIRED_MESSAGE);
    assert.equal(res.headers['set-cookie'], undefined, 'kein Set-Cookie');
    assert.equal(res.headers['cache-control'], 'no-store');
  }
  assert.equal(await countSessions(), before, 'keine Sitzungszeile angelegt');
});

test('COOKIE_SECURE=true über http mit falschem Passwort → ebenfalls 403 (keine Passwortprüfung)', async () => {
  const secureApp = newApp({ COOKIE_SECURE: 'true' });
  const res = await request(secureApp).post('/api/auth/login').send({ email: RECRUITER_EMAIL, password: 'falsch' });
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'HTTPS_REQUIRED');
});

test('E-Mail ohne Rücksicht auf Groß-/Kleinschreibung → 200', async () => {
  const { res } = await login(app, 'Recruiting@Muster-IT.example');
  assert.equal(res.status, 200, res.text);
});

test('Falsches Passwort, unbekannte E-Mail, deaktivierter Nutzer → jeweils 401 mit identischem Body, kein Cookie', async () => {
  const inactive = await createTestUser({ active: false });
  const cases = {
    'falsches Passwort': { email: RECRUITER_EMAIL, password: 'falsch' },
    'unbekannte E-Mail': { email: 'unbekannt@muster-it.example', password: SEED_PASSWORD },
    'deaktivierter Nutzer (richtiges Passwort)': { email: inactive.email, password: inactive.password },
  };
  for (const [label, body] of Object.entries(cases)) {
    const res = await request(app).post('/api/auth/login').send(body);
    assert.equal(res.status, 401, `${label}: ${res.text}`);
    assert.deepEqual(res.body, FAILED_BODY, label);
    assert.equal(sessionCookieFrom(res), null, `${label}: kein Cookie`);
  }
});

test('Unbekannte E-Mail wird ebenfalls per bcrypt geprüft (Antwortzeit vergleichbar mit falschem Passwort)', async () => {
  async function median(body) {
    const times = [];
    for (let i = 0; i < 3; i += 1) {
      const start = process.hrtime.bigint();
      const res = await request(app).post('/api/auth/login').send(body);
      times.push(Number(process.hrtime.bigint() - start) / 1e6);
      assert.equal(res.status, 401);
    }
    return times.sort((a, b) => a - b)[1];
  }
  const wrongPassword = await median({ email: RECRUITER_EMAIL, password: 'falsch' });
  const unknownEmail = await median({ email: 'unbekannt@muster-it.example', password: 'falsch' });
  const ratio = unknownEmail / wrongPassword;
  console.log(`Antwortzeit (Median aus 3): falsches Passwort ${wrongPassword.toFixed(0)} ms, ` +
    `unbekannte E-Mail ${unknownEmail.toFixed(0)} ms, Verhältnis ${ratio.toFixed(2)}`);
  assert.ok(ratio > 0.5 && ratio < 2, `Verhältnis ${ratio}`);
});

test('Fehlende Felder → 400; Body nicht als JSON (Formular) → 400', async () => {
  const missing = await request(app).post('/api/auth/login').send({ email: RECRUITER_EMAIL });
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error.details[0].field, 'password');
  const form = await request(app).post('/api/auth/login').type('form')
    .send(`email=${RECRUITER_EMAIL}&password=${SEED_PASSWORD}`);
  assert.equal(form.status, 400);
  assert.equal(sessionCookieFrom(form), null);
});

test('Passwort-Hashes im Seed: bcrypt mit Kosten 12, ungleich Klartext; falsches Passwort scheitert', async () => {
  const { rows } = await query('SELECT password_hash FROM internal_user WHERE email = $1', [RECRUITER_EMAIL]);
  const hash = rows[0].password_hash;
  assert.notEqual(hash, SEED_PASSWORD);
  assert.match(hash, /^\$2[ab]\$12\$/);
  assert.equal(await verifyPassword(SEED_PASSWORD, hash), true);
  assert.equal(await verifyPassword('Entwicklung-2027', hash), false);
  assert.equal(await verifyPassword(SEED_PASSWORD, null), false, 'unbekannter Nutzer nie erfolgreich');
});

// --- Sitzung ----------------------------------------------------------------------------------

test('GET /api/auth/me: ohne Sitzung 401, mit Sitzung Nutzer und derselbe CSRF-Token', async () => {
  const anon = await request(app).get('/api/auth/me');
  assert.equal(anon.status, 401);
  assert.deepEqual(anon.body, UNAUTHENTICATED_BODY);

  const { agent, res, csrf } = await login(app);
  const me = await agent.get('/api/auth/me');
  assert.equal(me.status, 200);
  assert.deepEqual(me.body, { user: res.body.user, csrf_token: csrf });
  assert.equal(me.headers['cache-control'], 'no-store');
});

test('Erneuter Login vergibt eine neue Sitzungs-ID; das alte Cookie ist danach ungültig (401)', async () => {
  const { agent, res: first } = await login(app);
  const oldSid = sessionIdFrom(first);
  const oldCookie = sessionCookieFrom(first);

  const second = await agent.post('/api/auth/login').send({ email: RECRUITER_EMAIL, password: SEED_PASSWORD });
  assert.equal(second.status, 200);
  const newSid = sessionIdFrom(second);
  assert.ok(newSid && newSid !== oldSid, 'neue Sitzungs-ID');
  assert.equal(await sessionExists(oldSid), false, 'alte Sitzung aus dem Store gelöscht');

  const withOld = await request(app).get('/api/auth/me').set('Cookie', oldCookie);
  assert.equal(withOld.status, 401);
  assert.equal((await agent.get('/api/auth/me')).status, 200);
});

test('Logout: ohne/mit falschem CSRF-Token 403 (weiter angemeldet), mit Token 204; danach 401, Sitzung gelöscht', async () => {
  const { agent, res, csrf, cookie } = await login(app);
  const sid = sessionIdFrom(res);

  const noToken = await agent.post('/api/auth/logout');
  assert.equal(noToken.status, 403);
  assert.equal(noToken.body.error.code, 'CSRF_INVALID');
  const wrongToken = await agent.post('/api/auth/logout').set('X-CSRF-Token', 'x'.repeat(43));
  assert.equal(wrongToken.status, 403);
  assert.equal((await agent.get('/api/auth/me')).status, 200, 'noch angemeldet');

  const ok = await agent.post('/api/auth/logout').set('X-CSRF-Token', csrf);
  assert.equal(ok.status, 204);
  assert.match(ok.headers['set-cookie'].join(), /ats\.sid=;/, 'Cookie wird gelöscht');
  assert.equal(await sessionExists(sid), false, 'Sitzung serverseitig gelöscht');
  assert.equal((await agent.get('/api/auth/me')).status, 401);
  const replay = await request(app).get('/api/auth/me').set('Cookie', cookie);
  assert.equal(replay.status, 401, 'altes Cookie wird nicht mehr angenommen');
});

// Wartezeit 2,5 s statt knapp über 1 s: connect-pg-simple speichert und vergleicht den Ablauf in
// ganzen Sekunden (aufgerundet), eine Sitzung mit 1 s Timeout lebt daher bis zu knapp 2 s.
test('Leerlauf-Timeout (SESSION_IDLE_SECONDS=1): nach 2,5 s ohne Anfrage → 401', async () => {
  const shortApp = newApp({ SESSION_IDLE_SECONDS: '1' });
  const { agent, res, cookie } = await login(shortApp);
  assert.equal(res.status, 200);
  assert.equal((await agent.get('/api/auth/me')).status, 200);
  await sleep(2500);
  // Cookie direkt senden: der Agent würde das im Browser abgelaufene Cookie selbst verwerfen –
  // geprüft wird hier, dass auch der Server die Sitzung nicht mehr annimmt.
  const late = await request(shortApp).get('/api/auth/me').set('Cookie', cookie);
  assert.equal(late.status, 401);
  assert.deepEqual(late.body, UNAUTHENTICATED_BODY);
});

test('Jede Anfrage verlängert das Leerlauf-Timeout (rollierend)', async () => {
  const shortApp = newApp({ SESSION_IDLE_SECONDS: '2' });
  const { cookie } = await login(shortApp);
  for (let i = 0; i < 3; i += 1) {
    await sleep(1000);
    const res = await request(shortApp).get('/api/auth/me').set('Cookie', cookie);
    assert.equal(res.status, 200, `Anfrage ${i + 1} nach insgesamt ${i + 1} s`);
  }
});

test('Absolutes Timeout (SESSION_ABSOLUTE_SECONDS=1): trotz Aktivität nach 1,2 s → 401, Sitzung gelöscht', async () => {
  const shortApp = newApp({ SESSION_ABSOLUTE_SECONDS: '1' });
  const { res, cookie } = await login(shortApp);
  const sid = sessionIdFrom(res);
  assert.equal((await request(shortApp).get('/api/auth/me').set('Cookie', cookie)).status, 200);
  await sleep(1200);
  assert.equal((await request(shortApp).get('/api/auth/me').set('Cookie', cookie)).status, 401);
  assert.equal(await sessionExists(sid), false);
});

test('Während der Sitzung deaktivierter Nutzer → nächste Anfrage 401, Sitzung gelöscht', async () => {
  const user = await createTestUser();
  const { agent, res } = await login(app, user.email, user.password);
  assert.equal(res.status, 200, res.text);
  const sid = sessionIdFrom(res);
  assert.equal((await agent.get('/api/auth/me')).status, 200);
  await query('UPDATE internal_user SET is_active = false WHERE id = $1', [user.id]);
  assert.equal((await agent.get('/api/auth/me')).status, 401);
  assert.equal(await sessionExists(sid), false);
});

test('Öffentliche Routen setzen kein Sitzungs-Cookie', async () => {
  for (const path of ['/api/jobs', '/api/jobs/1', '/api/consent', '/api/health']) {
    const res = await request(app).get(path);
    assert.equal(res.headers['set-cookie'], undefined, path);
  }
});
