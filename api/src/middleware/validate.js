// Validierung je Route mit zod. Geprüfte und umgewandelte Werte landen in req.validated
// (in Express 5 ist req.query nur lesbar). Fehler → 400 mit Feldliste, ohne interne Details.
// Jede Meldung gehört zu genau einem Feld, damit das Formular sie neben dem Feld anzeigen kann.
import { ValidationError } from '../errors.js';

// zod-Fehler in die Detail-Liste der JSON-Antwort umwandeln (location = params/query/body).
export function issuesToDetails(issues, location) {
  const details = [];
  for (const issue of issues) {
    if (issue.code === 'unrecognized_keys') {
      // Ein Eintrag je unbekanntem Feld statt einer Sammelmeldung.
      for (const key of issue.keys) {
        details.push({ location, field: key, message: `Unbekanntes Feld „${key}“.` });
      }
    } else {
      details.push({ location, field: issue.path.join('.'), message: issue.message });
    }
  }
  return details;
}

// Asynchron (safeParseAsync), weil einzelne Felder gegen Stammdaten in der Datenbank geprüft werden
// (Beschäftigungsart); Express 5 reicht Fehler aus async-Middleware an den Fehlerhandler weiter.
export function validate(schemas) {
  return async (req, res, next) => {
    const validated = {};
    const details = [];
    for (const part of ['params', 'query', 'body']) {
      if (!schemas[part]) continue;
      const result = await schemas[part].safeParseAsync(req[part] ?? {});
      if (result.success) {
        validated[part] = result.data;
      } else {
        details.push(...issuesToDetails(result.error.issues, part));
      }
    }
    if (details.length) return next(new ValidationError(details));
    req.validated = validated;
    return next();
  };
}
