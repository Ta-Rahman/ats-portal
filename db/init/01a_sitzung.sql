-- 01a_sitzung.sql
-- Technische Tabelle für die Anmelde-Sitzungen der internen Nutzer (express-session mit dem
-- Store connect-pg-simple, siehe api/src/session.js). Sie liegt bewusst in einem eigenen Schema:
-- Sie gehört nicht zum fachlichen Datenmodell (kein ER-Diagramm, kein Fremdschlüssel, kein
-- Trigger) und nicht zum Fingerabdruck (db/werkzeuge/fingerprint.sql), weil ihr Inhalt flüchtig ist.
--
-- Aufbau wie von connect-pg-simple erwartet (node_modules/connect-pg-simple/table.sql); abweichend
-- davon ist expire timestamptz statt timestamp, damit der Ablaufzeitpunkt unabhängig von der
-- Zeitzone der Verbindung eindeutig ist (der Store schreibt und vergleicht mit to_timestamp()).
-- Angelegt wird sie hier und nicht zur Laufzeit (createTableIfMissing), damit das Schema vollständig
-- aus den Init-Skripten entsteht.

CREATE SCHEMA session_store;

CREATE TABLE session_store.session (
    sid    varchar     NOT NULL PRIMARY KEY,  -- Sitzungs-ID (Zufallswert von express-session)
    sess   json        NOT NULL,              -- Inhalt: userId, csrfToken, loginAt, Cookie-Daten
    expire timestamptz NOT NULL               -- Ablauf (Leerlauf-Timeout, bei jeder Anfrage verlängert)
);

-- Für das Aufräumen abgelaufener Sitzungen (DELETE … WHERE expire < now()).
CREATE INDEX session_expire_idx ON session_store.session (expire);
