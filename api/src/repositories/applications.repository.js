// SQL-Zugriff auf Bewerbungen und Anhänge. Ausschließlich parametrisierte Abfragen ($1, $2 …).
// Geschäftsregeln (nur veröffentlichte Stellen, Statusübergänge, Löschfrist) prüfen die Trigger
// in db/init/02_regeln.sql; hier wird nur gelesen und geschrieben.
import { query, withTransaction } from '../db.js';

// Legt Bewerbung und Anhang in einer Transaktion an (beide oder keine).
// consent_given_at = Serverzeit der Datenbank.
export function createWithAttachment(application, attachment) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO application (job_id, first_name, last_name, email, phone, cover_letter,
                                consent_given_at, consent_version, access_token_hash)
       VALUES ($1, $2, $3, $4, $5, $6, now(), $7, $8)
       RETURNING id`,
      [
        application.jobId,
        application.firstName,
        application.lastName,
        application.email,
        application.phone,
        application.coverLetter,
        application.consentVersion,
        application.tokenHash,
      ],
    );
    const applicationId = rows[0].id;
    await client.query(
      `INSERT INTO attachment (application_id, original_filename, storage_key, mime_type, size_bytes)
       VALUES ($1, $2, $3, 'application/pdf', $4)`,
      [applicationId, attachment.originalFilename, attachment.storageKey, attachment.sizeBytes],
    );
    return applicationId;
  });
}

// Statusdaten für den Bewerber-Link – bewusst ohne Name, E-Mail, Telefon, Anschreiben, Bewertung.
export async function findStatusByTokenHash(tokenHash) {
  const { rows } = await query(
    `SELECT j.title AS job_title, a.stage, s.label AS stage_label, s.is_terminal,
            a.created_at AS submitted_at, a.delete_after
       FROM application a
       JOIN job j            ON j.id = a.job_id
       JOIN pipeline_stage s ON s.code = a.stage
      WHERE a.access_token_hash = $1`,
    [tokenHash],
  );
  return rows[0] ?? null;
}

// Rückzug durch die Bewerber:in. Ergebnis: 'not_found' | 'closed' | 'withdrawn'.
// Die Zeile wird gesperrt (FOR UPDATE), damit Prüfung und Wechsel nicht parallel laufen.
// Der Statuswechsel selbst läuft durch den Trigger (Übergang + Akteur prüfen, Historie,
// closed_at/delete_after). Die Vorprüfung auf Endstufe ist nötig, weil der Trigger
// withdrawn -> withdrawn als "gleiche Stufe" ohne Fehler durchlässt.
export function withdrawByTokenHash(tokenHash) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT a.id, s.is_terminal
         FROM application a
         JOIN pipeline_stage s ON s.code = a.stage
        WHERE a.access_token_hash = $1
          FOR UPDATE OF a`,
      [tokenHash],
    );
    if (rows.length === 0) return 'not_found';
    if (rows[0].is_terminal) return 'closed';
    await client.query(`SELECT set_config('ats.actor', 'applicant', true)`);
    await client.query(
      `UPDATE application SET stage = 'withdrawn', updated_at = now() WHERE id = $1`,
      [rows[0].id],
    );
    return 'withdrawn';
  });
}

// ---------------------------------------------------------------------------------------------
// Interner Bereich (UC7–UC11)
// ---------------------------------------------------------------------------------------------

// Stufen der Pipeline in Anzeigereihenfolge (Spalten der Kanban-Ansicht).
export async function findStages() {
  const { rows } = await query(
    `SELECT code, label, sort_order, is_terminal FROM pipeline_stage ORDER BY sort_order`,
  );
  return rows;
}

// Erlaubte Übergänge für interne Nutzer (Recruiter/Admin), nur zur Anzeige der Auswahl.
// Maßgeblich bleibt der Trigger application_stage_change.
export async function findInternalTransitions() {
  const { rows } = await query(
    `SELECT t.from_stage, t.to_stage, s.label AS to_label, s.is_terminal AS to_is_terminal
       FROM allowed_transition t
       JOIN pipeline_stage s ON s.code = t.to_stage
      WHERE t.actor = 'internal'
      ORDER BY t.from_stage, s.sort_order`,
  );
  return rows;
}

