// Prüfregeln der Nutzerverwaltung (UC12) mit deutschen Meldungen je Feld.
//
// Passwortregel nach NIST SP 800-63B-4 (Passwort als einziger Faktor): Länge statt
// Zusammensetzungsregeln – mindestens 15 Zeichen, höchstens 64 Zeichen. Zusätzlich höchstens 72 Byte
// (UTF-8), weil bcrypt nur die ersten 72 Byte auswertet; der Rest würde unbemerkt ignoriert.
// Abgelehnt werden außerdem naheliegende Passwörter: nur ein wiederholtes Zeichen, Teile von Name
// oder E-Mail-Adresse, Wörter aus dem Kontext der Anwendung (kleine Sperrliste statt Komplexitätsregeln).
import { z } from 'zod';

export const ROLES = ['recruiter', 'admin'];
export const PASSWORD_MIN_CHARS = 15;
export const PASSWORD_MAX_CHARS = 64;
export const PASSWORD_MAX_BYTES = 72;
const CONTEXT_WORDS = ['passwort', 'password', 'kennwort', 'muster', 'bewerbung', 'recruiting', 'admin'];

const NO_CONTROL_CHARS = /^[^\u0000-\u001f\u007f]*$/;
const chars = (s) => [...s].length; // Zeichen = Unicode-Codepunkte (Emoji zählt als 1)

const password = z
  .string({ error: 'Bitte geben Sie ein Startpasswort an.' })
  .refine((s) => chars(s) >= PASSWORD_MIN_CHARS, `Das Passwort muss mindestens ${PASSWORD_MIN_CHARS} Zeichen lang sein.`)
  .refine((s) => chars(s) <= PASSWORD_MAX_CHARS, `Das Passwort darf höchstens ${PASSWORD_MAX_CHARS} Zeichen lang sein.`)
  .refine((s) => Buffer.byteLength(s, 'utf8') <= PASSWORD_MAX_BYTES,
    'Das Passwort ist zu lang: höchstens 72 Byte (Umlaute und Sonderzeichen zählen doppelt oder mehr).')
  .refine((s) => !/^(.)\1*$/su.test(s), 'Das Passwort darf nicht aus einem einzigen wiederholten Zeichen bestehen.');

// Wörter aus E-Mail (Teil vor dem @) und Name, mindestens 4 Zeichen (kürzere würden zu viele
// zufällige Treffer ergeben), klein geschrieben.
function personalWords(email, displayName) {
  const local = String(email).split('@')[0];
  return `${local} ${displayName}`
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 4);
}

export function containsGuessableWord(pw, email, displayName) {
  const lower = pw.toLowerCase();
  return [...CONTEXT_WORDS, ...personalWords(email, displayName)].some((w) => lower.includes(w));
}

export const userCreateSchema = z
  .strictObject({
    email: z.preprocess(
      (v) => (typeof v === 'string' ? v.trim() : v),
      z.email({ error: 'Bitte geben Sie eine gültige E-Mail-Adresse an.' })
        .max(254, 'Die E-Mail-Adresse darf höchstens 254 Zeichen lang sein.'),
    ),
    display_name: z
      .string({ error: 'Bitte geben Sie einen Namen an.' })
      .trim()
      .min(1, 'Bitte geben Sie einen Namen an.')
      .max(100, 'Der Name darf höchstens 100 Zeichen lang sein.')
      .regex(NO_CONTROL_CHARS, 'Der Name enthält unzulässige Zeichen.'),
    role: z.enum(ROLES, { error: 'Bitte wählen Sie eine gültige Rolle.' }),
    password,
  })
  .superRefine((data, ctx) => {
    if (containsGuessableWord(data.password, data.email, data.display_name)) {
      ctx.addIssue({
        code: 'custom',
        path: ['password'],
        message: 'Das Passwort darf weder Teile von Name oder E-Mail-Adresse noch naheliegende Wörter '
          + '(z. B. „Passwort“, „Muster“) enthalten.',
      });
    }
  });

export const roleSchema = z.strictObject({
  role: z.enum(ROLES, { error: 'Bitte wählen Sie eine gültige Rolle.' }),
});
