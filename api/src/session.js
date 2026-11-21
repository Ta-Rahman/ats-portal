// Serverseitige Sitzung für interne Nutzer: express-session erzeugt die zufällige Sitzungs-ID,
// signiert das Cookie und lädt/speichert die Sitzung je Anfrage; connect-pg-simple legt die
// Sitzungen in der Tabelle session_store.session ab (db/init/01a_sitzung.sql), über den
// gemeinsamen Verbindungspool. Eingebunden wird die Middleware nur für /api/auth und /api/admin –
// die öffentlichen Routen und der Status-Link setzen und lesen nie ein Cookie.
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { pool } from './db.js';

export const SESSION_COOKIE = 'ats.sid';

const PgStore = connectPgSimple(session);

// Cookie-Optionen; clearCookie() beim Abmelden braucht dieselben Werte (ohne maxAge).
export function cookieOptions(config) {
  return { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, path: '/' };
}

export function createSession(config) {
  const store = new PgStore({
    pool,
    schemaName: 'session_store',
    tableName: 'session',
    createTableIfMissing: false, // Tabelle kommt aus den Init-Skripten
    pruneSessionInterval: config.sessionPruneSeconds || false,
  });
  const middleware = session({
    name: SESSION_COOKIE,
    secret: config.sessionSecret,
    store,
    resave: false,
    saveUninitialized: false, // Cookie und Tabellenzeile erst nach erfolgreicher Anmeldung
    rolling: true, // jede Anfrage verlängert das Leerlauf-Timeout (Cookie und Ablauf in der DB)
    unset: 'destroy',
    cookie: { ...cookieOptions(config), maxAge: config.sessionIdleSeconds * 1000 },
  });
  return { middleware, store };
}

// Promise-Varianten der Callback-Methoden von express-session.
export const regenerateSession = (req) =>
  new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
export const saveSession = (req) =>
  new Promise((resolve, reject) => req.session.save((err) => (err ? reject(err) : resolve())));
export const destroySession = (req) =>
  new Promise((resolve, reject) => req.session.destroy((err) => (err ? reject(err) : resolve())));
