// Verbindungspool zur PostgreSQL-Datenbank.
// pg liest die Verbindungsdaten aus PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE (docker-compose.yml).
import pg from 'pg';

export const pool = new pg.Pool({ max: 10 });

// Abfragen ausschließlich parametrisiert: query('... WHERE id = $1', [id]).
export function query(text, params = []) {
  return pool.query(text, params);
}

// Führt fn(client) in einer Transaktion aus: COMMIT bei Erfolg, ROLLBACK bei jedem Fehler.
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
