// Prüfregeln für Bewertung (UC8), Stufenwechsel (UC9) und Notizen (UC10) mit deutschen Meldungen.
// Längen wie die CHECK-Constraints in db/init/01_schema.sql.
import { z } from 'zod';

// Gleiche Werteliste wie pipeline_stage.code (db/init/03_stammdaten.sql). Ob ein Wechsel erlaubt
// ist, prüft nicht dieses Schema, sondern der Trigger anhand von allowed_transition.
export const STAGE_CODES = ['received', 'screening', 'interview', 'offer', 'hired', 'rejected', 'withdrawn'];

const emptyToUndefined = (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

const RATING_MESSAGE = 'Die Bewertung muss eine ganze Zahl von 1 bis 5 sein.';

export const ratingSchema = z.strictObject({
  rating: z.number({ error: RATING_MESSAGE }).int(RATING_MESSAGE).min(1, RATING_MESSAGE).max(5, RATING_MESSAGE),
});

export const stageChangeSchema = z.strictObject({
  to_stage: z.enum(STAGE_CODES, { error: 'Bitte wählen Sie eine gültige Stufe.' }),
  comment: z.preprocess(
    emptyToUndefined,
    z
      .string({ error: 'Der Kommentar muss ein Text sein.' })
      .trim()
      .max(2000, 'Der Kommentar darf höchstens 2000 Zeichen lang sein.')
      .optional(),
  ),
});

export const noteSchema = z.strictObject({
  body: z
    .string({ error: 'Bitte geben Sie einen Notiztext ein.' })
    .trim()
    .min(1, 'Bitte geben Sie einen Notiztext ein.')
    .max(5000, 'Die Notiz darf höchstens 5000 Zeichen lang sein.'),
});
