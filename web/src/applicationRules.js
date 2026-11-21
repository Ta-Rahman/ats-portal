// Vorabprüfung des Bewerbungsformulars im Browser – spiegelt die Regeln der API
// (api/src/schemas/application.schema.js, api/src/middleware/upload.js) mit denselben Meldungen.
// Maßgeblich bleibt die Prüfung auf dem Server.

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_COVER_LETTER = 10000;

// Reihenfolge der Felder im Formular (auch Reihenfolge in der Fehlerübersicht)
export const FIELD_ORDER = ['first_name', 'last_name', 'email', 'phone', 'cover_letter', 'cv', 'consent'];

const NO_CONTROL_CHARS = /^[^\u0000-\u001f\u007f]*$/;
const PHONE_CHARS = /^[0-9+\-/() ]+$/;
// Grobe Formprüfung; die genaue Prüfung macht der Server.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function checkName(value, missing, tooLong, invalid) {
  const v = value.trim();
  if (v === '') return missing;
  if (v.length > 100) return tooLong;
  if (!NO_CONTROL_CHARS.test(v)) return invalid;
  return null;
}

// PDF erkennt man an den ersten fünf Bytes "%PDF-" (wie auf dem Server).
async function startsWithPdfMagic(file) {
  const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  return String.fromCharCode(...head) === '%PDF-';
}

// values: { first_name, last_name, email, phone, cover_letter, consent (boolean) }, file: File | null
// Ergebnis: { feld: meldung } – leer, wenn alles passt.
export async function checkApplication(values, file) {
  const errors = {};
  const set = (field, message) => {
    if (message) errors[field] = message;
  };

  set('first_name', checkName(values.first_name,
    'Bitte geben Sie Ihren Vornamen an.',
    'Der Vorname darf höchstens 100 Zeichen lang sein.',
    'Der Vorname enthält unzulässige Zeichen.'));
  set('last_name', checkName(values.last_name,
    'Bitte geben Sie Ihren Nachnamen an.',
    'Der Nachname darf höchstens 100 Zeichen lang sein.',
    'Der Nachname enthält unzulässige Zeichen.'));

  const email = values.email.trim();
  if (!EMAIL_SHAPE.test(email)) set('email', 'Bitte geben Sie eine gültige E-Mail-Adresse an.');
  else if (email.length > 254) set('email', 'Die E-Mail-Adresse darf höchstens 254 Zeichen lang sein.');

  const phone = values.phone.trim();
  if (phone !== '') {
    if (phone.length < 3) set('phone', 'Die Telefonnummer muss mindestens 3 Zeichen lang sein.');
    else if (phone.length > 40) set('phone', 'Die Telefonnummer darf höchstens 40 Zeichen lang sein.');
    else if (!PHONE_CHARS.test(phone)) {
      set('phone', 'Die Telefonnummer darf nur Ziffern, Leerzeichen und + - / ( ) enthalten.');
    }
  }

  if (values.cover_letter.length > MAX_COVER_LETTER) {
    set('cover_letter', 'Das Anschreiben darf höchstens 10 000 Zeichen lang sein.');
  }

  if (!file) set('cv', 'Bitte laden Sie Ihren Lebenslauf als PDF hoch.');
  else if (file.size > MAX_FILE_BYTES) set('cv', 'Die Datei ist größer als 5 MB.');
  else if (!(await startsWithPdfMagic(file))) {
    set('cv', 'Die Datei ist kein PDF. Bitte laden Sie Ihren Lebenslauf als PDF-Datei hoch.');
  }

  if (!values.consent) set('consent', 'Bitte bestätigen Sie die Einwilligung.');

  return errors;
}
