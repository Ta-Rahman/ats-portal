// Startpunkt der API im Container.
import { createApp } from './app.js';
import { loadConfig, loadDeletionConfig } from './config.js';
import { startDeletionSchedule } from './scheduler.js';

const port = Number(process.env.PORT) || 3000;
const deletionConfig = loadDeletionConfig();

createApp().listen(port, () => {
  console.log(`ATS-API lauscht auf Port ${port}`);
  if (loadConfig().cookieSecure) {
    console.log('Sitzungs-Cookie: Secure an (COOKIE_SECURE=true) – Anmeldung nur über HTTPS');
  }
  // Täglicher Löschlauf nur im Server-Prozess (nicht in Tests oder der CLI).
  startDeletionSchedule(deletionConfig);
});
