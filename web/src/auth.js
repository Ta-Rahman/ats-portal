// Anmeldestatus der SPA: angemeldeter Nutzer und CSRF-Token der Sitzung (nur im Speicher; das
// Sitzungs-Cookie ist HttpOnly und für JavaScript unsichtbar). Nach Neuladen holt der Router-Guard
// beides über GET /api/auth/me.
import { reactive } from 'vue';
import { ApiError, apiLogin, apiLogout, apiMe, setCsrfToken } from './api.js';

export const auth = reactive({ user: null, checked: false });

const DEFAULT_TARGET = '/intern/stellen';

function setSession(body) {
  auth.user = body.user;
  setCsrfToken(body.csrf_token);
}

export function clearSession() {
  auth.user = null;
  setCsrfToken(null);
}

// Prüft die Sitzung beim Server; ohne Sitzung (401) oder bei Netzwerkfehler gilt: nicht angemeldet.
export async function loadMe() {
  try {
    setSession(await apiMe());
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    clearSession();
  } finally {
    auth.checked = true;
  }
  return auth.user;
}

export async function login(email, password) {
  setSession(await apiLogin(email, password));
  auth.checked = true;
  return auth.user;
}

export async function logout() {
  try {
    await apiLogout();
  } finally {
    clearSession();
  }
}

// Rücksprung nach der Anmeldung nur auf Seiten des internen Bereichs (kein offener Redirect auf
// fremde Adressen wie "//beispiel.example" oder "https://…").
export function safeReturnPath(path) {
  if (typeof path === 'string' && path.startsWith('/intern/') && !path.startsWith('/intern/anmelden')) return path;
  return DEFAULT_TARGET;
}
