// Fachlogik für Statuseinsicht (UC4) und Rückzug (UC5) über den Token-Link.
// Die Funktionen erhalten nur den Hash des Tokens, nie den Klartext.
import * as applicationsRepository from '../repositories/applications.repository.js';
import { ConflictError, NotFoundError } from '../errors.js';

export const INVALID_LINK_MESSAGE =
  'Dieser Status-Link ist ungültig oder die Bewerbung wurde bereits gelöscht.';

// Datenminimierung: nur, was die Bewerber:in für ihren Stand braucht.
function toStatus(row) {
  return {
    job_title: row.job_title,
    stage: row.stage,
    stage_label: row.stage_label,
    submitted_at: row.submitted_at,
    can_withdraw: !row.is_terminal,
    delete_after: row.delete_after, // nur bei abgeschlossenen Bewerbungen gesetzt
  };
}

export async function getStatus(tokenHash) {
  const row = await applicationsRepository.findStatusByTokenHash(tokenHash);
  if (!row) throw new NotFoundError(INVALID_LINK_MESSAGE);
  return toStatus(row);
}

export async function withdraw(tokenHash) {
  let result;
  try {
    result = await applicationsRepository.withdrawByTokenHash(tokenHash);
  } catch (err) {
    // AT001/AT002 dürften nach der Vorprüfung nicht auftreten; falls doch: kein Rückzug möglich.
    if (err.code === 'AT001' || err.code === 'AT002') result = 'closed';
    else throw err;
  }
  if (result === 'not_found') throw new NotFoundError(INVALID_LINK_MESSAGE);
  if (result === 'closed') {
    throw new ConflictError(
      'ALREADY_CLOSED',
      'Die Bewerbung ist bereits abgeschlossen und kann nicht mehr zurückgezogen werden.',
    );
  }
  return getStatus(tokenHash);
}
