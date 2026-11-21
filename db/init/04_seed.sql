-- 04_seed.sql
-- Synthetische Beispieldaten für die Entwicklung (fiktives Unternehmen "Muster IT GmbH (fiktiv)").
-- Deterministisch: alle Werte stehen fest im Skript, es gibt keinen Zufall und keine aktuelle Uhrzeit;
-- Stichtag der Daten ist der 01.11.2026, alle Zeitpunkte liegen davor.
--
-- Inhalt: 2 interne Nutzer (Admin, Recruiter), 8 Stellen (5 veröffentlicht, 1 Entwurf, 2 geschlossen),
-- 25 Bewerbungen über alle Pipeline-Stufen, 5 Notizen, keine Anhänge.
--
-- Ablauf der Stellen (Regel AT008: neue Stelle nur als Entwurf):
--   Alle Stellen werden als Entwurf angelegt, die nicht als Entwurf geplanten über den Trigger
--   job_status_change veröffentlicht; danach ersetzt ein UPDATE ohne status in der SET-Liste den
--   vom Trigger gesetzten Zeitpunkt (now()) durch den festen Wert.
--
-- Ablauf der Bewerbungen:
--   1. Jede Bewerbung wird in 'received' angelegt (die Stellen sind dabei noch veröffentlicht).
--   2. Ihr Weg durch die Pipeline wird über den echten Trigger nachgespielt – damit sind die
--      Seed-Daten garantiert regelkonform und status_history entsteht wie im Betrieb.
--   3. Danach werden die vom Trigger gesetzten Zeitstempel durch feste Werte ersetzt
--      (ein UPDATE ohne stage in der SET-Liste löst den Trigger nicht aus).
--   4. Zuletzt werden die zwei geschlossenen Stellen geschlossen.
--
-- Dev-Zugang (nur lokal): beide Nutzer haben das Passwort "Entwicklung-2026"
-- (bcrypt, Kosten 12, einmalig erzeugt mit pgcrypto crypt()/gen_salt('bf', 12)).

-- ---------------------------------------------------------------------------------------------
-- Interne Nutzer
-- ---------------------------------------------------------------------------------------------
INSERT INTO internal_user (email, password_hash, display_name, role, is_active, created_at) VALUES
    ('admin@muster-it.example',      '$2a$12$vi3Rz3HtkT.F9ccG5y12qeP.tTN.ioVaJ97MBgUs5SqkIVDGuSkL.',
     'Jana Beispiel (Admin)', 'admin',     true, '2026-01-05 08:00:00+00'),
    ('recruiting@muster-it.example', '$2a$12$vi3Rz3HtkT.F9ccG5y12qeP.tTN.ioVaJ97MBgUs5SqkIVDGuSkL.',
     'Tom Muster (Recruiting)', 'recruiter', true, '2026-01-05 08:05:00+00');

-- ---------------------------------------------------------------------------------------------
-- Stellen (als Entwurf angelegt, alle außer dem Entwurf veröffentlicht; Schließen erfolgt am Ende)
-- ---------------------------------------------------------------------------------------------
CREATE TEMP TABLE seed_job (
    nr              integer PRIMARY KEY,
    title           text,
    location        text,
    employment_type text,
    description     text,
    status          text,          -- Zielstatus nach dem Seed
    created_at      timestamptz,
    published_at    timestamptz,
    closed_at       timestamptz,
    author          text
);

INSERT INTO seed_job VALUES
(1, 'Backend-Entwickler:in Node.js', 'Leipzig', 'full_time',
 E'Du entwickelst unsere internen und kundenseitigen Web-Services mit Node.js und PostgreSQL.\n\nAufgaben:\n- REST-APIs entwerfen und umsetzen\n- Datenbankschemata pflegen\n- Code-Reviews im Team\n\nProfil:\n- Erfahrung mit JavaScript und SQL\n- Freude an sauberem, getestetem Code',
 'published', '2026-09-10 09:00:00+00', '2026-09-15 09:00:00+00', NULL, 'recruiting'),
(2, 'Frontend-Entwickler:in Vue.js', 'Remote', 'full_time',
 E'Du gestaltest die Oberflächen unserer Kundenportale mit Vue 3.\n\nAufgaben:\n- Komponenten entwickeln und testen\n- Barrierefreiheit von Anfang an mitdenken\n- Eng mit Backend und Design zusammenarbeiten\n\nProfil:\n- Sicher in HTML, CSS und JavaScript\n- Erste Erfahrung mit Vue oder einem vergleichbaren Framework',
 'published', '2026-09-25 09:00:00+00', '2026-10-01 09:00:00+00', NULL, 'recruiting'),
