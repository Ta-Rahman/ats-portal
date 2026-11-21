// Zugriffsschutz für /api/admin/**: jede Route ohne Sitzung → 401 (Tabelle, gegen den Router
// geprüft), CSRF-Token bei zustandsändernden Anfragen, requireRole → 403 (Unit-Test).
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool, query } from '../src/db.js';
import { createAdminRouter } from '../src/routes/admin.routes.js';
import { requireRole } from '../src/middleware/auth.js';
import { HttpError } from '../src/errors.js';
import { TEST_JOB_PREFIX, cleanupJobs, cleanupSessions, login, testEnv } from './helpers.js';

const app = createApp(testEnv());

afterEach(async () => {
  await cleanupJobs();
  await cleanupSessions();
});

after(async () => {
  await app.locals.sessionStore.close();
  await pool.end();
});

// Alle Routen des Admin-Routers (Methode, Pfad relativ zu /api/admin). Muss genau den im Router
// registrierten Routen entsprechen – geprüft im ersten Test.
const ADMIN_ROUTES = [
  ['GET', '/jobs'],
  ['POST', '/jobs'],
  ['GET', '/jobs/:id'],
  ['PATCH', '/jobs/:id'],
  ['POST', '/jobs/:id/publish'],
  ['POST', '/jobs/:id/close'],
  ['GET', '/jobs/:id/applications'],
  ['GET', '/applications/:id'],
  ['PUT', '/applications/:id/rating'],
  ['POST', '/applications/:id/stage'],
  ['POST', '/applications/:id/notes'],
  ['GET', '/attachments/:id'],
  // nur Admin (Iteration 4)
  ['GET', '/users'],
  ['POST', '/users'],
  ['PUT', '/users/:id/role'],
  ['POST', '/users/:id/deactivate'],
  ['POST', '/users/:id/activate'],
  ['GET', '/deletion-log'],
];

const key = ([method, path]) => `${method} ${path}`;
// Beispiel-ID: 1 für die 401-Tabelle; für die CSRF-Tabelle eine nicht vorhandene ID, damit selbst
// eine fehlerhafte CSRF-Prüfung keine Seed-Daten ändern könnte (sie bekäme dann 404 statt 403).
const concrete = (path, id = '1') => `/api/admin${path.replace(':id', id)}`;
const MISSING_ID = '2147483647';
const STATE_CHANGING = ADMIN_ROUTES.filter(([method]) => method !== 'GET');

// Gültige Beispiel-Bodys, damit ein fehlender CSRF-Token nicht von einer Validierung verdeckt wird.
const SAMPLE_BODY = {
  'POST /jobs': { title: `${TEST_JOB_PREFIX}CSRF`, location: 'Testort', employment_type: 'full_time', description: 'x' },
  'PATCH /jobs/:id': { location: 'Testort' },
  'PUT /applications/:id/rating': { rating: 3 },
  'POST /applications/:id/stage': { to_stage: 'screening' },
  'POST /applications/:id/notes': { body: 'CSRF-Test' },
  'POST /users': {
    email: 'csrf-test@api-test.invalid', display_name: 'CSRF-Test', role: 'recruiter', password: 'lange-Testphrase-ohne-Sinn',
  },
  'PUT /users/:id/role': { role: 'recruiter' },
};

test('Routentabelle entspricht genau den im Admin-Router registrierten Routen', () => {
  const noop = (req, res, next) => next();
  const router = createAdminRouter({ sessionMiddleware: noop, requireAuth: noop });
  const registered = router.stack
    .filter((layer) => layer.route)
    .flatMap((layer) => Object.keys(layer.route.methods)
      .filter((m) => m !== '_all')
      .map((m) => `${m.toUpperCase()} ${layer.route.path}`));
  assert.deepEqual([...registered].sort(), ADMIN_ROUTES.map(key).sort());
});

for (const route of ADMIN_ROUTES) {
  test(`Ohne Sitzung: ${key(route)} → 401`, async () => {
    const [method, path] = route;
    const res = await request(app)[method.toLowerCase()](concrete(path)).send(SAMPLE_BODY[key(route)]);
    assert.equal(res.status, 401, res.text);
    assert.deepEqual(res.body, { error: { code: 'UNAUTHENTICATED', message: 'Bitte melden Sie sich an.' } });
    assert.equal(res.headers['cache-control'], 'no-store');
    console.log(`Admin-Route ohne Sitzung: ${method.padEnd(5)} /api/admin${path} → ${res.status}`);
  });
}

test('Unbekannter Pfad unter /api/admin: ohne Sitzung 401, mit Sitzung 404', async () => {
  assert.equal((await request(app).get('/api/admin/gibt-es-nicht')).status, 401);
  const { agent } = await login(app);
  assert.equal((await agent.get('/api/admin/gibt-es-nicht')).status, 404);
});

test('Ohne Sitzung, aber mit fehlerhaftem JSON → 401 (Prüfung vor dem Lesen des Bodys)', async () => {
  const res = await request(app).post('/api/admin/jobs').set('Content-Type', 'application/json').send('{kaputt');
  assert.equal(res.status, 401);
});

// --- CSRF -------------------------------------------------------------------------------------

