// Fachlogik der internen Bewerbungsansichten: Kanban je Stelle (UC7), Detail mit Anhang (UC7),
// Bewertung (UC8), Stufenwechsel (UC9), Notizen (UC10), Verlauf (UC11).
import * as applicationsRepository from '../repositories/applications.repository.js';
import * as jobsRepository from '../repositories/jobs.repository.js';
import * as storage from '../storage.js';
import { ConflictError, NotFoundError } from '../errors.js';

const APPLICATION_NOT_FOUND = 'Bewerbung nicht gefunden';

// Erlaubte Zielstufen je Ausgangsstufe: { received: [{code, label, is_terminal}, …], … }
async function internalTargetsByStage() {
  const map = {};
  for (const t of await applicationsRepository.findInternalTransitions()) {
    (map[t.from_stage] ??= []).push({ code: t.to_stage, label: t.to_label, is_terminal: t.to_is_terminal });
  }
  return map;
}

export function listStages() {
  return applicationsRepository.findStages();
}

export async function getKanban(jobId) {
  const job = await jobsRepository.findById(jobId);
  if (!job) throw new NotFoundError('Stelle nicht gefunden');
  const [stages, applications, transitions] = await Promise.all([
    applicationsRepository.findStages(),
    applicationsRepository.findCardsByJob(jobId),
    internalTargetsByStage(),
  ]);
  return {
    job: { id: job.id, title: job.title, status: job.status, location: job.location },
    stages,
    applications,
    transitions,
  };
}

export async function getDetail(id) {
  const row = await applicationsRepository.findDetailById(id);
  if (!row) throw new NotFoundError(APPLICATION_NOT_FOUND);
  const [attachments, notes, history, transitions] = await Promise.all([
    applicationsRepository.findAttachmentsByApplication(id),
    applicationsRepository.findNotesByApplication(id),
    applicationsRepository.findHistoryByApplication(id),
    internalTargetsByStage(),
  ]);
  const { job_id: jobId, job_title: jobTitle, job_status: jobStatus, ...application } = row;
  return {
    ...application,
    job: { id: jobId, title: jobTitle, status: jobStatus },
    attachments,
    allowed_targets: transitions[row.stage] ?? [],
    notes,
    history,
  };
}

const RATING_FROZEN = 'Die Bewerbung ist abgeschlossen; die Bewertung kann nicht mehr geändert werden.';

// Bewertung nur bei laufenden Bewerbungen (D44). Die Vorprüfung gibt bei jeder Anfrage auf eine
// abgeschlossene Bewerbung 409 (auch bei gleichem Wert); maßgeblich ist der Trigger
// application_rating_frozen (AT010), der auch einen gleichzeitigen Abschluss abfängt.
export async function setRating(id, rating) {
  const current = await applicationsRepository.findDetailById(id);
  if (!current) throw new NotFoundError(APPLICATION_NOT_FOUND);
  if (current.is_terminal) throw new ConflictError('RATING_FROZEN', RATING_FROZEN);
  let updated;
  try {
    updated = await applicationsRepository.setRating(id, rating);
  } catch (err) {
    if (err.code === 'AT010') throw new ConflictError('RATING_FROZEN', RATING_FROZEN);
    throw err;
  }
  if (!updated) throw new NotFoundError(APPLICATION_NOT_FOUND);
  return getDetail(id);
}

const TRANSITION_NOT_ALLOWED = 'Dieser Stufenwechsel ist nicht erlaubt.';

export async function changeStage(id, toStage, comment, userId) {
  let result;
  try {
    result = await applicationsRepository.changeStageInternal(id, toStage, userId, comment);
  } catch (err) {
    // AT001: Übergang nicht in allowed_transition; AT002: nur für Bewerber:innen erlaubt (Rückzug).
    if (err.code === 'AT001' || err.code === 'AT002') {
      throw new ConflictError('TRANSITION_NOT_ALLOWED', TRANSITION_NOT_ALLOWED);
    }
    throw err;
  }
  if (result === 'not_found') throw new NotFoundError(APPLICATION_NOT_FOUND);
  if (result === 'same') {
    throw new ConflictError('TRANSITION_NOT_ALLOWED', 'Die Bewerbung befindet sich bereits in dieser Stufe.');
  }
  return getDetail(id);
}

export async function addNote(applicationId, body, authorId) {
  let noteId;
  try {
    noteId = await applicationsRepository.insertNote(applicationId, authorId, body);
  } catch (err) {
    if (err.code === '23503') throw new NotFoundError(APPLICATION_NOT_FOUND); // Bewerbung fehlt
    throw err;
  }
  return applicationsRepository.findNoteById(noteId);
}

// Datei eines Anhangs; gefunden nur über die id → storage_key aus der Datenbank, nie über
// einen Pfad oder Dateinamen aus der Anfrage.
export async function getAttachmentFile(attachmentId) {
  const attachment = await applicationsRepository.findAttachmentById(attachmentId);
  if (!attachment) throw new NotFoundError('Anhang nicht gefunden');
  let content;
  try {
    content = await storage.read(attachment.storage_key);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    // Datei fehlt im Volume: Details nur ins Server-Log, nie Pfade in die Antwort.
    console.error('Anhang ohne Datei:', attachment.id, attachment.storage_key);
    throw new NotFoundError('Die Datei zu diesem Anhang wurde nicht gefunden.');
  }
  return { content, filename: attachment.original_filename };
}