(3, 'IT-Systemadministrator:in', 'Leipzig', 'full_time',
 E'Du betreust unsere Server, Netzwerke und Arbeitsplätze.\n\nAufgaben:\n- Linux- und Windows-Server betreiben\n- Backups und Updates planen\n- Ansprechperson für Kolleg:innen bei IT-Fragen\n\nProfil:\n- Ausbildung oder Studium in der IT\n- Strukturierte, zuverlässige Arbeitsweise',
 'published', '2026-08-15 09:00:00+00', '2026-08-20 09:00:00+00', NULL, 'recruiting'),
(4, 'Werkstudent:in Softwaretest', 'Leipzig', 'working_student',
 E'Du unterstützt unser Team bei der Qualitätssicherung (15–20 Stunden pro Woche).\n\nAufgaben:\n- Testfälle schreiben und ausführen\n- Fehler nachvollziehbar dokumentieren\n\nProfil:\n- Eingeschriebenes Studium (Informatik o. Ä.)\n- Genauigkeit und Neugier',
 'published', '2026-10-05 09:00:00+00', '2026-10-10 09:00:00+00', NULL, 'recruiting'),
(5, 'Technische:r Redakteur:in (Teilzeit)', 'Remote', 'part_time',
 E'Du schreibst Handbücher und Online-Hilfen für unsere Software (20 Stunden pro Woche).\n\nAufgaben:\n- Dokumentation erstellen und aktuell halten\n- Release Notes abstimmen\n\nProfil:\n- Sehr gutes Deutsch in Wort und Schrift\n- Interesse an technischen Themen',
 'published', '2026-10-15 09:00:00+00', '2026-10-20 09:00:00+00', NULL, 'recruiting'),
(6, 'DevOps Engineer', 'Remote', 'full_time',
 E'Entwurf – Stellenbeschreibung wird noch abgestimmt.\n\nAufgaben:\n- CI/CD-Pipelines aufbauen\n- Container-Umgebungen betreiben',
 'draft', '2026-10-28 09:00:00+00', NULL, NULL, 'admin'),
(7, 'Projektmanager:in IT', 'Leipzig', 'full_time',
 E'Du steuerst Kundenprojekte von der Anforderung bis zur Abnahme.\n\nAufgaben:\n- Projektplanung und -controlling\n- Abstimmung mit Kund:innen und Entwicklung\n\nProfil:\n- Erfahrung in IT-Projekten\n- Kommunikationsstärke',
 'closed', '2026-01-08 09:00:00+00', '2026-01-12 09:00:00+00', '2026-03-31 16:00:00+00', 'recruiting'),
(8, 'Support-Mitarbeiter:in (Teilzeit)', 'Leipzig', 'part_time',
 E'Du hilfst unseren Kund:innen per Telefon und Ticketsystem (25 Stunden pro Woche).\n\nAufgaben:\n- Anfragen annehmen und lösen\n- Wissensdatenbank pflegen\n\nProfil:\n- Freundlicher, geduldiger Umgang\n- Grundkenntnisse in IT',
 'closed', '2026-05-27 09:00:00+00', '2026-06-01 09:00:00+00', '2026-09-30 16:00:00+00', 'recruiting');

INSERT INTO job (title, location, employment_type, description, status, created_by,
                 created_at, updated_at)
SELECT s.title, s.location, s.employment_type, s.description, 'draft',
       (SELECT id FROM internal_user WHERE email = s.author || '@muster-it.example'),
       s.created_at, s.created_at
  FROM seed_job s
 ORDER BY s.nr;

-- Veröffentlichen über den Trigger (draft -> published), danach feste Zeitpunkte einsetzen.
UPDATE job j
   SET status = 'published'
  FROM seed_job s
 WHERE s.title = j.title AND s.status <> 'draft';

UPDATE job j
   SET published_at = s.published_at,
       updated_at   = coalesce(s.published_at, s.created_at)
  FROM seed_job s
 WHERE s.title = j.title;