for (const route of STATE_CHANGING) {
  test(`Mit Sitzung, ohne CSRF-Token: ${key(route)} → 403`, async () => {
    const [method, path] = route;
    const { agent } = await login(app);
    const res = await agent[method.toLowerCase()](concrete(path, MISSING_ID)).send(SAMPLE_BODY[key(route)]);
    assert.equal(res.status, 403, res.text);
    assert.equal(res.body.error.code, 'CSRF_INVALID');
  });
}

test('CSRF: falscher Token und Token einer anderen Sitzung → 403, nichts angelegt; richtiger Token → 201', async () => {
  const body = SAMPLE_BODY['POST /jobs'];
  const a = await login(app);
  const b = await login(app);
  const wrong = await a.agent.post('/api/admin/jobs').set('X-CSRF-Token', 'A'.repeat(43)).send(body);
  assert.equal(wrong.status, 403);
  const foreign = await a.agent.post('/api/admin/jobs').set('X-CSRF-Token', b.csrf).send(body);
  assert.equal(foreign.status, 403);
  const { rows } = await query('SELECT count(*)::int AS n FROM job WHERE title = $1', [body.title]);
  assert.equal(rows[0].n, 0, 'abgelehnte Anfragen haben nichts angelegt');

  const ok = await a.agent.post('/api/admin/jobs').set('X-CSRF-Token', a.csrf).send(body);
  assert.equal(ok.status, 201, ok.text);
});

test('CSRF: lesende Anfragen (GET) brauchen keinen Token', async () => {
  const { agent } = await login(app);
  const res = await agent.get('/api/admin/jobs');
  assert.equal(res.status, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
});

// --- Rollen -----------------------------------------------------------------------------------

test('requireRole: passende Rolle → next(), andere oder fehlende Rolle → 403', () => {
  const run = (user, ...roles) => {
    let arg = 'nicht aufgerufen';
    requireRole(...roles)({ user }, {}, (err) => { arg = err; });
    return arg;
  };
  assert.equal(run({ role: 'admin' }, 'admin'), undefined);
  assert.equal(run({ role: 'recruiter' }, 'recruiter', 'admin'), undefined);
  for (const err of [run({ role: 'recruiter' }, 'admin'), run(undefined, 'admin')]) {
    assert.ok(err instanceof HttpError);
    assert.equal(err.status, 403);
    assert.equal(err.code, 'FORBIDDEN');
  }
});

// --- Nur Admin (Iteration 4): Nutzerverwaltung und Löschprotokoll --------------------------------

const ADMIN_ONLY_ROUTES = [
  ['GET', '/users'],
  ['POST', '/users'],
  ['PUT', '/users/:id/role'],
  ['POST', '/users/:id/deactivate'],
  ['POST', '/users/:id/activate'],
  ['GET', '/deletion-log'],
];

test('Nur-Admin-Tabelle entspricht genau den Routen mit requireRole("admin") im Admin-Router', () => {
  const noop = (req, res, next) => next();
  const router = createAdminRouter({ sessionMiddleware: noop, requireAuth: noop });
  const adminOnly = router.stack
    .filter((layer) => layer.route?.stack.some((l) => l.handle.roles?.length === 1 && l.handle.roles[0] === 'admin'))
    .flatMap((layer) => Object.keys(layer.route.methods)
      .filter((m) => m !== '_all')
      .map((m) => `${m.toUpperCase()} ${layer.route.path}`));
  assert.deepEqual([...adminOnly].sort(), ADMIN_ONLY_ROUTES.map(key).sort());
});

for (const route of ADMIN_ONLY_ROUTES) {
  test(`Recruiter mit Sitzung und CSRF-Token: ${key(route)} → 403`, async () => {
    const [method, path] = route;
    const { agent, csrf } = await login(app);
    const res = await agent[method.toLowerCase()](concrete(path, MISSING_ID))
      .set('X-CSRF-Token', csrf).send(SAMPLE_BODY[key(route)]);
    assert.equal(res.status, 403, res.text);
    assert.deepEqual(res.body, {
      error: { code: 'FORBIDDEN', message: 'Für diese Aktion fehlt Ihnen die Berechtigung.' },
    });
    console.log(`Nur-Admin-Route als Recruiter: ${method.padEnd(5)} /api/admin${path} → ${res.status}`);
  });
}

test('Admin erreicht dieselben Routen (kein 403; ungültiger Body → 400, fehlende ID → 404)', async () => {
  const { agent, csrf } = await login(app, 'admin@muster-it.example');
  const expected = { 'GET /users': 200, 'POST /users': 400, 'GET /deletion-log': 200 };
  for (const route of ADMIN_ONLY_ROUTES) {
    const [method, path] = route;
    const body = key(route) === 'PUT /users/:id/role' ? { role: 'recruiter' } : {};
    const res = await agent[method.toLowerCase()](concrete(path, MISSING_ID)).set('X-CSRF-Token', csrf).send(body);
    assert.equal(res.status, expected[key(route)] ?? 404, `${key(route)}: ${res.text}`);
  }
});

test('Recruiter und Admin haben Zugriff auf den internen Bereich', async () => {
  for (const email of ['recruiting@muster-it.example', 'admin@muster-it.example']) {
    const { agent } = await login(app, email);
    assert.equal((await agent.get('/api/admin/jobs')).status, 200, email);
  }
});
