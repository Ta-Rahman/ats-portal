// Interner Bereich für Recruiter und Admin: alle Routen unter /api/admin; Nutzerverwaltung und
// Löschprotokoll zusätzlich nur für die Rolle admin (requireRole('admin') je Route).
// Bewusst ein einziger, flacher Router: Der Test "jede Admin-Route ohne Sitzung → 401" liest die
// Routen direkt aus diesem Router aus und vergleicht sie mit seiner Tabelle.
//
// Reihenfolge je Anfrage: no-store → Sitzung → requireAuth (401) → requireRole (403)
// → requireCsrf (403 bei POST/PUT/PATCH/DELETE ohne gültigen Token) → JSON-Body → Route.
// Der Body wird erst nach den Prüfungen gelesen: Ohne Sitzung gibt es immer 401, auch bei
// fehlerhaftem JSON.
import express, { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { noStore, requireCsrf, requireRole } from '../middleware/auth.js';
import { idParamsSchema } from './jobs.routes.js';
import { jobCreateSchema, jobUpdateSchema } from '../schemas/job.schema.js';
import { noteSchema, ratingSchema, stageChangeSchema } from '../schemas/pipeline.schema.js';
import * as adminJobsService from '../services/adminJobs.service.js';
import * as pipelineService from '../services/pipeline.service.js';
import { roleSchema, userCreateSchema } from '../schemas/user.schema.js';
import * as usersService from '../services/users.service.js';
import { deletionLogQuerySchema } from '../schemas/deletionLog.schema.js';
import * as deletionService from '../services/deletion.service.js';

export function createAdminRouter({ sessionMiddleware, requireAuth }) {
  const router = Router();
  router.use(
    noStore,
    sessionMiddleware,
    requireAuth,
    requireRole('recruiter', 'admin'),
    requireCsrf,
    express.json({ limit: '100kb' }),
  );

  // --- Stellenverwaltung (UC6) ----------------------------------------------------------------
  // Mit den Stufen (Code, Bezeichnung, Reihenfolge), damit die Oberfläche die Zählung je Stufe
  // beschriften kann, ohne die Bezeichnungen selbst zu kennen.
  router.get('/jobs', async (req, res) => {
    const [jobs, stages] = await Promise.all([adminJobsService.listJobs(), pipelineService.listStages()]);
    res.json({ jobs, stages });
  });

  router.post('/jobs', validate({ body: jobCreateSchema }), async (req, res) => {
    const job = await adminJobsService.createJob(req.validated.body, req.user.id);
    res.status(201).json({ job });
  });

  router.get('/jobs/:id', validate({ params: idParamsSchema }), async (req, res) => {
    res.json({ job: await adminJobsService.getJob(req.validated.params.id) });
  });

  router.patch('/jobs/:id', validate({ params: idParamsSchema, body: jobUpdateSchema }), async (req, res) => {
    res.json({ job: await adminJobsService.updateJob(req.validated.params.id, req.validated.body) });
  });

  router.post('/jobs/:id/publish', validate({ params: idParamsSchema }), async (req, res) => {
    res.json({ job: await adminJobsService.publishJob(req.validated.params.id) });
  });

  router.post('/jobs/:id/close', validate({ params: idParamsSchema }), async (req, res) => {
    res.json({ job: await adminJobsService.closeJob(req.validated.params.id) });
  });

  // --- Bewerbungen (UC7–UC11) -----------------------------------------------------------------
  router.get('/jobs/:id/applications', validate({ params: idParamsSchema }), async (req, res) => {
    res.json(await pipelineService.getKanban(req.validated.params.id));
  });

  router.get('/applications/:id', validate({ params: idParamsSchema }), async (req, res) => {
    res.json({ application: await pipelineService.getDetail(req.validated.params.id) });
  });

  router.put('/applications/:id/rating', validate({ params: idParamsSchema, body: ratingSchema }), async (req, res) => {
    const application = await pipelineService.setRating(req.validated.params.id, req.validated.body.rating);
    res.json({ application });
  });

  router.post('/applications/:id/stage', validate({ params: idParamsSchema, body: stageChangeSchema }),
    async (req, res) => {
      const { to_stage: toStage, comment } = req.validated.body;
      const application = await pipelineService.changeStage(req.validated.params.id, toStage, comment, req.user.id);
      res.json({ application });
    });

  router.post('/applications/:id/notes', validate({ params: idParamsSchema, body: noteSchema }), async (req, res) => {
    const note = await pipelineService.addNote(req.validated.params.id, req.validated.body.body, req.user.id);
    res.status(201).json({ note });
  });

  // Lebenslauf-Download: immer als Anhang (nie im Browser ausgeführt), Dateiname bereinigt aus der
  // Datenbank, RFC 5987 (filename*=UTF-8''…) für Umlaute über res.attachment().
  router.get('/attachments/:id', validate({ params: idParamsSchema }), async (req, res) => {
    const { content, filename } = await pipelineService.getAttachmentFile(req.validated.params.id);
    res.attachment(filename);
    res.set({
      'Content-Type': 'application/pdf',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    });
    res.send(content);
  });

  // --- Nur Admin: Nutzerverwaltung (UC12) -----------------------------------------------------
  // requireRole('admin') steht vor der Validierung: Ein Recruiter bekommt immer 403, nie 400/404.
  const adminOnly = requireRole('admin');

  router.get('/users', adminOnly, async (req, res) => {
    res.json({ users: await usersService.listUsers() });
  });

  router.post('/users', adminOnly, validate({ body: userCreateSchema }), async (req, res) => {
    res.status(201).json({ user: await usersService.createUser(req.validated.body) });
  });

  router.put('/users/:id/role', adminOnly, validate({ params: idParamsSchema, body: roleSchema }), async (req, res) => {
    res.json({ user: await usersService.changeRole(req.user.id, req.validated.params.id, req.validated.body.role) });
  });

  router.post('/users/:id/deactivate', adminOnly, validate({ params: idParamsSchema }), async (req, res) => {
    res.json({ user: await usersService.setActive(req.user.id, req.validated.params.id, false) });
  });

  router.post('/users/:id/activate', adminOnly, validate({ params: idParamsSchema }), async (req, res) => {
    res.json({ user: await usersService.setActive(req.user.id, req.validated.params.id, true) });
  });

  // --- Nur Admin: Löschprotokoll (UC13) – ohne Personendaten ----------------------------------
  router.get('/deletion-log', adminOnly, validate({ query: deletionLogQuerySchema }), async (req, res) => {
    res.json({ entries: await deletionService.listDeletionLog(req.validated.query) });
  });

  return router;
}