-- ---------------------------------------------------------------------------------------------
-- Bewerbungen: Eingangszeitpunkt, Abstand zwischen zwei Statuswechseln (Tage), Weg ab 'received'
-- ---------------------------------------------------------------------------------------------
CREATE TEMP TABLE seed_application (
    nr         integer PRIMARY KEY,
    job_nr     integer,
    first_name text,
    last_name  text,
    email      text,
    phone      text,
    created_at timestamptz,
    step_days  integer,
    path       text[],
    rating     smallint
);

INSERT INTO seed_application VALUES
-- Stelle 7 (geschlossen 31.03.2026) – Löschfrist beider Bewerbungen liegt vor dem Stichtag
( 1, 7, 'Lena',   'Hartwig',   'lena.hartwig@example.org',    NULL,               '2026-01-20 09:00:00+00', 14, '{screening,interview,offer,hired}', 5),
( 2, 7, 'Malte',  'Kröger',    'malte.kroeger@example.org',   NULL,               '2026-01-25 09:00:00+00', 10, '{rejected}',                        2),
-- Stelle 8 (geschlossen 30.09.2026) – laufende Bewerbungen bleiben aktiv
( 3, 8, 'Sophie', 'Brandl',    'sophie.brandl@example.org',   '+49 000 0000003',  '2026-06-05 09:00:00+00', 15, '{screening,interview,offer,hired}', 4),
( 4, 8, 'Yusuf',  'Demir',     'yusuf.demir@example.org',     NULL,               '2026-06-10 09:00:00+00', 12, '{screening,rejected}',              2),
( 5, 8, 'Clara',  'Neubauer',  'clara.neubauer@example.org',  NULL,               '2026-06-18 09:00:00+00',  9, '{withdrawn}',                    NULL),
( 6, 8, 'Felix',  'Ostermann', 'felix.ostermann@example.org', NULL,               '2026-09-01 09:00:00+00', 14, '{screening,interview,offer}',       4),
-- Stelle 1
( 7, 1, 'Marie',  'Lindner',   'marie.lindner@example.org',   NULL,               '2026-10-28 09:00:00+00',  0, '{}',                             NULL),
( 8, 1, 'Paul',   'Eckhardt',  'paul.eckhardt@example.org',   NULL,               '2026-09-20 09:00:00+00', 10, '{screening}',                       3),
( 9, 1, 'Hanna',  'Vogt',      'hanna.vogt@example.org',      '+49 000 0000009',  '2026-09-17 09:00:00+00', 12, '{screening,interview}',             4),
(10, 1, 'Erik',   'Sander',    'erik.sander@example.org',     NULL,               '2026-09-22 09:00:00+00', 11, '{screening,interview}',             4),
(11, 1, 'Nora',   'Pfeiffer',  'nora.pfeiffer@example.org',   NULL,               '2026-09-25 09:00:00+00',  8, '{screening,interview,rejected}',    2),
(12, 1, 'Timo',   'Brenner',   'timo.brenner@example.org',    NULL,               '2026-09-18 09:00:00+00',  6, '{screening,withdrawn}',          NULL),
-- Stelle 2
(13, 2, 'Amira',  'Haddad',    'amira.haddad@example.org',    NULL,               '2026-10-25 09:00:00+00',  0, '{}',                             NULL),
(14, 2, 'Lukas',  'Reinholz',  'lukas.reinholz@example.org',  NULL,               '2026-10-30 09:00:00+00',  0, '{}',                             NULL),
(15, 2, 'Julia',  'Fenske',    'julia.fenske@example.org',    NULL,               '2026-10-05 09:00:00+00',  9, '{screening}',                       3),
(16, 2, 'Daniel', 'Kowalczyk', 'daniel.kowalczyk@example.org','+49 000 0000016',  '2026-10-03 09:00:00+00',  8, '{screening,interview}',             5),
(17, 2, 'Svenja', 'Albers',    'svenja.albers@example.org',   NULL,               '2026-10-07 09:00:00+00',  5, '{rejected}',                        1),
-- Stelle 3
(18, 3, 'Moritz', 'Heller',    'moritz.heller@example.org',   NULL,               '2026-10-12 09:00:00+00',  7, '{screening}',                       3),
(19, 3, 'Ida',    'Wendt',     'ida.wendt@example.org',       NULL,               '2026-09-02 09:00:00+00', 13, '{screening,interview}',             4),
(20, 3, 'Jan',    'Petersen',  'jan.petersen@example.org',    '+49 000 0000020',  '2026-08-25 09:00:00+00', 14, '{screening,interview,offer}',       5),
(21, 3, 'Leonie', 'Brück',     'leonie.brueck@example.org',   NULL,               '2026-08-28 09:00:00+00', 10, '{screening,interview,rejected}',    2),
(22, 3, 'Kemal',  'Aydin',     'kemal.aydin@example.org',     NULL,               '2026-09-05 09:00:00+00', 13, '{screening,interview,withdrawn}',   3),
-- Stelle 4
(23, 4, 'Mia',    'Schuster',  'mia.schuster@example.org',    NULL,               '2026-10-29 09:00:00+00',  0, '{}',                             NULL),
(24, 4, 'Noah',   'Wegener',   'noah.wegener@example.org',    NULL,               '2026-10-12 09:00:00+00',  6, '{screening}',                       3),
-- Stelle 5
(25, 5, 'Greta',  'Lorenz',    'greta.lorenz@example.org',    NULL,               '2026-10-26 09:00:00+00',  0, '{}',                             NULL);

