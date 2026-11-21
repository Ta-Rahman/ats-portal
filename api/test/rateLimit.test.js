// Rate-Limits (Konzept P3): N+1-te Anfrage → 429 mit Retry-After und deutscher Meldung, andere
// Routen unberührt, Schlüssel nicht über X-Forwarded-For fälschbar. Jeder Test baut eine eigene
// App-Instanz mit niedrigen Limits (eigene Zähler im Speicher).
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { pool } from '../src/db.js';
import {
  ADMIN_EMAIL, RECRUITER_EMAIL, SEED_PASSWORD, cleanup, cleanupSessions, postApplication, publishedJobId,
  sessionIdFrom, testEnv, uploadFiles, validFields,
} from './helpers.js';

const apps = [];
function appWith(overrides) {
  const app = createApp(testEnv(overrides));
  apps.push(app);
  return app;
}

afterEach(async () => {
  await cleanup();
  await cleanupSessions();
});

after(async () => {
  for (const app of apps) await app.locals.sessionStore.close();
  await pool.end();
});

const unknownToken = () => randomBytes(32).toString('base64url');
const MESSAGE = /^Zu viele Anfragen\. Bitte versuchen Sie es in \d+ Minuten? erneut\.$/;

function assertLimited(res, windowSeconds) {
  assert.equal(res.status, 429, res.text);
  assert.equal(res.body.error.code, 'RATE_LIMITED');
  assert.match(res.body.error.message, MESSAGE);
  const retryAfter = Number(res.headers['retry-after']);
  assert.ok(retryAfter > 0 && retryAfter <= windowSeconds, `Retry-After ${res.headers['retry-after']}`);
  assert.ok(res.headers['ratelimit-policy'], 'RateLimit-Policy gesetzt');
  assert.equal(res.headers['cache-control'], 'no-store', 'Cache-Control der 429-Antwort');
}

test('Status-Link: 3 Abrufe erlaubt, der 4. → 429 mit Retry-After; Stellenliste und Rückzug unberührt', async () => {
  const app = appWith({ RATE_LIMIT_STATUS: '3/60' });
  for (let i = 0; i < 3; i += 1) assert.equal((await request(app).get(`/api/status/${unknownToken()}`)).status, 404);
  const limited = await request(app).get(`/api/status/${unknownToken()}`);
  assertLimited(limited, 60);
  console.log(`429 Status-Link: Retry-After ${limited.headers['retry-after']}, ${limited.body.error.message}`);
  assert.equal((await request(app).get('/api/jobs')).status, 200);
  assert.equal((await request(app).post(`/api/status/${unknownToken()}/withdraw`)).status, 404, 'eigenes Limit');
});

// So sieht der Header hinter nginx aus: vom Client gesendeter Teil, dahinter die von nginx angehängte
// Adresse des Clients ($proxy_add_x_forwarded_for). Mit trust proxy 1 zählt nur der letzte Eintrag.
test('Gefälschtes X-Forwarded-For (Client-Teil wechselt) setzt das Limit nicht zurück', async () => {
  const app = appWith({ RATE_LIMIT_STATUS: '3/60' });
  const viaNginx = (clientPart) => request(app).get(`/api/status/${unknownToken()}`)
    .set('X-Forwarded-For', `${clientPart}, 10.9.8.7`);
  for (const spoof of ['1.1.1.1', '2.2.2.2', '3.3.3.3']) assert.equal((await viaNginx(spoof)).status, 404);
  assert.equal((await viaNginx('4.4.4.4')).status, 429);
  assert.equal((await viaNginx(`5.5.5.5, 6.6.6.6`)).status, 429, 'auch mit mehreren vorgetäuschten Einträgen');
  // Gegenprobe: ein anderer Client (andere von nginx angehängte Adresse) hat einen eigenen Zähler.
  const otherClient = await request(app).get(`/api/status/${unknownToken()}`).set('X-Forwarded-For', '10.9.8.8');
  assert.equal(otherClient.status, 404);
});

test('Anmeldung je IP: 3 Versuche, der 4. → 429 (auch mit richtigem Passwort); Stellenliste unberührt', async () => {
  const app = appWith({ RATE_LIMIT_LOGIN_IP: '3/60' });
  for (let i = 0; i < 3; i += 1) {
    const res = await request(app).post('/api/auth/login').send({ email: RECRUITER_EMAIL, password: 'falsch-falsch' });
    assert.equal(res.status, 401);
  }
  const limited = await request(app).post('/api/auth/login').send({ email: RECRUITER_EMAIL, password: SEED_PASSWORD });
  assertLimited(limited, 60);
  assert.equal(sessionIdFrom(limited), null, 'keine Sitzung');
  assert.equal((await request(app).get('/api/jobs')).status, 200);
});

