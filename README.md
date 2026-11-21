# ATS-Portal – Code zum Projektbericht

Schlankes Bewerbermanagementportal (Applicant Tracking System) für ein fiktives IT-Unternehmen: Karriereseite,
Bewerbung mit PDF-Lebenslauf, Status-Link ohne Konto, interne Pipeline, Nutzerverwaltung und automatische Löschung.
Stand: Commit 3d196e7 vom 21.11.2026.

## Voraussetzungen

- Docker mit Compose v2 (Docker Desktop oder Docker Engine)
- Node.js ≥ 22 mit npm auf dem Host – nur für `npm test` (Web-Tests) und den Lasttest; die übrigen Tests laufen
  in den Containern. Es werden keine npm-Pakete auf dem Host installiert.

## Start in drei Schritten

```bash
cd ats-portal                          # 1. ZIP entpacken, in den Ordner wechseln
cp .env.example .env                   # 2. Konfiguration mit Entwicklungswerten anlegen
docker compose up -d --build --wait    # 3. Images bauen und starten
```

Beim ersten Start legt `db` Schema, Regeln, Stammdaten und Seed an und führt die DB-Tests aus; erst danach ist die
Umgebung bereit. Adresse: <http://localhost:8090> (Karriereseite), interner Bereich unter
<http://localhost:8090/intern/anmelden>. Host-Ports nur an 127.0.0.1: Web 8090 (`WEB_HOST_PORT`), PostgreSQL 5434
(`DB_HOST_PORT`), beide in `.env` änderbar. Container- und Volume-Namen sind fest (`ats-db`, `ats-api`, `ats-web`,
`ats-pgdata`, `ats-uploads`). Neu aufsetzen (löscht alle Daten): `docker compose down -v`, dann Schritt 3.

## Zugänge aus dem Seed

| E-Mail | Rolle | Passwort |
|---|---|---|
| admin@muster-it.example | Admin | Entwicklung-2026 |
| recruiting@muster-it.example | Recruiter | Entwicklung-2026 |

Das sind synthetische Demo-Konten nur für den lokalen Betrieb; vor jedem echten Einsatz müssen die Passwörter und
alle Werte in `.env` (Datenbank-Passwort, `SESSION_SECRET`) geändert werden. Alle Daten im Seed sind erfunden.

## Tests

Die Tests laufen gegen die gestartete Umgebung (Schritt 3):

```bash
npm test             # alles, Exit-Code 0 = bestanden
npm run test:db      # DB-Regeltests im Container db       (76 Fälle, db/init/05_tests.sql)
npm run test:api     # API-Tests im Container api          (204 Tests, api/test/)
npm run test:web     # nginx von außen, auf dem Host       (5 Tests, web/test/nginx.test.mjs)
```

Nach `npm test` sind die Daten wieder wie nach dem Start: Die Tests entfernen ihre Testdaten selbst.

**Lasttest** (nicht Teil von `npm test`): `npm run lasttest` – 20 parallele Verbindungen auf `GET /api/jobs`,
5 s Aufwärmen, 30 s Messung, 3 Läufe; Soll p95 ≤ 100 ms und 0 Fehler je Lauf (Exit-Code 2, wenn verfehlt).
Ergebnisse auf der Konsole; `npm run lasttest -- --out <ordner>` speichert sie zusätzlich als Textdateien.
Skript: `werkzeuge/lasttest/lasttest.mjs`.

Weitere Befehle:

```bash
npm run loeschlauf                                                                     # Löschlauf von Hand
docker compose exec -T db psql -U ats -d ats -At -f - < db/werkzeuge/fingerprint.sql   # Fingerabdruck der Daten
```

## Inhalt des ZIP

Erzeugt aus der Liste der Dateien in diesem ZIP (Anzahl Dateien je Ordner, Unterordner eingerechnet):

```
./                      6  Compose-Datei, .env.example, .gitattributes, package.json (Testaufrufe), README.md, HINWEIS_MARKE.md
api/                    4  Dockerfile und Paketdateien der API
api/src/               45  Express-API: routes → services → repositories, middleware, schemas, cli (Löschlauf)
api/test/              14  API-Tests (node:test + supertest)
db/                     2  Dockerfile des PostgreSQL-Images, Aufruf der DB-Tests
db/init/                8  Init-Skripte: Schema, Regeln (Trigger), Löschlauf, Nutzer, Stammdaten, Seed, DB-Tests
db/werkzeuge/           1  Abfrage für den Fingerabdruck der Daten
web/                    7  Dockerfile, nginx- und Vite-Konfiguration, Paketdateien der SPA
web/public/             4  Schrift Geist mit Lizenztext, Logo, Favicon
web/src/               25  Vue-SPA: Ansichten, Komponenten, Design-Tokens
web/test/               1  Web-Tests (nginx von außen)
werkzeuge/lasttest/     1  Lasttest der Stellenliste
gesamt                118  Dateien
```

## Lizenzen und Hinweise

- **Schrift Geist** (`web/public/fonts/geist-latin-wght-normal.woff2`): SIL Open Font License 1.1, Lizenztext in
  `web/public/fonts/OFL.txt`.
- **Logo und Favicon** (`web/public/marke/lockup-horizontal.svg`, `web/public/favicon.svg`): Marke Clear Cut
  Solutions, siehe `HINWEIS_MARKE.md`.
- npm-Abhängigkeiten sind nicht im ZIP; `docker compose up --build` lädt sie nach `api/package-lock.json` und
  `web/package-lock.json`, ihre Lizenzen liegen in den jeweiligen Paketen.

Erstellt mit Unterstützung von Claude Code (KI-Werkzeug); Einsatz dokumentiert im Projektbericht.
