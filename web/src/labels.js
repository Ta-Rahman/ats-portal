// Anzeigetexte und Formatierung.
export const SITE_NAME = 'Muster IT GmbH (fiktiv)';

// Beschäftigungsarten: keine eigene Liste mehr, sie kommen von der API (employmentTypes.js).

const dateFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'long', timeZone: 'Europe/Berlin' });

export function formatDate(iso) {
  return iso ? dateFormat.format(new Date(iso)) : '';
}

// Status einer Stelle (CHECK-Constraint job.status in db/init/01_schema.sql).
export const JOB_STATUS_LABELS = {
  draft: 'Entwurf',
  published: 'Veröffentlicht',
  closed: 'Geschlossen',
};

export function jobStatusLabel(code) {
  return JOB_STATUS_LABELS[code] ?? code;
}

// Rollen interner Nutzer (CHECK-Constraint internal_user.role).
export const ROLE_LABELS = {
  recruiter: 'Recruiter:in',
  admin: 'Admin',
};

export function roleLabel(code) {
  return ROLE_LABELS[code] ?? code;
}

const dateTimeFormat = new Intl.DateTimeFormat('de-DE', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Berlin',
});

export function formatDateTime(iso) {
  return iso ? dateTimeFormat.format(new Date(iso)) : '';
}

export function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} Byte`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toLocaleString('de-DE', { maximumFractionDigits: 1 })} KB`;
  return `${(kb / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`;
}