test('Anmeldung je IP + E-Mail: nur Fehlversuche zählen; anderes Konto nicht betroffen; E-Mail ohne Groß/klein', async () => {
  const app = appWith({ RATE_LIMIT_LOGIN_ACCOUNT: '2/60' });
  const loginAs = (email, password) => request(app).post('/api/auth/login').send({ email, password });
  for (let i = 0; i < 3; i += 1) {
    const ok = await loginAs(RECRUITER_EMAIL, SEED_PASSWORD);
    assert.equal(ok.status, 200, 'erfolgreiche Anmeldungen zählen nicht');
    sessionIdFrom(ok);
  }
  assert.equal((await loginAs(RECRUITER_EMAIL, 'falsch-1')).status, 401);
  assert.equal((await loginAs(RECRUITER_EMAIL.toUpperCase(), 'falsch-2')).status, 401);
  assertLimited(await loginAs(` ${RECRUITER_EMAIL} `, SEED_PASSWORD), 60);
  const other = await loginAs(ADMIN_EMAIL, SEED_PASSWORD);
  assert.equal(other.status, 200, 'anderes Konto von derselben IP');
  sessionIdFrom(other);
});

test('Bewerbung: 2 erlaubt, die 3. → 429, bevor die Datei gelesen oder gespeichert wird', async () => {
  const app = appWith({ RATE_LIMIT_APPLY: '2/3600' });
  const jobId = await publishedJobId();
  const filesBefore = (await uploadFiles()).length;
  for (let i = 0; i < 2; i += 1) assert.equal((await postApplication(app, jobId, validFields())).status, 201);
  const limited = await postApplication(app, jobId, validFields());
  assertLimited(limited, 3600);
  assert.equal((await uploadFiles()).length, filesBefore + 2, 'keine dritte Datei im Volume');
});

test('Rückzug: 1 erlaubt, der 2. → 429 (vor der fachlichen Prüfung, sonst 409)', async () => {
  const app = appWith({ RATE_LIMIT_WITHDRAW: '1/60' });
  const submitted = await postApplication(app, await publishedJobId(), validFields());
  assert.equal((await request(app).post(`/api/status/${submitted.body.token}/withdraw`)).status, 200);
  assertLimited(await request(app).post(`/api/status/${submitted.body.token}/withdraw`), 60);
});

// Die Limits laufen vor den Routern, die sonst Cache-Control: no-store setzen – die 429-Antwort
// bekommt den Header deshalb im Handler des Limits selbst.
test('429 auf Status-Link, Rückzug, Bewerbung und Anmeldung → Cache-Control: no-store', async () => {
  const app = appWith({
    RATE_LIMIT_STATUS: '1/60', RATE_LIMIT_WITHDRAW: '1/60', RATE_LIMIT_APPLY: '1/3600', RATE_LIMIT_LOGIN_IP: '1/60',
  });
  const jobId = await publishedJobId();
  const calls = {
    'GET /api/status/:token': () => request(app).get(`/api/status/${unknownToken()}`),
    'POST /api/status/:token/withdraw': () => request(app).post(`/api/status/${unknownToken()}/withdraw`),
    'POST /api/jobs/:id/applications': () => postApplication(app, jobId, validFields()),
    'POST /api/auth/login': () => request(app).post('/api/auth/login').send({ email: RECRUITER_EMAIL, password: 'falsch' }),
  };
  for (const [route, call] of Object.entries(calls)) {
    await call();
    const limited = await call();
    assert.equal(limited.status, 429, route);
    assert.equal(limited.headers['cache-control'], 'no-store', `${route}: Cache-Control`);
  }
});

test('Konfiguration: ungültiges Format → Start bricht mit Meldung ab', () => {
  for (const bad of ['20', '20/0', '0/60', 'abc', '20/60/1']) {
    assert.throws(() => loadConfig(testEnv({ RATE_LIMIT_STATUS: bad })), /RATE_LIMIT_STATUS muss "Anzahl\/Sekunden"/);
  }
  assert.deepEqual(loadConfig(testEnv({ RATE_LIMIT_STATUS: '30/60' })).rateLimits.status, { max: 30, windowSeconds: 60 });
});
