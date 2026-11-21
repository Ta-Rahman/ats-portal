// Löschlauf von Hand (gleiche Logik wie der tägliche Lauf):
//   docker compose exec -T api npm run -s loeschlauf
//   docker compose exec -T api npm run -s loeschlauf -- --stichtag 2000-01-01
// --stichtag JJJJ-MM-TT (00:00 UTC) löscht nur Bewerbungen, deren Frist davor abgelaufen ist; ein
// Stichtag in der Zukunft wird von der Datenbank abgelehnt (AT009). Ohne Angabe gilt "jetzt".
// Ausgabe: eine Zeile Zusammenfassung. Exit-Code 0 = erledigt oder übersprungen (anderer Lauf aktiv),
// 1 = Fehler (Datenbank, Datei, ungültiger Aufruf).
import { pool } from '../db.js';
import { loadDeletionConfig } from '../config.js';
import { formatSummary, runDeletion } from '../services/deletion.service.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseCutoff(args) {
  const i = args.findIndex((a) => a === '--stichtag' || a.startsWith('--stichtag='));
  if (i === -1) {
    if (args.length) throw new Error(`Unbekannte Angabe: ${args.join(' ')}`);
    return null;
  }
  const value = args[i].includes('=') ? args[i].split('=')[1] : args[i + 1];
  const date = DATE_PATTERN.test(value ?? '') ? new Date(`${value}T00:00:00Z`) : null;
  if (!date || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error('--stichtag erwartet ein Datum JJJJ-MM-TT');
  }
  return date;
}

let exitCode = 0;
try {
  const cutoff = parseCutoff(process.argv.slice(2));
  const { orphanGraceSeconds } = loadDeletionConfig();
  const summary = await runDeletion({ cutoff, orphanGraceSeconds });
  console.log(formatSummary(summary));
  if (summary.errors > 0) exitCode = 1;
} catch (err) {
  const reason = err.code === 'AT009' ? 'Der Stichtag liegt in der Zukunft.' : err.message;
  console.error(`[loeschlauf] Löschlauf fehlgeschlagen: ${reason}`);
  exitCode = 1;
} finally {
  await pool.end();
}
process.exitCode = exitCode;
