// Zugriffsprotokoll (REQUEST_LOG): Ein vollständiger Ablauf (Bewerbung → Status → Rückzug →
// Anmeldung → Stufenwechsel) erzeugt Logzeilen ohne Token, E-Mail, Name, Cookie, CSRF-Token und
// Query-String. Die Konsolenausgabe wird abgefangen und erst nach den Prüfungen ausgegeben.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { maskPath } from '../src/middleware/requestLog.js';
import {
  RECRUITER_EMAIL, cleanup, cleanupSessions, findApplicationByToken, login, postApplication, publishedJobId,
  seedUserId, testEnv, validFields,
} from './helpers.js';

const app = createApp(testEnv({ REQUEST_LOG: 'true' }));

after(async () => {
  await cleanup();
  await cleanupSessions();
  await app.locals.sessionStore.close();
  await pool.end();
});

test('maskPath: Token im Pfad maskiert, Query-String entfernt, andere Pfade unverändert', () => {
  const token = 'A'.repeat(43);
  assert.equal(maskPath(`/api/status/${token}`), '/api/status/[token]');
  assert.equal(maskPath(`/api/status/${token}/withdraw`), '/api/status/[token]/withdraw');
  assert.equal(maskPath(`/status/${token}?x=1`), '/status/[token]');
  assert.equal(maskPath('/api/jobs?location=Leipzig&employment_type=full_time'), '/api/jobs');
  assert.equal(maskPath('/api/admin/applications/12/stage'), '/api/admin/applications/12/stage');
});

test('Vollständiger Ablauf: Logzeilen je Schritt, ohne personenbezogene Daten und Geheimnisse', async (t) => {
  const jobId = await publishedJobId();
  const recruiterId = await seedUserId(RECRUITER_EMAIL);
  const fields = validFields({ first_name: 'Vornamelog', last_name: 'Nachnamelog', phone: '+49 000 7777777' });
  const lines = [];
  const logMock = t.mock.method(console, 'log', (...args) => lines.push(args.join(' ')));

  // Bewerbung, Status, Rückzug (Bewerber:in, ohne Konto)
  const submitted = await postApplication(app, jobId, fields);
  assert.equal(submitted.status, 201);
  const { token } = submitted.body;
  assert.equal((await request(app).get(`/api/status/${token}`)).status, 200);
  assert.equal((await request(app).post(`/api/status/${token}/withdraw`)).status, 200);
  assert.equal((await request(app).get('/api/jobs?location=Leipzig')).status, 200);

  // Anmeldung und Stufenwechsel einer zweiten Bewerbung (Recruiter)
  const second = await postApplication(app, jobId, validFields({ first_name: 'Zweitlog', last_name: 'Zweitnachname' }));
  const secondId = (await findApplicationByToken(second.body.token)).id;
  const { agent, csrf, cookie, res: loginRes } = await login(app);
  assert.equal(loginRes.status, 200);
  const stage = await agent.post(`/api/admin/applications/${secondId}/stage`).set('X-CSRF-Token', csrf)
    .send({ to_stage: 'screening', comment: 'Kommentar mit Vornamelog' });
  assert.equal(stage.status, 200);

  await new Promise((resolve) => setImmediate(resolve)); // 'finish' der letzten Antwort abwarten
  logMock.mock.restore();
  const http = lines.filter((l) => l.startsWith('[http] '));

  const expectLine = (pattern) => assert.ok(http.some((l) => pattern.test(l)), `${pattern} fehlt in:\n${http.join('\n')}`);
  expectLine(new RegExp(`^\\[http\\] POST /api/jobs/${jobId}/applications 201 \\d+ms nutzer=-$`));
  expectLine(/^\[http\] GET \/api\/status\/\[token\] 200 \d+ms nutzer=-$/);
  expectLine(/^\[http\] POST \/api\/status\/\[token\]\/withdraw 200 \d+ms nutzer=-$/);
  expectLine(/^\[http\] GET \/api\/jobs 200 \d+ms nutzer=-$/);
  expectLine(new RegExp(`^\\[http\\] POST /api/auth/login 200 \\d+ms nutzer=${recruiterId}$`));
  expectLine(new RegExp(`^\\[http\\] POST /api/admin/applications/${secondId}/stage 200 \\d+ms nutzer=${recruiterId}$`));

  const sid = cookie.split('=')[1];
  const forbidden = {
    'Status-Token': token,
    'zweiter Status-Token': second.body.token,
    Vorname: 'Vornamelog',
    Nachname: 'Nachnamelog',
    'E-Mail Bewerbung': fields.email,
    Telefon: '7777777',
    'E-Mail Recruiter': RECRUITER_EMAIL,
    'Sitzungs-Cookie': 'ats.sid',
    'Sitzungs-ID': sid,
    'CSRF-Token': csrf,
    'Query-String': '?',
    'At-Zeichen': '@',
  };
  for (const line of lines) {
    for (const [label, value] of Object.entries(forbidden)) {
      assert.ok(!line.includes(value), `${label} im Log: ${line}`);
    }
  }
  console.log(`Zugriffsprotokoll des Ablaufs (${http.length} Zeilen):\n${http.join('\n')}`);
});
