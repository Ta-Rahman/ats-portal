// Sicherheitsbezogene Tests: keine Stacktraces in Fehlerantworten, Security-Header von helmet.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { testEnv } from './helpers.js';
import { errorHandler } from '../src/middleware/errorHandler.js';

const app = createApp(testEnv());
after(() => pool.end());

// Merkmale eines Stacktraces bzw. interner Pfade
const LEAK_PATTERN = /stack|\bat\s+\S+\s+\(|node_modules|\/app\/src|\.js:\d+/i;

test('Fehlerantworten (400, 404) enthalten keinen Stacktrace', async () => {
  for (const path of ['/api/jobs/abc', '/api/jobs?employment_type=x', '/api/jobs/2147483647', '/api/gibt-es-nicht']) {
    const res = await request(app).get(path);
    assert.ok(res.status === 400 || res.status === 404, `${path}: Status ${res.status}`);
    assert.doesNotMatch(res.text, LEAK_PATTERN, `${path}: interne Details in der Antwort`);
  }
});

test('Unerwarteter Fehler → 500 mit allgemeiner Meldung, ohne Stacktrace und Fehlertext', (t) => {
  t.mock.method(console, 'error', () => {}); // Server-Log im Testlauf unterdrücken
  const res = {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  const err = new Error('relation "geheim" does not exist');
  errorHandler(err, {}, res, () => {});

  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { error: { code: 'INTERNAL_ERROR', message: 'Interner Serverfehler' } });
  const text = JSON.stringify(res.body);
  assert.doesNotMatch(text, /geheim/);
  assert.doesNotMatch(text, LEAK_PATTERN);
  assert.equal(console.error.mock.callCount(), 1, 'Fehler wird serverseitig protokolliert');
});

test('Unbekannte API-Route → 404 als JSON', async () => {
  const res = await request(app).get('/api/gibt-es-nicht');
  assert.equal(res.status, 404);
  assert.match(res.headers['content-type'], /application\/json/);
  assert.equal(res.body.error.code, 'NOT_FOUND');
});

// Policy der API (api/src/app.js): nichts laden, nicht einbettbar.
const API_CSP = "default-src 'none';frame-ancestors 'none';base-uri 'none';form-action 'none'";

function assertSecurityHeaders(res) {
  const h = res.headers;
  assert.equal(h['content-security-policy'], API_CSP);
  assert.doesNotMatch(h['content-security-policy'], /unsafe-inline|unsafe-eval/);
  assert.equal(h['x-content-type-options'], 'nosniff');
  assert.equal(h['x-frame-options'], 'DENY');
  assert.match(h['strict-transport-security'] ?? '', /max-age=\d+/);
  assert.equal(h['referrer-policy'], 'no-referrer');
  assert.equal(h['x-powered-by'], undefined);
}

test('Security-Header von helmet bei erfolgreicher Antwort', async () => {
  const res = await request(app).get('/api/jobs');
  assert.equal(res.status, 200);
  assertSecurityHeaders(res);
});

test('Security-Header von helmet auch bei Fehlerantwort', async () => {
  const res = await request(app).get('/api/jobs/abc');
  assert.equal(res.status, 400);
  assertSecurityHeaders(res);
});
