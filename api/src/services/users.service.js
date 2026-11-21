// Fachlogik der Nutzerverwaltung (UC12, nur Admin): anlegen, Rolle ändern, (de)aktivieren.
// Eine Deaktivierung wirkt sofort: requireAuth liest is_active bei jeder Anfrage aus der Datenbank,
// eine offene Sitzung des Nutzers bekommt bei der nächsten Anfrage 401.
// Selbstschutz (eigenes Konto nicht herabstufen/deaktivieren) prüft dieser Service; dass immer ein
// aktiver Admin bleibt, prüft der Trigger internal_user_admin_guard (AT011).
import * as usersRepository from '../repositories/users.repository.js';
import { hashPassword } from '../password.js';
import { ConflictError, NotFoundError } from '../errors.js';

const USER_NOT_FOUND = 'Nutzer nicht gefunden';

function selfChangeError() {
  return new ConflictError('SELF_CHANGE_NOT_ALLOWED',
    'Sie können Ihr eigenes Konto nicht herabstufen oder deaktivieren.');
}

// Fehler der Datenbank in Antworten übersetzen; andere Fehler unverändert weiterreichen.
function translate(err) {
  if (err.code === 'AT011') {
    return new ConflictError('LAST_ADMIN', 'Der letzte aktive Admin kann nicht herabgestuft oder deaktiviert werden.');
  }
  return err;
}

export function listUsers() {
  return usersRepository.listAll();
}

async function getUser(id) {
  const user = await usersRepository.findById(id);
  if (!user) throw new NotFoundError(USER_NOT_FOUND);
  return user;
}

export async function createUser(data) {
  let id;
  try {
    id = await usersRepository.insert({
      email: data.email,
      passwordHash: await hashPassword(data.password),
      displayName: data.display_name,
      role: data.role,
    });
  } catch (err) {
    // 23505: E-Mail schon vergeben. Eigene Meldung, damit der Fehlertext von PostgreSQL (enthält die
    // E-Mail-Adresse) weder in die Antwort noch ins Server-Log gelangt.
    if (err.code === '23505') throw new ConflictError('EMAIL_TAKEN', 'Diese E-Mail-Adresse ist bereits vergeben.');
    throw err;
  }
  return getUser(id);
}

export async function changeRole(actorId, id, role) {
  if (id === actorId) throw selfChangeError();
  try {
    if (!(await usersRepository.setRole(id, role))) throw new NotFoundError(USER_NOT_FOUND);
  } catch (err) {
    throw translate(err);
  }
  return getUser(id);
}

export async function setActive(actorId, id, active) {
  if (id === actorId && !active) throw selfChangeError();
  try {
    if (!(await usersRepository.setActive(id, active))) throw new NotFoundError(USER_NOT_FOUND);
  } catch (err) {
    throw translate(err);
  }
  return getUser(id);
}