// Karten der Kanban-Ansicht einer Stelle (ohne Kontaktdaten und Anschreiben).
export async function findCardsByJob(jobId) {
  const { rows } = await query(
    `SELECT id, first_name, last_name, stage, rating, created_at
       FROM application
      WHERE job_id = $1
      ORDER BY created_at, id`,
    [jobId],
  );
  return rows;
}

export async function findDetailById(id) {
  const { rows } = await query(
    `SELECT a.id, a.job_id, j.title AS job_title, j.status AS job_status,
            a.first_name, a.last_name, a.email, a.phone, a.cover_letter,
            a.stage, s.label AS stage_label, s.is_terminal, a.rating,
            a.consent_given_at, a.consent_version,
            a.created_at, a.updated_at, a.closed_at, a.delete_after
       FROM application a
       JOIN job j            ON j.id = a.job_id
       JOIN pipeline_stage s ON s.code = a.stage
      WHERE a.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function findAttachmentsByApplication(applicationId) {
  const { rows } = await query(
    `SELECT id, original_filename, size_bytes, created_at
       FROM attachment
      WHERE application_id = $1
      ORDER BY id`,
    [applicationId],
  );
  return rows;
}

export async function findNotesByApplication(applicationId) {
  const { rows } = await query(
    `SELECT n.id, n.body, u.display_name AS author_name, n.created_at
       FROM note n
       JOIN internal_user u ON u.id = n.author_id
      WHERE n.application_id = $1
      ORDER BY n.created_at, n.id`,
    [applicationId],
  );
  return rows;
}

// Verlauf; changed_by_name NULL = Wechsel durch die Bewerber:in (Status-Link).
export async function findHistoryByApplication(applicationId) {
  const { rows } = await query(
    `SELECT h.id, h.from_stage, f.label AS from_label, h.to_stage, t.label AS to_label,
            u.display_name AS changed_by_name, h.changed_at, h.comment
       FROM status_history h
       JOIN pipeline_stage f     ON f.code = h.from_stage
       JOIN pipeline_stage t     ON t.code = h.to_stage
       LEFT JOIN internal_user u ON u.id = h.changed_by
      WHERE h.application_id = $1
      ORDER BY h.changed_at, h.id`,
    [applicationId],
  );
  return rows;
}

// Ergebnis: true = gesetzt, false = Bewerbung nicht gefunden.
export async function setRating(id, rating) {
  const { rowCount } = await query(
    `UPDATE application SET rating = $2, updated_at = now() WHERE id = $1`,
    [id, rating],
  );
  return rowCount === 1;
}

export async function insertNote(applicationId, authorId, body) {
  const { rows } = await query(
    `INSERT INTO note (application_id, author_id, body) VALUES ($1, $2, $3) RETURNING id`,
    [applicationId, authorId, body],
  );
  return rows[0].id;
}

export async function findNoteById(id) {
  const { rows } = await query(
    `SELECT n.id, n.body, u.display_name AS author_name, n.created_at
       FROM note n JOIN internal_user u ON u.id = n.author_id
      WHERE n.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

// Stufenwechsel durch Recruiter/Admin. Ergebnis: 'not_found' | 'same' | 'changed'.
// Die Zeile wird gesperrt (FOR UPDATE); der Wechsel selbst läuft durch den Trigger, der Übergang
// und Akteur prüft (AT001/AT002), status_history schreibt und bei Endstufe closed_at/delete_after
// setzt. Die Vorprüfung auf dieselbe Stufe ist nötig, weil der Trigger "received -> received"
// ohne Fehler und ohne Historie durchlässt. Akteur, Nutzer und Kommentar gelten nur für diese
// Transaktion (set_config(…, true)) und werden als Parameter übergeben.
export function changeStageInternal(id, toStage, userId, comment) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT stage FROM application WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (rows.length === 0) return 'not_found';
    if (rows[0].stage === toStage) return 'same';
    await client.query(
      `SELECT set_config('ats.actor', 'internal', true),
              set_config('ats.user_id', $1, true),
              set_config('ats.comment', $2, true)`,
      [String(userId), comment ?? ''],
    );
    await client.query(
      `UPDATE application SET stage = $2, updated_at = now() WHERE id = $1`,
      [id, toStage],
    );
    return 'changed';
  });
}

// Für den Download: Datei wird ausschließlich über storage_key aus der Datenbank gefunden.
export async function findAttachmentById(id) {
  const { rows } = await query(
    `SELECT id, application_id, original_filename, storage_key, size_bytes
       FROM attachment
      WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}