-- Status-Token je Bewerbung: im Betrieb 32 Zufallsbytes als base64url (43 Zeichen). Im Seed fest
-- abgeleitet, damit Seed-Bewerbungen über den Status-Link erreichbar sind (Entwicklung, Tests):
--   token = base64url(sha256('seed-token-<nr>'))   (43 Zeichen, gleiches Format wie im Betrieb)
-- Gespeichert wird wie im Betrieb nur sha256(token) als Hex.
CREATE TEMP VIEW seed_application_token AS
SELECT s.*,
       rtrim(translate(encode(sha256(convert_to('seed-token-' || s.nr, 'UTF8')), 'base64'), '+/', '-_'),
             '=') AS token
  FROM seed_application s;

CREATE TEMP VIEW seed_application_map AS
SELECT t.*, encode(sha256(convert_to(t.token, 'UTF8')), 'hex') AS token_hash
  FROM seed_application_token t;

-- Bewertung wird nicht beim Anlegen gesetzt (Regel AT005), sondern danach per UPDATE.
INSERT INTO application (job_id, first_name, last_name, email, phone, cover_letter,
                         consent_given_at, consent_version, access_token_hash,
                         created_at, updated_at)
SELECT j.id, s.first_name, s.last_name, s.email, s.phone,
       CASE WHEN s.nr % 4 = 0 THEN NULL
            ELSE 'Synthetischer Beispieltext: Bewerbung von ' || s.first_name || ' ' || s.last_name
                 || ' auf die Stelle "' || sj.title || '".' END,
       s.created_at, 'v1-2026-01', s.token_hash,
       s.created_at, s.created_at
  FROM seed_application_map s
  JOIN seed_job sj ON sj.nr = s.job_nr
  JOIN job j ON j.title = sj.title
 ORDER BY s.nr;

UPDATE application a
   SET rating = s.rating
  FROM seed_application_map s
 WHERE a.access_token_hash = s.token_hash
   AND s.rating IS NOT NULL;

-- Weg durch die Pipeline über den Trigger nachspielen (Rückzug als Bewerber:in, sonst Recruiter).
DO $$
DECLARE
    r       record;
    v_stage text;
BEGIN
    PERFORM set_config('ats.user_id',
        (SELECT id::text FROM internal_user WHERE email = 'recruiting@muster-it.example'), true);
    FOR r IN
        SELECT a.id, s.path
          FROM seed_application_map s
          JOIN application a ON a.access_token_hash = s.token_hash
         ORDER BY s.nr
    LOOP
        FOREACH v_stage IN ARRAY r.path LOOP
            PERFORM set_config('ats.actor',
                CASE WHEN v_stage = 'withdrawn' THEN 'applicant' ELSE 'internal' END, true);
            UPDATE application SET stage = v_stage WHERE id = r.id;
        END LOOP;
    END LOOP;
END;
$$;

-- Feste Zeitstempel statt der vom Trigger gesetzten: n-ter Wechsel = Eingang + n * step_days.
UPDATE status_history h
   SET changed_at = s.created_at + (x.step_no * s.step_days) * interval '1 day'
  FROM (SELECT id, row_number() OVER (PARTITION BY application_id ORDER BY id) AS step_no
          FROM status_history) x,
       application a,
       seed_application_map s
 WHERE x.id = h.id
   AND a.id = h.application_id
   AND a.access_token_hash = s.token_hash;

