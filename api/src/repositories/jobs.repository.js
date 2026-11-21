// SQL-Zugriff auf Stellen. Ausschließlich parametrisierte Abfragen ($1, $2 …).
import { query } from '../db.js';

// Veröffentlichte Stellen, optional gefiltert; neueste zuerst.
export async function findPublished({ location = null, employmentType = null } = {}) {
  const { rows } = await query(
    `SELECT id, title, location, employment_type, published_at
       FROM job
      WHERE status = 'published'
        AND ($1::text IS NULL OR location = $1)
        AND ($2::text IS NULL OR employment_type = $2)
      ORDER BY published_at DESC, id DESC`,
    [location, employmentType],
  );
  return rows;
}

// Eine veröffentlichte Stelle oder null (Entwürfe und geschlossene Stellen sind nicht öffentlich).
export async function findPublishedById(id) {
  const { rows } = await query(
    `SELECT id, title, location, employment_type, description, published_at
       FROM job
      WHERE id = $1 AND status = 'published'`,
    [id],
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------------------------
// Stellenverwaltung (intern, UC6). Statuswechsel prüft der Trigger job_status_change (AT007).
// ---------------------------------------------------------------------------------------------

// Alle Stellen mit Anzahl der Bewerbungen je Stufe ({"received": 3, …}) und gesamt.
// Reihenfolge: Entwürfe, veröffentlichte, geschlossene; innerhalb jeweils neueste zuerst.
export async function findAllWithCounts() {
  const { rows } = await query(
    `SELECT j.id, j.title, j.location, j.employment_type, j.status, j.published_at, j.closed_at,
            j.created_at, j.updated_at,
            coalesce(c.stage_counts, '{}'::json) AS stage_counts,
            coalesce(c.total, 0)                 AS application_count
       FROM job j
       LEFT JOIN (SELECT job_id, json_object_agg(stage, n) AS stage_counts, sum(n)::int AS total
                    FROM (SELECT job_id, stage, count(*)::int AS n
                            FROM application
                           GROUP BY job_id, stage) per_stage
                   GROUP BY job_id) c ON c.job_id = j.id
      ORDER BY CASE j.status WHEN 'draft' THEN 1 WHEN 'published' THEN 2 ELSE 3 END,
               j.created_at DESC, j.id DESC`,
  );
  return rows;
}

export async function findById(id) {
  const { rows } = await query(
    `SELECT j.id, j.title, j.location, j.employment_type, j.description, j.status,
            j.published_at, j.closed_at, j.created_at, j.updated_at, u.display_name AS created_by_name
       FROM job j JOIN internal_user u ON u.id = j.created_by
      WHERE j.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

// Neue Stelle, immer als Entwurf.
export async function insertDraft({ title, location, employmentType, description, createdBy }) {
  const { rows } = await query(
    `INSERT INTO job (title, location, employment_type, description, status, created_by)
     VALUES ($1, $2, $3, $4, 'draft', $5)
     RETURNING id`,
    [title, location, employmentType, description, createdBy],
  );
  return rows[0].id;
}

// Nur übergebene Felder ändern (NULL = unverändert); geschlossene Stellen nicht.
// Ergebnis: true = geändert, false = Stelle fehlt oder ist geschlossen.
export async function updateFields(id, { title = null, location = null, employmentType = null, description = null }) {
  const { rowCount } = await query(
    `UPDATE job
        SET title           = coalesce($2, title),
            location        = coalesce($3, location),
            employment_type = coalesce($4, employment_type),
            description     = coalesce($5, description),
            updated_at      = now()
      WHERE id = $1 AND status <> 'closed'`,
    [id, title, location, employmentType, description],
  );
  return rowCount === 1;
}

// Statuswechsel; ob er erlaubt ist, entscheidet der Trigger (sonst Fehler AT007).
// Ergebnis: true = gewechselt, false = Stelle fehlt oder hat diesen Status schon (der Trigger
// ließe einen "Wechsel" auf denselben Status sonst stillschweigend durch).
export async function changeStatus(id, status) {
  const { rowCount } = await query(
    `UPDATE job SET status = $2, updated_at = now() WHERE id = $1 AND status <> $2`,
    [id, status],
  );
  return rowCount === 1;
}
