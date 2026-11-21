// Dateiablage für Lebensläufe im Volume ats-uploads (außerhalb des Webroots, nicht von nginx
// erreichbar). Dateiname ist immer der zufällige storage_key (UUID), nie der Originalname.
import { readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const UPLOAD_DIR = process.env.UPLOAD_DIR || '/app/uploads';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function filePath(storageKey) {
  // Schutz gegen Pfadangaben: nur UUIDs werden als Dateiname akzeptiert.
  if (!UUID_PATTERN.test(storageKey)) throw new Error('Ungültiger storage_key');
  return path.join(UPLOAD_DIR, storageKey);
}

// Legt die Datei neu an; 'wx' schlägt fehl, falls es den Namen schon gibt (nie überschreiben).
export async function writeNew(storageKey, buffer) {
  await writeFile(filePath(storageKey), buffer, { flag: 'wx', mode: 0o600 });
}

// Liest die Datei vollständig (höchstens 5 MB, siehe CHECK attachment.size_bytes).
export function read(storageKey) {
  return readFile(filePath(storageKey));
}

// Entfernt die Datei; fehlt sie bereits, ist das kein Fehler.
export async function remove(storageKey) {
  try {
    await unlink(filePath(storageKey));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

// Für den Löschlauf: true = entfernt, false = Datei fehlte bereits; andere Fehler werden geworfen.
export async function removeIfExists(storageKey) {
  try {
    await unlink(filePath(storageKey));
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

export const isStorageKey = (name) => UUID_PATTERN.test(name);

// Reguläre Dateien im Upload-Volume mit Änderungszeit (für die Suche nach verwaisten Dateien).
export async function listFiles() {
  const entries = await readdir(UPLOAD_DIR, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    try {
      const { mtimeMs } = await stat(path.join(UPLOAD_DIR, entry.name));
      files.push({ name: entry.name, mtimeMs });
    } catch (err) {
      if (err.code !== 'ENOENT') throw err; // inzwischen entfernt
    }
  }
  return files;
}

// PDF erkennt man an den Magic Bytes "%PDF-" am Dateianfang – Endung und vom Browser gemeldeter
// MIME-Typ sind frei wählbar und werden nicht ausgewertet. (Vereinfachung: Die PDF-Spezifikation
// erlaubt den Kopf auch innerhalb der ersten 1024 Bytes; hier muss er am Anfang stehen.)
const PDF_MAGIC = Buffer.from('%PDF-', 'latin1');

export function isPdf(buffer) {
  return buffer.length >= PDF_MAGIC.length && buffer.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC);
}

// Originaler Dateiname nur zur Anzeige: Pfadanteile, Steuerzeichen und in Dateisystemen bzw.
// HTTP-Headern problematische Zeichen entfernen, Länge begrenzen (DB: 1–255 Zeichen).
const FALLBACK_NAME = 'lebenslauf.pdf';

export function sanitizeFilename(name) {
  let s = String(name ?? '').normalize('NFC');
  s = s.split(/[\\/]/).pop();
  s = s.replace(/[\u0000-\u001f\u007f-\u009f<>:"|?*]/g, '');
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/^\.+/, '');
  if (s.length > 255) {
    const ext = path.extname(s).slice(0, 10);
    s = s.slice(0, 255 - ext.length) + ext;
  }
  return s || FALLBACK_NAME;
}
