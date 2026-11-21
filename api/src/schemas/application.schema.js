// Prüfregeln des Bewerbungsformulars (UC3) mit deutschen Meldungen je Feld.
// Längen wie die CHECK-Constraints von application in db/init/01_schema.sql.
// Das Web prüft dieselben Regeln vorab (web/src/applicationRules.js); maßgeblich ist die API.
import { z } from 'zod';
import { CONSENT } from '../consent.js';

const NO_CONTROL_CHARS = /^[^\u0000-\u001f\u007f]*$/;
const PHONE_CHARS = /^[0-9+\-/() ]+$/;

// Leere bzw. nur aus Leerzeichen bestehende Eingaben optionaler Felder gelten als "nicht angegeben".
const emptyToUndefined = (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

function nameField(missing, tooLong, invalid) {
  return z
    .string({ error: missing })
    .trim()
    .min(1, missing)
    .max(100, tooLong)
    .regex(NO_CONTROL_CHARS, invalid);
}

const EMAIL_MESSAGE = 'Bitte geben Sie eine gültige E-Mail-Adresse an.';

export const applicationBodySchema = z.strictObject({
  first_name: nameField(
    'Bitte geben Sie Ihren Vornamen an.',
    'Der Vorname darf höchstens 100 Zeichen lang sein.',
    'Der Vorname enthält unzulässige Zeichen.',
  ),
  last_name: nameField(
    'Bitte geben Sie Ihren Nachnamen an.',
    'Der Nachname darf höchstens 100 Zeichen lang sein.',
    'Der Nachname enthält unzulässige Zeichen.',
  ),
  email: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() : v),
    z.email({ error: EMAIL_MESSAGE }).max(254, 'Die E-Mail-Adresse darf höchstens 254 Zeichen lang sein.'),
  ),
  phone: z.preprocess(
    emptyToUndefined,
    z
      .string({ error: 'Bitte geben Sie eine gültige Telefonnummer an.' })
      .trim()
      .min(3, 'Die Telefonnummer muss mindestens 3 Zeichen lang sein.')
      .max(40, 'Die Telefonnummer darf höchstens 40 Zeichen lang sein.')
      .regex(PHONE_CHARS, 'Die Telefonnummer darf nur Ziffern, Leerzeichen und + - / ( ) enthalten.')
      .optional(),
  ),
  cover_letter: z.preprocess(
    emptyToUndefined,
    z
      .string({ error: 'Bitte geben Sie das Anschreiben als Text ein.' })
      .max(10000, 'Das Anschreiben darf höchstens 10 000 Zeichen lang sein.')
      .optional(),
  ),
  consent: z.literal('true', { error: 'Bitte bestätigen Sie die Einwilligung.' }),
  // Version des Einwilligungstextes, den das Formular angezeigt hat (aus GET /api/consent).
  // Fehlt das Feld, ist das ein anderer Fehler als eine veraltete Version → eigene Meldung.
  consent_version: z.literal(CONSENT.version, {
    error: (issue) =>
      issue.input === undefined
        ? 'Die Version des Einwilligungstextes fehlt. Bitte laden Sie die Seite neu.'
        : 'Der Einwilligungstext wurde aktualisiert. Bitte laden Sie die Seite neu.',
  }),
});
