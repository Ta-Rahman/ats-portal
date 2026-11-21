// Öffentliche Stellen-Endpunkte: GET /api/jobs, GET /api/jobs/:id
import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import * as jobsService from '../services/jobs.service.js';
import { INVALID_EMPLOYMENT_TYPE_MESSAGE, isKnownEmploymentType } from '../services/employmentTypes.service.js';

// Unbekannte Parameter → 400 (strictObject). Ein mehrfach übergebener Parameter kommt als
// Array an und scheitert an z.string() → ebenfalls 400.
const listQuerySchema = z.strictObject({
  location: z.string().trim().min(1).max(100).optional(),
  // erlaubte Werte stehen nur in der Tabelle employment_type (Abfrage je Anfrage, nur wenn gesetzt)
  employment_type: z.string().refine(isKnownEmploymentType, INVALID_EMPLOYMENT_TYPE_MESSAGE).optional(),
});

// Positive Ganzzahl im Wertebereich von PostgreSQL integer.
export const idParamsSchema = z.strictObject({
  id: z
    .string()
    .regex(/^[1-9][0-9]{0,9}$/, 'Ungültige ID')
    .transform(Number)
    .refine((n) => n <= 2147483647, 'Ungültige ID'),
});

export const jobsRouter = Router();

jobsRouter.get('/', validate({ query: listQuerySchema }), async (req, res) => {
  const jobs = await jobsService.listPublishedJobs(req.validated.query);
  res.json({ jobs });
});

jobsRouter.get('/:id', validate({ params: idParamsSchema }), async (req, res) => {
  const job = await jobsService.getPublishedJob(req.validated.params.id);
  res.json({ job });
});
