// SQL-Zugriff auf interne Nutzer. Ausschließlich parametrisierte Abfragen.
import { query } from '../db.js';

// Für die Anmeldung: Groß-/Kleinschreibung der E-Mail egal (wie der Unique-Index lower(email)).
export async function findByEmail(email) {
  const { rows } = await query(
    `SELECT id, email, password_hash, display_name, role, is_active
       FROM internal_user
      WHERE lower(email) = lower($1)`,
    [email],
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------------------------
// Nutzerverwaltung (UC12). Antworten nie mit password_hash. Der Schutz des letzten aktiven Admins
// steht als Trigger in der Datenbank (db/init/02b_nutzer.sql, AT011).
// ---------------------------------------------------------------------------------------------
const PUBLIC_COLUMNS = 'id, email, display_name, role, is_active, created_at';

export async function listAll() {
  const { rows } = await query(`SELECT ${PUBLIC_COLUMNS} FROM internal_user ORDER BY created_at, id`);
  return rows;
}

export async function findById(id) {
  const { rows } = await query(`SELECT ${PUBLIC_COLUMNS} FROM internal_user WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

// E-Mail doppelt (ohne Rücksicht auf Groß-/Kleinschreibung) → Fehler 23505 vom Unique-Index.
export async function insert({ email, passwordHash, displayName, role }) {
  const { rows } = await query(
    `INSERT INTO internal_user (email, password_hash, display_name, role)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [email, passwordHash, displayName, role],
  );
  return rows[0].id;
}

// Ergebnis: true = Nutzer gefunden (und gesetzt), false = nicht vorhanden.
export async function setRole(id, role) {
  const { rowCount } = await query('UPDATE internal_user SET role = $2 WHERE id = $1', [id, role]);
  return rowCount === 1;
}

export async function setActive(id, active) {
  const { rowCount } = await query('UPDATE internal_user SET is_active = $2 WHERE id = $1', [id, active]);
  return rowCount === 1;
}

// Für jede Anfrage mit Sitzung: nur aktive Nutzer, ohne Passwort-Hash.
export async function findActiveById(id) {
  const { rows } = await query(
    `SELECT id, email, display_name, role
       FROM internal_user
      WHERE id = $1 AND is_active`,
    [id],
  );
  return rows[0] ?? null;
}
