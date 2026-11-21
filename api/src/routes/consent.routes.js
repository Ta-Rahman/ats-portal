// Einwilligungstext für das Bewerbungsformular: GET /api/consent
import { Router } from 'express';
import { CONSENT } from '../consent.js';

export const consentRouter = Router();

consentRouter.get('/', (req, res) => {
  res.json({ consent: { version: CONSENT.version, text: CONSENT.text, privacy_note: CONSENT.privacyNote } });
});
