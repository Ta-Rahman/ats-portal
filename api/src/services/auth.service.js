// Fachlogik der Anmeldung interner Nutzer.
import * as usersRepository from '../repositories/users.repository.js';
import { verifyPassword } from '../password.js';
import { HttpError } from '../errors.js';

// Eine Meldung für unbekannte E-Mail, falsches Passwort und deaktivierte Nutzer – sonst ließe
// sich ausprobieren, welche Adressen ein Konto haben.
export const LOGIN_FAILED_MESSAGE = 'Anmeldung fehlgeschlagen. Bitte prüfen Sie E-Mail-Adresse und Passwort.';

export function toPublicUser(user) {
  return { id: user.id, email: user.email, display_name: user.display_name, role: user.role };
}

// Liefert den Nutzer oder wirft 401. Der Passwortvergleich läuft in allen drei Fällen (bei
// unbekannter E-Mail gegen einen Ersatz-Hash), damit die Antwortzeit gleich bleibt.
export async function authenticate(email, password) {
  const user = await usersRepository.findByEmail(email);
  const passwordOk = await verifyPassword(password, user?.password_hash ?? null);
  if (!user || !passwordOk || !user.is_active) {
    throw new HttpError(401, 'INVALID_CREDENTIALS', LOGIN_FAILED_MESSAGE);
  }
  return toPublicUser(user);
}