UPDATE application a
   SET updated_at   = coalesce(l.last_change, a.created_at),
       closed_at    = CASE WHEN a.closed_at IS NOT NULL THEN l.last_change END,
       delete_after = CASE WHEN a.closed_at IS NOT NULL THEN retention_deadline(l.last_change) END
  FROM (SELECT ap.id,
               (SELECT max(h.changed_at) FROM status_history h WHERE h.application_id = ap.id) AS last_change
          FROM application ap) l
 WHERE l.id = a.id;

-- Geschlossene Stellen jetzt schließen (bestehende Bewerbungen laufen weiter). Der Wechsel läuft
-- über den Trigger job_status_change (published -> closed, setzt closed_at = now()); danach wird
-- closed_at wie bei den Bewerbungen durch den festen Wert ersetzt (ohne status in der SET-Liste
-- löst das UPDATE den Trigger nicht aus).
UPDATE job j
   SET status = 'closed'
  FROM seed_job s
 WHERE s.title = j.title AND s.status = 'closed';

UPDATE job j
   SET closed_at = s.closed_at, updated_at = s.closed_at
  FROM seed_job s
 WHERE s.title = j.title AND s.status = 'closed';

-- ---------------------------------------------------------------------------------------------
-- Notizen
-- ---------------------------------------------------------------------------------------------
INSERT INTO note (application_id, author_id, body, created_at)
SELECT a.id, u.id, n.body, n.created_at
  FROM (VALUES
        (1, 20, 'admin',      'Gehaltsrahmen mit der Geschäftsführung abgestimmt.',              '2026-10-04 14:00:00+00'::timestamptz),
        (2,  9, 'recruiting', 'Fachgespräch vereinbart; Erfahrung mit Node.js wirkt solide.',    '2026-10-08 10:30:00+00'),
        (3, 16, 'recruiting', 'Portfolio mit nachvollziehbaren Vue-3-Projekten.',                '2026-10-12 11:00:00+00'),
        (4,  6, 'recruiting', 'Angebot telefonisch angekündigt, Rückmeldung bis Ende Oktober.', '2026-10-13 15:00:00+00'),
        (5, 18, 'recruiting', 'Unterlagen vollständig, Zertifikate nachfordern.',                '2026-10-20 09:30:00+00')
       ) AS n (ord, app_nr, author, body, created_at)
  JOIN seed_application_map s ON s.nr = n.app_nr
  JOIN application a ON a.access_token_hash = s.token_hash
  JOIN internal_user u ON u.email = n.author || '@muster-it.example'
 ORDER BY n.ord;

-- Selbstprüfung: kein Zeitpunkt nach dem Stichtag, keine Bewerbung vor Veröffentlichung ihrer Stelle.
-- (delete_after liegt bewusst teils nach dem Stichtag und wird daher nicht geprüft.)
DO $$
DECLARE
    v_stichtag constant timestamptz := '2026-11-01 00:00:00+00';
    v_count    integer;
BEGIN
    SELECT count(*) INTO v_count FROM (
        SELECT created_at AS t FROM internal_user
        UNION ALL SELECT greatest(created_at, updated_at, published_at, closed_at) FROM job
        UNION ALL SELECT greatest(created_at, updated_at, consent_given_at, closed_at) FROM application
        UNION ALL SELECT changed_at FROM status_history
        UNION ALL SELECT created_at FROM note
    ) x WHERE x.t > v_stichtag;
    IF v_count > 0 THEN
        RAISE EXCEPTION 'Seed: % Zeitpunkt(e) nach dem Stichtag %', v_count, v_stichtag;
    END IF;

    SELECT count(*) INTO v_count
      FROM application a JOIN job j ON j.id = a.job_id
     WHERE a.created_at < j.published_at OR a.created_at > coalesce(j.closed_at, v_stichtag);
    IF v_count > 0 THEN
        RAISE EXCEPTION 'Seed: % Bewerbung(en) außerhalb des Veröffentlichungszeitraums', v_count;
    END IF;
END;
$$;

DROP VIEW seed_application_map;
DROP VIEW seed_application_token;
DROP TABLE seed_application;
DROP TABLE seed_job;
