// SQL-Zugriff auf die Beschäftigungsarten (Stammdatentabelle employment_type, Iteration 5).
import { query } from '../db.js';

export async function findAll() {
  const { rows } = await query('SELECT code, label FROM employment_type ORDER BY sort_order');
  return rows;
}

export async function exists(code) {
  const { rows } = await query('SELECT 1 FROM employment_type WHERE code = $1', [code]);
  return rows.length === 1;
}
