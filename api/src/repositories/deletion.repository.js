// SQL-Zugriff für den Löschlauf. Die Löschregel selbst steht in der Datenbank
// (db/init/02a_loeschlauf.sql, Funktion delete_due_applications); hier wird sie nur aufgerufen.
import { pool } from '../db.js';

// Schlüssel der Advisory-Sperre (pg_try_advisory_lock erwartet eine Zahl; hashtext bildet den Namen
// darauf ab). Gilt für alle Prozesse, die dieselbe Datenbank nutzen: API-Zeitplan und CLI.
const LOCK_NAME = 'ats-loeschlauf';

// Führt fn(client) unter einer Sitzungs-Sperre aus, die über den ganzen Lauf gehalten wird
// (Datenbank-Löschung, Dateien, verwaiste Dateien). Liefert null, wenn ein anderer Lauf die Sperre
// hält. Bricht die Verbindung ab, gibt PostgreSQL die Sperre selbst frei.
export async function withRunLock(fn) {
  const client = await pool.connect();
  let broken = null;
  try {
    const { rows } = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [LOCK_NAME]);
    if (!rows[0].locked) return null;
    try {
      return await fn(client);
    } finally {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [LOCK_NAME]).catch((err) => {
        broken = err; // Verbindung verwerfen statt mit gehaltener Sperre in den Pool zurückzugeben
      });
    }
  } finally {
    client.release(broken ?? undefined);
  }
}

// Löscht alle fälligen Bewerbungen (eigene Transaktion: ein einzelnes Statement, COMMIT bei Rückkehr).
// cutoff: Date oder null (= now() der Datenbank). Ergebnis: { deletedCount, storageKeys }.
export async function deleteDue(client, cutoff) {
  const { rows } = cutoff
    ? await client.query('SELECT deleted_count, storage_keys FROM delete_due_applications($1)', [cutoff])
    : await client.query('SELECT deleted_count, storage_keys FROM delete_due_applications()');
  return { deletedCount: rows[0].deleted_count, storageKeys: rows[0].storage_keys };
}

// Löschprotokoll (UC13) – nur Spalten ohne Personenbezug; Titel der Stelle und Bezeichnung der Stufe
// zur Anzeige (job_id hat bewusst keinen Fremdschlüssel, daher LEFT JOIN). Zeitraum je als Datum
// (UTC, einschließlich); null = offen. Höchstens 1000 Zeilen, neueste zuerst.
export async function listLog({ from = null, to = null }) {
  const { rows } = await pool.query(
    `SELECT d.id, d.job_id, j.title AS job_title, d.stage_at_deletion, s.label AS stage_label,
            d.closed_at, d.deleted_at, d.attachments_removed
       FROM deletion_log d
       LEFT JOIN job j            ON j.id = d.job_id
       LEFT JOIN pipeline_stage s ON s.code = d.stage_at_deletion
      WHERE ($1::date IS NULL OR d.deleted_at >= ($1::date)::timestamp AT TIME ZONE 'UTC')
        AND ($2::date IS NULL OR d.deleted_at <  ($2::date + 1)::timestamp AT TIME ZONE 'UTC')
      ORDER BY d.deleted_at DESC, d.id DESC
      LIMIT 1000`,
    [from, to],
  );
  return rows;
}

// Alle storage_keys, zu denen es eine Anhang-Zeile gibt (für die Suche nach verwaisten Dateien).
export async function referencedStorageKeys(client) {
  const { rows } = await client.query('SELECT storage_key::text AS key FROM attachment');
  return new Set(rows.map((r) => r.key));
}
