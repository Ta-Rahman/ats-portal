// Öffentlicher Endpunkt für die Stammdaten der Beschäftigungsarten:
//   GET /api/employment-types → { employment_types: [{ code, label }] } in Anzeigereihenfolge
import { Router } from 'express';
import * as employmentTypesService from '../services/employmentTypes.service.js';

export const employmentTypesRouter = Router();

employmentTypesRouter.get('/', async (req, res) => {
  res.json({ employment_types: await employmentTypesService.listEmploymentTypes() });
});
