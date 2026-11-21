// Status-Token für den Bewerber-Link (UC4/UC5).
// Der Klartext wird genau einmal an die Bewerber:in ausgegeben; gespeichert wird nur der Hash.
// Der Klartext darf nie geloggt und nie an die Datenbank übergeben werden.
import { createHash, randomBytes } from 'node:crypto';

// 32 Zufallsbytes als base64url ergeben genau 43 Zeichen aus [A-Za-z0-9_-].
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generateToken() {
  return randomBytes(32).toString('base64url');
}

// SHA-256 (hex) über den Token-Text – Format von application.access_token_hash.
export function hashToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
