// Zugriff auf die JSON-API (nginx leitet /api/ an den api-Dienst weiter).

export class ApiError extends Error {
  // details: Feldfehler der API [{ field, message }], code: stabiler Fehlercode der API
  constructor(status, message, { code = null, details = [] } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// status 0 = keine Antwort (Netzwerkfehler)
const NETWORK_MESSAGE = 'Der Server ist nicht erreichbar. Bitte prüfen Sie Ihre Verbindung und versuchen Sie es erneut.';

async function requestJson(url, options = {}) {
  let res;
  try {
    res = await fetch(url, { ...options, headers: { Accept: 'application/json', ...options.headers } });
  } catch {
    throw new ApiError(0, NETWORK_MESSAGE);
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null; // z. B. HTML-Fehlerseite von nginx
  }
  if (!res.ok) {
    throw new ApiError(res.status, body?.error?.message ?? 'Die Anfrage ist fehlgeschlagen.', {
      code: body?.error?.code ?? null,
      details: Array.isArray(body?.error?.details) ? body.error.details : [],
    });
  }
  return body;
}

function getJson(path, params = {}) {
  const url = new URL(path, window.location.origin);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  }
  return requestJson(url);
}

export async function fetchJobs({ location, employmentType } = {}) {
  const body = await getJson('/api/jobs', { location, employment_type: employmentType });
  return body.jobs;
}

export async function fetchJob(id) {
  const body = await getJson(`/api/jobs/${encodeURIComponent(id)}`);
  return body.job;
}

// Beschäftigungsarten [{ code, label }] (einzige Quelle: Tabelle employment_type)
export async function fetchEmploymentTypes() {
  const body = await getJson('/api/employment-types');
  return body.employment_types;
}

// Einwilligungstext und Datenschutzhinweis (einzige Quelle: api/src/consent.js)
export async function fetchConsent() {
  const body = await getJson('/api/consent');
  return body.consent;
}

// Sendet das Formular als multipart/form-data; liefert den Status-Token (nur dieses eine Mal).
export async function submitApplication(jobId, formData) {
  const body = await requestJson(`/api/jobs/${encodeURIComponent(jobId)}/applications`, {
    method: 'POST',
    body: formData,
  });
  return body.token;
}

export async function fetchStatus(token) {
  const body = await getJson(`/api/status/${encodeURIComponent(token)}`);
  return body.status;
}

export async function withdrawApplication(token) {
  const body = await requestJson(`/api/status/${encodeURIComponent(token)}/withdraw`, { method: 'POST' });
  return body.status;
}

// ---------------------------------------------------------------------------------------------
// Interner Bereich (Iteration 3): Anmeldung und /api/admin
// Das Sitzungs-Cookie (HttpOnly) schickt der Browser selbst mit; zustandsändernde Anfragen tragen
// zusätzlich den CSRF-Token der Sitzung im Header X-CSRF-Token.
// ---------------------------------------------------------------------------------------------

let csrfToken = null;
let unauthorizedHandler = null;

export function setCsrfToken(token) {
  csrfToken = token;
}

// Wird bei 401 aus dem internen Bereich aufgerufen (z. B. Sitzung abgelaufen) – setzt main.js.
export function onUnauthorized(handler) {
  unauthorizedHandler = handler;
}

function jsonRequest(method, path, body) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  return requestJson(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

async function adminRequest(method, path, body) {
  try {
    return await jsonRequest(method, `/api/admin${path}`, body);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401 && unauthorizedHandler) unauthorizedHandler();
    throw e;
  }
}

export function apiLogin(email, password) {
  return jsonRequest('POST', '/api/auth/login', { email, password });
}

export function apiMe() {
  return jsonRequest('GET', '/api/auth/me');
}

export function apiLogout() {
  return jsonRequest('POST', '/api/auth/logout');
}

export const admin = {
  listJobs: () => adminRequest('GET', '/jobs'), // { jobs, stages }
  getJob: async (id) => (await adminRequest('GET', `/jobs/${encodeURIComponent(id)}`)).job,
  createJob: async (data) => (await adminRequest('POST', '/jobs', data)).job,
  updateJob: async (id, data) => (await adminRequest('PATCH', `/jobs/${encodeURIComponent(id)}`, data)).job,
  publishJob: async (id) => (await adminRequest('POST', `/jobs/${encodeURIComponent(id)}/publish`)).job,
  closeJob: async (id) => (await adminRequest('POST', `/jobs/${encodeURIComponent(id)}/close`)).job,
  kanban: (jobId) => adminRequest('GET', `/jobs/${encodeURIComponent(jobId)}/applications`),
  getApplication: async (id) => (await adminRequest('GET', `/applications/${encodeURIComponent(id)}`)).application,
  rate: async (id, rating) =>
    (await adminRequest('PUT', `/applications/${encodeURIComponent(id)}/rating`, { rating })).application,
  changeStage: async (id, toStage, comment) =>
    (await adminRequest('POST', `/applications/${encodeURIComponent(id)}/stage`, { to_stage: toStage, comment }))
      .application,
  addNote: async (id, body) => (await adminRequest('POST', `/applications/${encodeURIComponent(id)}/notes`, { body })).note,
  // nur Admin (Iteration 4): Nutzerverwaltung (UC12) und Löschprotokoll (UC13)
  listUsers: async () => (await adminRequest('GET', '/users')).users,
  createUser: async (data) => (await adminRequest('POST', '/users', data)).user,
  setRole: async (id, role) => (await adminRequest('PUT', `/users/${encodeURIComponent(id)}/role`, { role })).user,
  deactivateUser: async (id) => (await adminRequest('POST', `/users/${encodeURIComponent(id)}/deactivate`)).user,
  activateUser: async (id) => (await adminRequest('POST', `/users/${encodeURIComponent(id)}/activate`)).user,
  deletionLog: async ({ from, to } = {}) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const query = params.toString();
    return (await adminRequest('GET', `/deletion-log${query ? `?${query}` : ''}`)).entries;
  },
};

// Download-Link des Lebenslaufs (GET mit Sitzungs-Cookie, kein CSRF-Token nötig).
export function attachmentUrl(attachmentId) {
  return `/api/admin/attachments/${encodeURIComponent(attachmentId)}`;
}
