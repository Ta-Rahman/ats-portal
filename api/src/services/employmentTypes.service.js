// Beschäftigungsarten: einzige Quelle ist die Tabelle employment_type. API (Validierung) und
// Oberfläche (Filter, Formular) fragen sie hier ab, statt eigene Listen zu führen.
import * as employmentTypesRepository from '../repositories/employmentTypes.repository.js';

export const INVALID_EMPLOYMENT_TYPE_MESSAGE = 'Bitte wählen Sie eine gültige Beschäftigungsart.';

// Format wie der CHECK auf employment_type.code; erspart unsinnige Werte die Datenbankabfrage.
const CODE_PATTERN = /^[a-z_]{1,40}$/;

export function listEmploymentTypes() {
  return employmentTypesRepository.findAll();
}

// Für die Schema-Validierung (zod refine): true, wenn der Code in der Tabelle steht.
export async function isKnownEmploymentType(code) {
  return typeof code === 'string' && CODE_PATTERN.test(code) && employmentTypesRepository.exists(code);
}
