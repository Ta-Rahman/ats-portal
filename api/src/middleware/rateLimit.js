// Rate-Limits (Konzept P3) mit express-rate-limit: zählt Anfragen je Schlüssel in einem Zeitfenster
// und antwortet ab dem Limit mit 429, Retry-After und RateLimit-Headern. Speicher: im Prozess (eine
// API-Instanz; bei mehreren Instanzen bräuchte es einen gemeinsamen Speicher, ein Neustart setzt die
// Zähler zurück).
//
// Schlüssel ist die Client-IP aus req.ip. Hinter nginx (trust proxy 1) ist das der letzte Eintrag in
// X-Forwarded-For – den hängt nginx selbst an ($proxy_add_x_forwarded_for); vom Client gesendete
// Einträge stehen davor und ändern den Schlüssel nicht. Die API ist nur über nginx erreichbar.
import { createHash } from 'node:crypto';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { HttpError } from '../errors.js';

// 429-Antwort. Die Limits laufen vor den Routern (die sonst Cache-Control: no-store setzen), deshalb
// den Header hier setzen: Auch die Fehlermeldung zu Status-Link, Rückzug, Bewerbung und Anmeldung soll
// weder im Browser noch in einem Proxy zwischengespeichert werden.
function tooMany(req, res, next, options) {
  res.set('Cache-Control', 'no-store');
  const resetMs = req.rateLimit?.resetTime ? req.rateLimit.resetTime.getTime() - Date.now() : options.windowMs;
  const minutes = Math.max(1, Math.ceil(resetMs / 60_000));
  next(new HttpError(429, 'RATE_LIMITED',
    `Zu viele Anfragen. Bitte versuchen Sie es in ${minutes} ${minutes === 1 ? 'Minute' : 'Minuten'} erneut.`));
}

function limiter(identifier, { max, windowSeconds }, extra = {}) {
  return rateLimit({
    identifier, // Name im Header RateLimit-Policy
    limit: max,
    windowMs: windowSeconds * 1000,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: tooMany,
    ...extra,
  });
}

// Für das Anmeldelimit je Konto: IP + Hash der E-Mail-Adresse (die Adresse selbst liegt so nicht
// im Speicher). Groß-/Kleinschreibung wie beim Login egal.
function ipAndEmail(req) {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const emailHash = createHash('sha256').update(email, 'utf8').digest('hex').slice(0, 32);
  return `${ipKeyGenerator(req.ip)}|${emailHash}`;
}

// limits: Konfiguration aus config.js ({ loginIp: {max, windowSeconds}, … })
export function createRateLimits(limits) {
  return {
    // alle Anmeldeversuche je IP (Konzept P3: 20 pro Minute)
    loginIp: limiter('anmeldung-ip', limits.loginIp),
    // nur fehlgeschlagene Versuche je IP + Konto: bremst das Raten eines Passworts, ohne dass Fremde
    // das Konto für die echte Person sperren können (anderer Schlüssel je IP)
    loginAccount: limiter('anmeldung-konto', limits.loginAccount, {
      keyGenerator: ipAndEmail,
      skipSuccessfulRequests: true,
    }),
    apply: limiter('bewerbung', limits.apply),
    status: limiter('status', limits.status),
    withdraw: limiter('rueckzug', limits.withdraw),
  };
}
