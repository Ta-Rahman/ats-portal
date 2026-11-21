// Passwortprüfung mit bcrypt (Bibliothek bcryptjs: reines JavaScript, kein nativer Build im
// Alpine-Image). Die Seed-Hashes ($2a$12$…) werden direkt geprüft; Kosten 12 laut Konzept P3.
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';

export const BCRYPT_COST = 12;

// Ersatz-Hash für unbekannte E-Mail-Adressen: Es wird trotzdem ein vollständiger bcrypt-Vergleich
// mit denselben Kosten gerechnet, damit die Antwortzeit nicht verrät, ob es die Adresse gibt.
// Einmal beim Start aus einem Zufallswert erzeugt – kein Passwort passt dazu.
const DUMMY_HASH = bcrypt.hashSync(randomBytes(32).toString('hex'), BCRYPT_COST);

// hash = null bei unbekanntem Nutzer → Vergleich gegen DUMMY_HASH, Ergebnis immer false.
export async function verifyPassword(password, hash) {
  const ok = await bcrypt.compare(password, hash ?? DUMMY_HASH);
  return hash ? ok : false;
}

export function hashPassword(password, cost = BCRYPT_COST) {
  return bcrypt.hash(password, cost);
}
