// Prüfregeln für Stellen in der Stellenverwaltung (UC6) mit deutschen Meldungen je Feld.
// Längen wie die CHECK-Constraints von job in db/init/01_schema.sql; die Beschäftigungsart wird
// gegen die Tabelle employment_type geprüft (eine Quelle, Iteration 5).
// Der Status ist kein Feld: Neue Stellen sind immer Entwürfe, Statuswechsel laufen über
// eigene Routen (veröffentlichen, schließen).
import { z } from 'zod';
import { INVALID_EMPLOYMENT_TYPE_MESSAGE, isKnownEmploymentType } from '../services/employmentTypes.service.js';

const NO_CONTROL_CHARS = /^[^\u0000-\u001f\u007f]*$/;

const fields = {
  title: z
    .string({ error: 'Bitte geben Sie einen Titel an.' })
    .trim()
    .min(3, 'Der Titel muss mindestens 3 Zeichen lang sein.')
    .max(200, 'Der Titel darf höchstens 200 Zeichen lang sein.')
    .regex(NO_CONTROL_CHARS, 'Der Titel enthält unzulässige Zeichen.'),
  location: z
    .string({ error: 'Bitte geben Sie einen Ort an.' })
    .trim()
    .min(1, 'Bitte geben Sie einen Ort an.')
    .max(100, 'Der Ort darf höchstens 100 Zeichen lang sein.')
    .regex(NO_CONTROL_CHARS, 'Der Ort enthält unzulässige Zeichen.'),
  employment_type: z
    .string({ error: INVALID_EMPLOYMENT_TYPE_MESSAGE })
    .refine(isKnownEmploymentType, INVALID_EMPLOYMENT_TYPE_MESSAGE),
  description: z
    .string({ error: 'Bitte geben Sie eine Beschreibung an.' })
    .trim()
    .min(1, 'Bitte geben Sie eine Beschreibung an.')
    .max(20000, 'Die Beschreibung darf höchstens 20 000 Zeichen lang sein.'),
};

// Anlegen: alle Felder Pflicht.
export const jobCreateSchema = z.strictObject(fields);

// Bearbeiten: nur die geänderten Felder, mindestens eines.
export const jobUpdateSchema = z
  .strictObject(fields)
  .partial()
  .refine((data) => Object.keys(data).length > 0, 'Bitte ändern Sie mindestens ein Feld.');
