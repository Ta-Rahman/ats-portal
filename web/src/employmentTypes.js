// Beschäftigungsarten von der API (einzige Quelle: Tabelle employment_type, GET /api/employment-types).
// Einmal je Seitenaufruf geladen und in einem reaktiven Wert gehalten: Listen und Auswahlfelder zeigen
// die Bezeichnungen, sobald die Liste da ist; bis dahin (oder bei Fehler) erscheint der Code.
import { ref } from 'vue';
import { fetchEmploymentTypes } from './api.js';

export const employmentTypes = ref([]); // [{ code, label }] in Anzeigereihenfolge

let pending = null;

export function loadEmploymentTypes() {
  if (!pending) {
    pending = fetchEmploymentTypes()
      .then((list) => {
        employmentTypes.value = list;
        return list;
      })
      .catch((err) => {
        pending = null; // beim nächsten Aufruf erneut versuchen
        throw err;
      });
  }
  return pending;
}

// Bezeichnung zu einem Code; im Template aufgerufen, daher reaktiv auf employmentTypes.
export function employmentTypeLabel(code) {
  return employmentTypes.value.find((t) => t.code === code)?.label ?? code;
}

// Für Komponenten, die nur anzeigen: laden, Fehler still (dann bleibt der Code sichtbar).
export function useEmploymentTypes() {
  loadEmploymentTypes().catch(() => {});
  return employmentTypes;
}
