// Annahme des Lebenslaufs (multipart/form-data) mit multer.
// memoryStorage: Die Datei liegt bis zur Prüfung (Magic Bytes, Stelle, Felder) nur im Speicher;
// erst eine vollständig geprüfte Bewerbung wird ins Upload-Volume geschrieben. Der Speicherbedarf
// ist durch fileSize (5 MB) und files (1) begrenzt.
import multer from 'multer';
import { PayloadTooLargeError, ValidationError } from '../errors.js';

export const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB, wie CHECK attachment.size_bytes

const upload = multer({
  storage: multer.memoryStorage(),
  defParamCharset: 'utf8', // Umlaute im Dateinamen korrekt lesen (Standard wäre latin1)
  limits: {
    files: 1,
    fileSize: MAX_FILE_BYTES,
    fields: 8, // 7 erwartete Textfelder + 1, damit ein unbekanntes Feld eine eigene Meldung bekommt
    fieldSize: 64 * 1024, // Anschreiben: 10 000 Zeichen à bis zu 4 Byte UTF-8 + Reserve
    fieldNameSize: 50,
    parts: 9,
  },
});

const single = upload.single('cv');

function bodyError(field, message) {
  return new ValidationError([{ location: 'body', field: field ?? '', message }], 'Bitte prüfen Sie Ihre Angaben.');
}

// Übersetzt Fehler von multer/busboy in die JSON-Fehler der API (413 bzw. 400).
function translate(err) {
  switch (err.code) {
    case 'LIMIT_FILE_SIZE':
      return new PayloadTooLargeError('Die Datei ist größer als 5 MB.', 'cv');
    case 'LIMIT_FILE_COUNT':
      return bodyError('cv', 'Bitte laden Sie nur eine Datei hoch.');
    case 'LIMIT_UNEXPECTED_FILE':
      return bodyError(err.field, `Unerwartete Datei im Feld „${err.field ?? ''}“.`);
    case 'LIMIT_FIELD_VALUE':
      return bodyError(err.field, 'Der Inhalt dieses Feldes ist zu lang.');
    case 'LIMIT_FIELD_KEY':
    case 'LIMIT_FIELD_COUNT':
    case 'LIMIT_PART_COUNT':
      return bodyError(undefined, 'Das Formular enthält zu viele oder ungültige Felder.');
    default:
      // Fehlerhaft aufgebaute multipart-Daten (z. B. abgebrochener Upload) sind Client-Fehler.
      return bodyError(undefined, 'Die Formulardaten konnten nicht gelesen werden.');
  }
}

export function uploadCv(req, res, next) {
  single(req, res, (err) => (err ? next(translate(err)) : next()));
}
