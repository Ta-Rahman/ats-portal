// Konfiguration der Anmeldung aus Umgebungsvariablen (docker-compose.yml, Werte aus .env).
// Wird bei createApp() gelesen, damit Tests einzelne Werte (z. B. das Leerlauf-Timeout) für eine
// eigene App-Instanz verkürzen können. Fehlende oder ungültige Werte → Start bricht ab.

function positiveInt(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  if (!/^[1-9][0-9]*$/.test(raw)) throw new Error(`${name} muss eine positive ganze Zahl sein`);
  return Number(raw);
}

function bool(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  if (raw !== 'true' && raw !== 'false') throw new Error(`${name} muss "true" oder "false" sein`);
  return raw === 'true';
}

// Rate-Limit als "Anzahl/Sekunden", z. B. "20/60" = 20 Anfragen je 60 Sekunden.
function rateLimit(env, name, fallback) {
  const raw = env[name] || fallback;
  const match = /^([1-9][0-9]*)\/([1-9][0-9]*)$/.exec(raw);
  if (!match) throw new Error(`${name} muss "Anzahl/Sekunden" sein, z. B. 20/60`);
  return { max: Number(match[1]), windowSeconds: Number(match[2]) };
}

// Löschlauf (Iteration 4): Uhrzeit des täglichen Laufs in UTC ("HH:MM" oder "off") und Schonfrist für
// verwaiste Dateien. Eigene Funktion, weil auch die CLI sie braucht (ohne Sitzungs-Einstellungen).
const RUN_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function loadDeletionConfig(env = process.env) {
  const runTime = env.DELETION_RUN_TIME || '03:30';
  if (runTime !== 'off' && !RUN_TIME_PATTERN.test(runTime)) {
    throw new Error('DELETION_RUN_TIME muss "HH:MM" (UTC) oder "off" sein');
  }
  return {
    runTime,
    orphanGraceSeconds: positiveInt(env, 'DELETION_ORPHAN_GRACE_SECONDS', 60 * 60),
  };
}

export function loadConfig(env = process.env) {
  const sessionSecret = env.SESSION_SECRET;
  if (!sessionSecret || sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET fehlt oder ist kürzer als 32 Zeichen (siehe .env.example)');
  }
  return {
    sessionSecret,
    // Secure-Flag des Sitzungs-Cookies: lokal (http) aus, in Produktion (https) an.
    cookieSecure: bool(env, 'COOKIE_SECURE', false),
    // Leerlauf-Timeout: ohne Anfrage läuft die Sitzung nach dieser Zeit ab (Standard 30 min).
    sessionIdleSeconds: positiveInt(env, 'SESSION_IDLE_SECONDS', 30 * 60),
    // Absolutes Timeout ab Anmeldung, auch bei laufender Nutzung (Standard 8 h).
    sessionAbsoluteSeconds: positiveInt(env, 'SESSION_ABSOLUTE_SECONDS', 8 * 60 * 60),
    // Abstand, in dem abgelaufene Sitzungen aus der Tabelle gelöscht werden; 0 = aus (Tests).
    sessionPruneSeconds: env.SESSION_PRUNE_SECONDS === '0' ? 0 : positiveInt(env, 'SESSION_PRUNE_SECONDS', 15 * 60),
    // Zugriffsprotokoll (Iteration 4): eine Zeile je Anfrage ohne personenbezogene Daten
    requestLog: bool(env, 'REQUEST_LOG', true),
    // Rate-Limits (Iteration 4), je "Anzahl/Sekunden"
    rateLimits: {
      loginIp: rateLimit(env, 'RATE_LIMIT_LOGIN_IP', '20/60'),
      loginAccount: rateLimit(env, 'RATE_LIMIT_LOGIN_ACCOUNT', '10/900'),
      apply: rateLimit(env, 'RATE_LIMIT_APPLY', '10/3600'),
      status: rateLimit(env, 'RATE_LIMIT_STATUS', '30/60'),
      withdraw: rateLimit(env, 'RATE_LIMIT_WITHDRAW', '10/900'),
    },
  };
}
