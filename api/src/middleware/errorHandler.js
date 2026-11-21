// Zentrale Fehlerbehandlung: Details nur ins Server-Log, an den Client nur Code und Meldung.
// Stacktraces, SQL-Fehlertexte oder Dateipfade gelangen nie in die Antwort.
import { HttpError } from '../errors.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Ressource nicht gefunden' } });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    const body = { code: err.code, message: err.message };
    if (err.details) body.details = err.details;
    return res.status(err.status).json({ error: body });
  }

  // Von Express/body-parser erzeugte Client-Fehler (z. B. kaputtes JSON, fehlerhafte URL-Kodierung)
  const status = Number(err.status || err.statusCode);
  if (status >= 400 && status < 500) {
    return res.status(status).json({ error: { code: 'BAD_REQUEST', message: 'Fehlerhafte Anfrage' } });
  }

  console.error(err);
  return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Interner Serverfehler' } });
}
