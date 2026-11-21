// Fachlogik für das Absenden einer Bewerbung (UC3).
// Reihenfolge: Stelle offen? → Felder → PDF (Magic Bytes) → Datei schreiben → DB-Transaktion.
// Konsistenz von Datei und Datenbank: erst die Datei, dann Bewerbung + Anhang in einer
// Transaktion; scheitert die Datenbank, wird die Datei wieder gelöscht. So gibt es nie eine
// Anhang-Zeile ohne Datei.
import { randomUUID } from 'node:crypto';
import * as jobsRepository from '../repositories/jobs.repository.js';
import * as applicationsRepository from '../repositories/applications.repository.js';
import * as storage from '../storage.js';
import { applicationBodySchema } from '../schemas/application.schema.js';
import { issuesToDetails } from '../middleware/validate.js';
import { CONSENT } from '../consent.js';
import { generateToken, hashToken } from '../token.js';
import { NotFoundError, UnsupportedMediaTypeError, ValidationError } from '../errors.js';

const JOB_NOT_OPEN = 'Stelle nicht gefunden oder nicht mehr ausgeschrieben';

// Liefert den Klartext-Token (einmalig für die Antwort); gespeichert wird nur sein Hash.
export async function submitApplication(jobId, body, file) {
  const job = await jobsRepository.findPublishedById(jobId);
  if (!job) throw new NotFoundError(JOB_NOT_OPEN);

  const parsed = applicationBodySchema.safeParse({ ...(body ?? {}) });
  const details = parsed.success ? [] : issuesToDetails(parsed.error.issues, 'body');
  if (!file) {
    details.push({ location: 'body', field: 'cv', message: 'Bitte laden Sie Ihren Lebenslauf als PDF hoch.' });
  }
  if (details.length) throw new ValidationError(details, 'Bitte prüfen Sie Ihre Angaben.');

  if (!storage.isPdf(file.buffer)) {
    throw new UnsupportedMediaTypeError(
      'Die Datei ist kein PDF. Bitte laden Sie Ihren Lebenslauf als PDF-Datei hoch.', 'cv');
  }

  const data = parsed.data;
  const token = generateToken();
  const storageKey = randomUUID();

  await storage.writeNew(storageKey, file.buffer);
  try {
    await applicationsRepository.createWithAttachment(
      {
        jobId,
        firstName: data.first_name,
        lastName: data.last_name,
        email: data.email,
        phone: data.phone ?? null,
        coverLetter: data.cover_letter ?? null,
        consentVersion: CONSENT.version,
        tokenHash: hashToken(token),
      },
      {
        originalFilename: storage.sanitizeFilename(file.originalname),
        storageKey,
        sizeBytes: file.size,
      },
    );
  } catch (err) {
    await storage.remove(storageKey).catch((removeErr) => {
      console.error('Upload-Datei konnte nach DB-Fehler nicht entfernt werden:', storageKey, removeErr.code);
    });
    // AT003: Stelle wurde zwischen Prüfung und Insert geschlossen; 23503: Stelle existiert nicht.
    if (err.code === 'AT003' || err.code === '23503') throw new NotFoundError(JOB_NOT_OPEN);
    throw err;
  }
  return token;
}
