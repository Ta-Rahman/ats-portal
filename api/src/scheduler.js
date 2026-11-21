// Täglicher Löschlauf im API-Prozess, ohne zusätzliche Bibliothek: setTimeout bis zur nächsten
// eingestellten Uhrzeit (UTC), nach jedem Lauf neu planen. Kein Lauf beim Start – so bleibt der
// Datenbestand direkt nach einem Reset unverändert (Fingerabdruck-Vergleich), und ein verpasster
// Lauf (Container gestoppt) wird am nächsten Tag nachgeholt; bei 6 Monaten Frist ist das unkritisch.
import { formatSummary, runDeletion } from './services/deletion.service.js';

// Millisekunden von nowMs bis zum nächsten Zeitpunkt "HH:MM" UTC (heute, falls noch nicht vorbei).
export function msUntilNext(runTime, nowMs) {
  const [hours, minutes] = runTime.split(':').map(Number);
  const now = new Date(nowMs);
  let next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hours, minutes);
  if (next <= nowMs) next += 24 * 60 * 60 * 1000;
  return next - nowMs;
}

export function startDeletionSchedule({ runTime, orphanGraceSeconds }) {
  if (runTime === 'off') {
    console.log('[loeschlauf] Täglicher Löschlauf ist ausgeschaltet (DELETION_RUN_TIME=off).');
    return;
  }
  const planNext = () => {
    const delay = msUntilNext(runTime, Date.now());
    console.log(`[loeschlauf] Nächster Löschlauf: ${new Date(Date.now() + delay).toISOString()}`);
    setTimeout(async () => {
      try {
        console.log(formatSummary(await runDeletion({ orphanGraceSeconds })));
      } catch (err) {
        console.error('[loeschlauf] Löschlauf fehlgeschlagen:', err.code ?? '', err.message);
      }
      planNext();
    }, delay);
  };
  planNext();
}
