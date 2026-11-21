// Status-Link für Bewerber:innen (ohne Konto):
//   GET  /api/status/:token           → Stand der Bewerbung (UC4)
//   POST /api/status/:token/withdraw  → Bewerbung zurückziehen (UC5)
// Der Token wird hier sofort gehasht; Service, Datenbank und Logs sehen nur den Hash.
// Fehlerhaftes Format → 400, unbekannt/gelöscht → 404, beide mit derselben Meldung.
import { Router } from 'express';
import { HttpError } from '../errors.js';
import { TOKEN_PATTERN, hashToken } from '../token.js';
import * as statusService from '../services/status.service.js';

export const statusRouter = Router();

// Antworten mit Status-Daten dürfen weder im Browser noch in Proxys zwischengespeichert werden.
statusRouter.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

function tokenHashFrom(req) {
  const token = req.params.token;
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) {
    throw new HttpError(400, 'INVALID_TOKEN', statusService.INVALID_LINK_MESSAGE);
  }
  return hashToken(token);
}

statusRouter.get('/:token', async (req, res) => {
  const status = await statusService.getStatus(tokenHashFrom(req));
  res.json({ status });
});

statusRouter.post('/:token/withdraw', async (req, res) => {
  const status = await statusService.withdraw(tokenHashFrom(req));
  res.json({ status });
});
