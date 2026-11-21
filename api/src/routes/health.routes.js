// Gesundheitsprüfung für den Compose-Healthcheck: API läuft und erreicht die Datenbank.
import { Router } from 'express';
import { query } from '../db.js';

export const healthRouter = Router();

healthRouter.get('/', async (req, res) => {
  await query('SELECT 1');
  res.json({ status: 'ok' });
});
