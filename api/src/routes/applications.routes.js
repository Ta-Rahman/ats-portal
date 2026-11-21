// Bewerbung absenden (UC3): POST /api/jobs/:id/applications  (multipart/form-data)
// Felder: first_name, last_name, email, phone (optional), cover_letter (optional), consent,
// consent_version; Datei: cv (PDF, max. 5 MB).
// Antwort 201 enthält nur den Status-Token (einmalig) – keine personenbezogenen Daten.
import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { uploadCv } from '../middleware/upload.js';
import { idParamsSchema } from './jobs.routes.js';
import * as applicationsService from '../services/applications.service.js';

export const applicationsRouter = Router({ mergeParams: true });

applicationsRouter.post('/', validate({ params: idParamsSchema }), uploadCv, async (req, res) => {
  const token = await applicationsService.submitApplication(req.validated.params.id, req.body, req.file);
  res.set('Cache-Control', 'no-store');
  res.status(201).json({ token });
});
