// Zugriffsschutz für /api/admin/** und Abmelden:
//   requireAuth  – gültige Sitzung eines aktiven Nutzers, sonst 401
//   requireRole  – Rolle aus der Liste, sonst 403
//   requireCsrf  – zustandsändernde Anfrage trägt den CSRF-Token der Sitzung, sonst 403
// Reihenfolge im Router: requireAuth → requireRole → requireCsrf (ohne Sitzung immer 401).
import { randomBytes, timingSafeEqual } from 'node:crypto';
import * as usersRepository from '../repositories/users.repository.js';
import { destroySession } from '../session.js';
import { HttpError } from '../errors.js';

export const UNAUTHENTICATED_MESSAGE = 'Bitte melden Sie sich an.';

const unauthenticated = () => new HttpError(401, 'UNAUTHENTICATED', UNAUTHENTICATED_MESSAGE);

// Synchronizer-Token: Zufallswert, der nur in der serverseitigen Sitzung liegt. Die SPA bekommt
// ihn bei der Anmeldung bzw. über GET /api/auth/me und schickt ihn als Header X-CSRF-Token mit.
// Eine fremde Seite kann zwar das Cookie mitsenden lassen, kennt aber den Token nicht.
export const CSRF_HEADER = 'X-CSRF-Token';

export function newCsrfToken() {
  return randomBytes(32).toString('base64url');
}

// Sitzung prüfen: angemeldet, absolutes Timeout nicht überschritten, Nutzer noch aktiv.
// Rolle und Aktiv-Status werden bei jeder Anfrage aus der Datenbank gelesen, damit eine
// Deaktivierung sofort wirkt (nicht erst nach dem Abmelden).
export function createRequireAuth(config) {
  return async function requireAuth(req, res, next) {
    const s = req.session;
    if (!s?.userId) return next(unauthenticated());
    if (!Number.isFinite(s.loginAt) || Date.now() - s.loginAt > config.sessionAbsoluteSeconds * 1000) {
      await destroySession(req);
      return next(unauthenticated());
    }
    const user = await usersRepository.findActiveById(s.userId);
    if (!user) {
      await destroySession(req);
      return next(unauthenticated());
    }
    req.user = user;
    return next();
  };
}

export function requireRole(...roles) {
  function checkRole(req, res, next) {
    if (req.user && roles.includes(req.user.role)) return next();
    return next(new HttpError(403, 'FORBIDDEN', 'Für diese Aktion fehlt Ihnen die Berechtigung.'));
  }
  // Lesbar für den Test, der die Admin-Routen im Router-Stack findet (authorization.test.js).
  checkRole.roles = roles;
  return checkRole;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function requireCsrf(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const sent = req.get(CSRF_HEADER);
  const expected = req.session?.csrfToken;
  if (typeof sent === 'string' && typeof expected === 'string') {
    const a = Buffer.from(sent);
    const b = Buffer.from(expected);
    // Vergleich in konstanter Zeit (gleiche Länge ist Voraussetzung für timingSafeEqual).
    if (a.length === b.length && timingSafeEqual(a, b)) return next();
  }
  return next(new HttpError(403, 'CSRF_INVALID',
    'Die Anfrage konnte nicht bestätigt werden. Bitte laden Sie die Seite neu und versuchen Sie es erneut.'));
}

// Antworten mit internen bzw. personenbezogenen Daten nicht zwischenspeichern.
export function noStore(req, res, next) {
  res.set('Cache-Control', 'no-store');
  next();
}
