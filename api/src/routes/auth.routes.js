// Anmeldung interner Nutzer:
//   POST /api/auth/login   {email, password} → {user, csrf_token} + Sitzungs-Cookie
//   POST /api/auth/logout  (Sitzung + CSRF-Token) → 204, Sitzung serverseitig gelöscht
//   GET  /api/auth/me      (Sitzung) → {user, csrf_token}
// Die Anmeldung selbst braucht keinen CSRF-Token: Es gibt noch keine Sitzung, und der Body wird
// nur als application/json angenommen – das kann ein fremdes HTML-Formular nicht senden.
import express, { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { noStore, newCsrfToken, requireCsrf } from '../middleware/auth.js';
import { SESSION_COOKIE, cookieOptions, destroySession, regenerateSession, saveSession } from '../session.js';
import * as authService from '../services/auth.service.js';
import { HttpError } from '../errors.js';

export const HTTPS_REQUIRED_MESSAGE =
  'Die Anmeldung ist nur über HTTPS möglich. Bitte rufen Sie die Seite mit https:// auf.';

const loginSchema = z.strictObject({
  email: z
    .string({ error: 'Bitte geben Sie Ihre E-Mail-Adresse an.' })
    .trim()
    .min(1, 'Bitte geben Sie Ihre E-Mail-Adresse an.')
    .max(254, 'Die E-Mail-Adresse darf höchstens 254 Zeichen lang sein.'),
  password: z
    .string({ error: 'Bitte geben Sie Ihr Passwort an.' })
    .min(1, 'Bitte geben Sie Ihr Passwort an.')
    .max(200, 'Das Passwort darf höchstens 200 Zeichen lang sein.'),
});

export function createAuthRouter({ config, sessionMiddleware, requireAuth, loginAccountLimit }) {
  const router = Router();
  router.use(noStore, express.json({ limit: '10kb' }), sessionMiddleware);

  // COOKIE_SECURE=true: Der Browser verwirft ein Secure-Cookie, das über http ankommt – die Anmeldung
  // schiene zu klappen, die nächste Anfrage käme aber ohne Sitzung (und im Store bliebe eine verwaiste
  // Zeile). Deshalb ausdrücklich ablehnen, bevor Passwort geprüft oder Sitzung angelegt wird.
  // req.secure stimmt hinter nginx über X-Forwarded-Proto (trust proxy 1, app.js).
  function requireHttpsForSecureCookie(req, res, next) {
    if (config.cookieSecure && !req.secure) {
      console.warn('[auth] Anmeldung abgelehnt: COOKIE_SECURE=true, Anfrage kam nicht über HTTPS');
      return next(new HttpError(403, 'HTTPS_REQUIRED', HTTPS_REQUIRED_MESSAGE));
    }
    return next();
  }

  // loginAccountLimit: fehlgeschlagene Anmeldungen je IP + E-Mail (middleware/rateLimit.js)
  router.post('/login', requireHttpsForSecureCookie, loginAccountLimit, validate({ body: loginSchema }), async (req, res) => {
    const { email, password } = req.validated.body;
    const user = await authService.authenticate(email, password);
    // Neue Sitzungs-ID bei jeder Anmeldung (Schutz vor Session Fixation); eine vorhandene
    // Sitzung wird dabei aus dem Store gelöscht.
    await regenerateSession(req);
    req.session.userId = user.id;
    req.session.csrfToken = newCsrfToken();
    req.session.loginAt = Date.now();
    await saveSession(req);
    res.json({ user, csrf_token: req.session.csrfToken });
  });

  router.post('/logout', requireAuth, requireCsrf, async (req, res) => {
    await destroySession(req);
    res.clearCookie(SESSION_COOKIE, cookieOptions(config));
    res.status(204).end();
  });

  router.get('/me', requireAuth, (req, res) => {
    res.json({ user: authService.toPublicUser(req.user), csrf_token: req.session.csrfToken });
  });

  return router;
}
