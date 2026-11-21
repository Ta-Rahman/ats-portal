// Löschlauf (Konzept P3 Löschkonzept, P5 Regel 4): täglich über scheduler.js und manuell über
// src/cli/loeschlauf.js. Ablauf unter einer Sperre (nie zwei Läufe gleichzeitig):
//   1. Datenbank: delete_due_applications() löscht die fälligen Bewerbungen samt Anhang-Zeilen,
//      Notizen und Historie, schreibt das Löschprotokoll und liefert die Dateinamen (COMMIT).
//   2. Dateien dieser Bewerbungen entfernen; eine fehlende Datei wird gezählt, ist aber kein Fehler.
//   3. Verwaiste Dateien entfernen: Dateien im Upload-Volume ohne Anhang-Zeile, die älter als die
//      Schonfrist sind (jüngere können zu einer gerade laufenden Bewerbung gehören).
// Ergebnis ist eine Zusammenfassung ohne Personenbezug (nur Zahlen).
import * as deletionRepository from '../repositories/deletion.repository.js';
import * as storage from '../storage.js';

export const SKIPPED_MESSAGE = 'Löschlauf übersprungen: Ein anderer Löschlauf ist noch aktiv.';

// cutoff: Date oder null (Stichtag = jetzt, Uhr der Datenbank)
// orphanGraceSeconds: Schonfrist für verwaiste Dateien
export async function runDeletion({ cutoff = null, orphanGraceSeconds }) {
  const started = Date.now();
  const result = await deletionRepository.withRunLock(async (client) => {
    const summary = {
      skipped: false,
      cutoff,
      applications: 0,
      files: 0,
      filesRemoved: 0,
      filesMissing: 0,
      orphansRemoved: 0,
      orphansKept: 0,
      errors: 0,
    };

    // 1. Datenbank (eigene Transaktion, danach COMMIT)
    const { deletedCount, storageKeys } = await deletionRepository.deleteDue(client, cutoff);
    summary.applications = deletedCount;
    summary.files = storageKeys.length;

    // 2. Dateien der gelöschten Bewerbungen
    for (const key of storageKeys) {
      try {
        if (await storage.removeIfExists(key)) summary.filesRemoved += 1;
        else summary.filesMissing += 1;
      } catch (err) {
        summary.errors += 1;
        console.error('[loeschlauf] Datei konnte nicht entfernt werden:', key, err.code);
      }
    }

    // 3. Verwaiste Dateien: zuerst die Dateien lesen, dann die Anhang-Zeilen – eine Datei, deren
    //    Bewerbung dazwischen gespeichert wird, ist dann entweder bekannt oder noch jung.
    const files = (await storage.listFiles()).filter((f) => storage.isStorageKey(f.name));
    const referenced = await deletionRepository.referencedStorageKeys(client);
    const graceLimit = Date.now() - orphanGraceSeconds * 1000;
    for (const file of files) {
      if (referenced.has(file.name)) continue;
      if (file.mtimeMs > graceLimit) {
        summary.orphansKept += 1;
        continue;
      }
      try {
        if (await storage.removeIfExists(file.name)) summary.orphansRemoved += 1;
      } catch (err) {
        summary.errors += 1;
        console.error('[loeschlauf] Verwaiste Datei konnte nicht entfernt werden:', file.name, err.code);
      }
    }
    return summary;
  });

  const summary = result ?? { skipped: true, cutoff };
  summary.durationMs = Date.now() - started;
  summary.orphanGraceSeconds = orphanGraceSeconds;
  return summary;
}

// Löschprotokoll für Admins (UC13); from/to: 'JJJJ-MM-TT' oder undefined.
export function listDeletionLog({ from, to }) {
  return deletionRepository.listLog({ from: from ?? null, to: to ?? null });
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Eine Zeile für Log und CLI, nur Zahlen.
export function formatSummary(s) {
  if (s.skipped) return `[loeschlauf] ${SKIPPED_MESSAGE}`;
  const cutoff = s.cutoff ? s.cutoff.toISOString() : 'jetzt';
  return `[loeschlauf] Stichtag ${cutoff}: ${plural(s.applications, 'Bewerbung', 'Bewerbungen')} gelöscht, `
    + `${s.filesRemoved} von ${s.files} Dateien entfernt, ${s.filesMissing} fehlten, `
    + `${s.orphansRemoved} verwaiste Dateien entfernt, ${s.orphansKept} verwaiste behalten `
    + `(jünger als ${s.orphanGraceSeconds} s), ${plural(s.errors, 'Fehler', 'Fehler')}, ${s.durationMs} ms`;
}
