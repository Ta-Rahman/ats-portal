// Filter des Löschprotokolls (UC13): Zeitraum ?from=JJJJ-MM-TT&to=JJJJ-MM-TT (UTC, einschließlich),
// beide optional; "von" darf nicht nach "bis" liegen.
import { z } from 'zod';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const isRealDate = (s) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

const day = (label) => z
  .string()
  .regex(DATE_PATTERN, `Bitte geben Sie das Datum „${label}“ als JJJJ-MM-TT an.`)
  .refine(isRealDate, `Das Datum „${label}“ gibt es nicht.`)
  .optional();

export const deletionLogQuerySchema = z
  .strictObject({ from: day('von'), to: day('bis') })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    path: ['to'],
    message: 'Das Datum „bis“ darf nicht vor dem Datum „von“ liegen.',
  });
