// Einwilligungstext und Datenschutzhinweis des Bewerbungsformulars – einzige Quelle.
// Das Web holt beides über GET /api/consent; jede Bewerbung speichert die hier stehende Version
// (application.consent_version). Wird der Text geändert, muss auch die Version geändert werden.
// Versionen: v1-2026-01 (Iteration 2), v2-2026-11 (Datenschutzhinweis: doppelte Erwähnung des
// Rückzugs im vierten Satz entfernt). Die Seed-Bewerbungen (db/init/04_seed.sql) behalten
// v1-2026-01 – sie wurden unter dem damaligen Text abgegeben.
export const CONSENT = Object.freeze({
  version: 'v2-2026-11',
  text:
    'Ich willige ein, dass die Muster IT GmbH (fiktiv) meine Angaben aus diesem Formular und meinen ' +
    'Lebenslauf zur Durchführung dieses Bewerbungsverfahrens verarbeitet.',
  privacyNote:
    'Wir verarbeiten nur die Angaben aus diesem Formular – Name, E-Mail-Adresse, auf Wunsch ' +
    'Telefonnummer und Anschreiben – sowie Ihren Lebenslauf, und zwar ausschließlich für dieses ' +
    'Bewerbungsverfahren. Einsehen können sie nur die für die Personalauswahl zuständigen ' +
    'Mitarbeitenden. Sechs Monate nach Abschluss des Verfahrens werden Ihre Bewerbung und alle ' +
    'Dateien automatisch gelöscht. Über Ihren persönlichen Status-Link sehen Sie jederzeit den Stand. ' +
    'Dies ist ein Studienprojekt ' +
    'mit einem fiktiven Unternehmen – bitte geben Sie keine echten Daten ein. Solange das Verfahren ' +
    'läuft, können Sie Ihre Einwilligung jederzeit mit Wirkung für die Zukunft widerrufen, indem Sie ' +
    'Ihre Bewerbung über den Status-Link zurückziehen. Nach Abschluss des Verfahrens können Sie eine ' +
    'vorzeitige Löschung bei der Personalabteilung beantragen.',
});
