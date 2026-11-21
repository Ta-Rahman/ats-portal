// Express-Anwendung (ohne listen), damit Tests sie direkt mit supertest ansprechen können.
// Schichten: routes/ (HTTP, Validierung) → services/ (Fachlogik) → repositories/ (SQL).
import express from 'express';
import helmet from 'helmet';
import { z } from 'zod';
import { loadConfig } from './config.js';
import { createSession } from './session.js';
import { createRequireAuth } from './middleware/auth.js';
import { createRateLimits } from './middleware/rateLimit.js';
import { requestLog } from './middleware/requestLog.js';
import { healthRouter } from './routes/health.routes.js';
import { jobsRouter } from './routes/jobs.routes.js';
import { employmentTypesRouter } from './routes/employmentTypes.routes.js';
import { applicationsRouter } from './routes/applications.routes.js';
import { consentRouter } from './routes/consent.routes.js';
import { statusRouter } from './routes/status.routes.js';
import { createAuthRouter } from './routes/auth.routes.js';
import { createAdminRouter } from './routes/admin.routes.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

// Deutsche Standardmeldungen für alle zod-Schemas; Formularfelder haben zusätzlich eigene,
// verständlichere Meldungen direkt im Schema.
z.config(z.locales.de());

export function createApp(env = process.env) {
  const config = loadConfig(env);
  const app = express();

  // Genau ein Proxy (nginx) vor der API: X-Forwarded-Proto von dort wird übernommen, damit
  // req.secure hinter einem TLS-Proxy stimmt und express-session das Secure-Cookie setzt.
  app.set('trust proxy', 1);
  // Zugriffsprotokoll ohne personenbezogene Daten (REQUEST_LOG=false schaltet es ab, z. B. in Tests).
  if (config.requestLog) app.use(requestLog);
  // Security-Header. Die API liefert nur JSON und PDF-Downloads (immer als Anhang), nie eine Seite,
  // die Skripte, Stile oder Bilder laden müsste – daher die strengste Policy (Empfehlung des OWASP
  // REST Security Cheat Sheet): nichts erlaubt, nicht einbettbar. Die SPA hat ihre eigene Policy in
  // web/nginx.conf.
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
    },
    frameguard: { action: 'deny' },
  }));

  // Rate-Limits je Route (vor dem Lesen des Bodys – eine zu häufige Bewerbung wird abgelehnt,
  // bevor bis zu 5 MB hochgeladen sind). Das Limit je Konto beim Login sitzt im Auth-Router, weil
  // es die E-Mail aus dem Body braucht.
  const limits = createRateLimits(config.rateLimits);
  app.post('/api/jobs/:id/applications', limits.apply);
  app.get('/api/status/:token', limits.status);
  app.post('/api/status/:token/withdraw', limits.withdraw);
  app.post('/api/auth/login', limits.loginIp);

  // Öffentlich und ohne Sitzung (kein Cookie): Karriereseite, Bewerbung, Status-Link.
  app.use('/api/health', healthRouter);
  app.use('/api/jobs/:id/applications', applicationsRouter);
  app.use('/api/jobs', jobsRouter);
  app.use('/api/employment-types', employmentTypesRouter);
  app.use('/api/consent', consentRouter);
  app.use('/api/status', statusRouter);

  // Intern: Sitzung nur unter /api/auth und /api/admin.
  const { middleware: sessionMiddleware, store } = createSession(config);
  const requireAuth = createRequireAuth(config);
  app.locals.sessionStore = store; // Tests schließen den Store am Ende
  app.use('/api/auth', createAuthRouter({ config, sessionMiddleware, requireAuth, loginAccountLimit: limits.loginAccount }));
  app.use('/api/admin', createAdminRouter({ sessionMiddleware, requireAuth }));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
