-- 05_tests.sql
-- Tests der Geschäftsregeln auf Datenbankebene (je Regel mindestens ein Positiv- und ein Negativfall).
-- Läuft als letztes Init-Skript: Schlägt ein Fall fehl, bricht die Init-Kette ab und die Datenbank
-- wird nie "healthy". Jederzeit erneut ausführbar mit:  docker compose exec -T db ats-db-tests
--
-- Alles läuft in einer Transaktion, die mit ROLLBACK endet: Die Testdaten (eigene Fixtures, keine
-- Seed-Zeilen) hinterlassen keine Spuren. Negativfälle prüfen den erwarteten SQLSTATE, damit ein
-- Fall nicht aus dem falschen Grund "besteht" (AT001–AT011 siehe 02_regeln.sql ff.,
-- 23514 = CHECK verletzt, 23502 = NOT NULL verletzt).

\set QUIET on
\set ON_ERROR_STOP on
-- Abfrageergebnisse der Hilfsaufrufe verwerfen; die Auswertung erscheint als NOTICE (stderr).
\o /dev/null

BEGIN;

CREATE TEMP TABLE test_result (
    nr     integer GENERATED ALWAYS AS IDENTITY,
    name   text    NOT NULL,
    passed boolean NOT NULL,
    info   text
);

-- ---------------------------------------------------------------------------------------------
-- Hilfsfunktionen (nur in dieser Sitzung sichtbar)
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION pg_temp.check(p_name text, p_cond boolean, p_info text DEFAULT NULL) RETURNS void
LANGUAGE sql AS $$
    INSERT INTO test_result (name, passed, info) VALUES (p_name, coalesce(p_cond, false), p_info);
$$;

-- SHA-256 als Hex – Format von access_token_hash (CHECK application_token_hash_format).
CREATE FUNCTION pg_temp.h(p_text text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT encode(sha256(convert_to(p_text, 'UTF8')), 'hex');
$$;

-- Erwartet, dass die Anweisung ohne Fehler durchläuft.
CREATE FUNCTION pg_temp.expect_ok(p_name text, p_sql text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    EXECUTE p_sql;
    PERFORM pg_temp.check(p_name, true);
EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.check(p_name, false, 'unerwarteter Fehler ' || SQLSTATE || ': ' || SQLERRM);
END;
$$;

-- Erwartet, dass die Anweisung mit genau diesem SQLSTATE abgelehnt wird.
CREATE FUNCTION pg_temp.expect_error(p_name text, p_sql text, p_state text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    BEGIN
        EXECUTE p_sql;
    EXCEPTION WHEN OTHERS THEN
        PERFORM pg_temp.check(p_name, SQLSTATE = p_state,
                              'SQLSTATE ' || SQLSTATE || ' (erwartet ' || p_state || '): ' || SQLERRM);
        RETURN;
    END;
    PERFORM pg_temp.check(p_name, false, 'kein Fehler, erwartet SQLSTATE ' || p_state);
END;
$$;

-- Setzt den Akteur für den nächsten Statuswechsel (NULL = nicht gesetzt).
CREATE FUNCTION pg_temp.act(p_actor text, p_user_id integer DEFAULT NULL, p_comment text DEFAULT NULL)
RETURNS void LANGUAGE sql AS $$
    SELECT set_config('ats.actor', coalesce(p_actor, ''), true),
           set_config('ats.user_id', coalesce(p_user_id::text, ''), true),
           set_config('ats.comment', coalesce(p_comment, ''), true);
$$;

-- ---------------------------------------------------------------------------------------------
-- Fixtures: eigener Nutzer, je eine Stelle pro Status, Bewerbungen in benötigten Stufen
-- ---------------------------------------------------------------------------------------------
CREATE TEMP TABLE fx (key text PRIMARY KEY, id integer NOT NULL);

INSERT INTO internal_user (email, password_hash, display_name, role)
VALUES ('db-test-fixture@test.invalid', 'kein-login', 'DB-Test', 'recruiter')
RETURNING id AS fx_user_id \gset
INSERT INTO fx VALUES ('user', :fx_user_id);

-- Stellen entstehen als Entwurf (AT008) und wechseln über den Trigger job_status_change.
WITH j AS (
    INSERT INTO job (title, location, employment_type, description, created_by)
    VALUES ('TEST veröffentlicht', 'Testort', 'full_time', 'Test', :fx_user_id),
           ('TEST Entwurf',        'Testort', 'full_time', 'Test', :fx_user_id),
           ('TEST geschlossen',    'Testort', 'full_time', 'Test', :fx_user_id)
    RETURNING id, title
)
INSERT INTO fx
SELECT CASE title WHEN 'TEST veröffentlicht' THEN 'job_published'
                  WHEN 'TEST Entwurf'        THEN 'job_draft'
                  ELSE 'job_closed' END, id
  FROM j;
UPDATE job SET status = 'published'
 WHERE id IN (SELECT id FROM fx WHERE key IN ('job_published', 'job_closed'));
UPDATE job SET status = 'closed' WHERE id = (SELECT id FROM fx WHERE key = 'job_closed');

CREATE FUNCTION pg_temp.fx(p_key text) RETURNS integer LANGUAGE sql STABLE AS $$
    SELECT id FROM fx WHERE key = p_key;
$$;

-- Legt eine Bewerbung auf der veröffentlichten Teststelle an und bewegt sie intern entlang p_path.
CREATE FUNCTION pg_temp.new_app(p_key text, p_path text[] DEFAULT '{}') RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
    v_id    integer;
    v_stage text;
BEGIN
    INSERT INTO application (job_id, first_name, last_name, email, consent_given_at, consent_version,
                             access_token_hash)
    VALUES (pg_temp.fx('job_published'), 'Test', p_key, p_key || '@test.invalid', '2026-01-02',
            'test', pg_temp.h('test-token-' || p_key))
    RETURNING id INTO v_id;
    FOREACH v_stage IN ARRAY p_path LOOP
        PERFORM pg_temp.act(CASE WHEN v_stage = 'withdrawn' THEN 'applicant' ELSE 'internal' END,
                            pg_temp.fx('user'));
        UPDATE application SET stage = v_stage WHERE id = v_id;
    END LOOP;
    PERFORM pg_temp.act(NULL);
    INSERT INTO fx VALUES (p_key, v_id);
    RETURN v_id;
END;
$$;

SELECT pg_temp.new_app('a_received');
SELECT pg_temp.new_app('a_received2');
SELECT pg_temp.new_app('a_screening',  '{screening}');
SELECT pg_temp.new_app('a_screening2', '{screening}');
SELECT pg_temp.new_app('a_interview',  '{screening,interview}');
SELECT pg_temp.new_app('a_offer',      '{screening,interview,offer}');
SELECT pg_temp.new_app('a_hired',      '{screening,interview,offer,hired}');
SELECT pg_temp.new_app('a_withdrawn',  '{withdrawn}');

-- ---------------------------------------------------------------------------------------------
-- Regel 2a: Statuswechsel nur entlang allowed_transition
-- ---------------------------------------------------------------------------------------------
SELECT pg_temp.act('internal', pg_temp.fx('user'), 'Testkommentar');
SELECT pg_temp.expect_ok('Übergang received -> screening (intern) ist erlaubt',
    format('UPDATE application SET stage = %L WHERE id = %s', 'screening', pg_temp.fx('a_received')));

SELECT pg_temp.check('Erlaubter Übergang schreibt status_history (von, nach, Nutzer, Kommentar)',
    (SELECT count(*) = 1 FROM status_history
      WHERE application_id = pg_temp.fx('a_received')
        AND from_stage = 'received' AND to_stage = 'screening'
        AND changed_by = pg_temp.fx('user') AND comment = 'Testkommentar'));

SELECT pg_temp.act('internal', pg_temp.fx('user'));
SELECT pg_temp.expect_error('Übergang interview -> screening (zurück) wird abgelehnt',
    format('UPDATE application SET stage = %L WHERE id = %s', 'screening', pg_temp.fx('a_interview')),
    'AT001');

SELECT pg_temp.expect_error('Übergang received -> interview (Stufe überspringen) wird abgelehnt',
    format('UPDATE application SET stage = %L WHERE id = %s', 'interview', pg_temp.fx('a_received2')),
    'AT001');

SELECT pg_temp.check('Abgelehnte Übergänge schreiben keine status_history',
    (SELECT count(*) = 0 FROM status_history
      WHERE application_id = pg_temp.fx('a_received2')
         OR (application_id = pg_temp.fx('a_interview') AND to_stage = 'screening'
             AND from_stage = 'interview')));

SELECT pg_temp.act('internal', pg_temp.fx('user'));
SELECT pg_temp.expect_ok('Erneutes Setzen derselben Stufe (screening -> screening) ist kein Fehler',
    format('UPDATE application SET stage = %L WHERE id = %s', 'screening', pg_temp.fx('a_screening2')));
SELECT pg_temp.check('Gleiche Stufe erzeugt keinen Historieneintrag (weiter genau 1)',
    (SELECT count(*) FROM status_history WHERE application_id = pg_temp.fx('a_screening2')) = 1);

-- ---------------------------------------------------------------------------------------------
-- Regel 2b: Endstufe setzt closed_at und delete_after = closed_at + 6 Monate
-- ---------------------------------------------------------------------------------------------
SELECT pg_temp.act('internal', pg_temp.fx('user'));
SELECT pg_temp.expect_ok('Übergang offer -> hired (Endstufe) ist erlaubt',
    format('UPDATE application SET stage = %L WHERE id = %s', 'hired', pg_temp.fx('a_offer')));
SELECT pg_temp.check('Endstufe setzt closed_at und delete_after = closed_at + 6 Monate',
    (SELECT closed_at IS NOT NULL AND delete_after = closed_at + interval '6 months'
       FROM application WHERE id = pg_temp.fx('a_offer')));
-- Iteration 4: Frist fest an closed_at gebunden (CHECK application_retention_fixed)
SELECT pg_temp.expect_error('Löschfrist allein vorziehen wird abgelehnt',
    format($q$UPDATE application SET delete_after = closed_at + interval '1 day' WHERE id = %s$q$,
           pg_temp.fx('a_offer')),
    '23514');
SELECT pg_temp.expect_ok('closed_at mit passender Frist (retention_deadline) setzen ist erlaubt',
    format($q$UPDATE application SET closed_at = '2025-01-01', delete_after = retention_deadline('2025-01-01')
              WHERE id = %s$q$, pg_temp.fx('a_hired')));
-- Verbindung in Europe/Berlin: Winter (+1) + 6 Monate = Sommer (+2); in UTC gerechnet bleibt es 12:00 UTC.
SET LOCAL TimeZone = 'Europe/Berlin';
SELECT pg_temp.check('retention_deadline rechnet unabhängig von der Zeitzone der Verbindung in UTC',
    retention_deadline('2026-01-15 12:00:00+00') = '2026-07-15 12:00:00+00'
    AND '2026-01-15 12:00:00+00'::timestamptz + interval '6 months' <> '2026-07-15 12:00:00+00');
SET LOCAL TimeZone = 'UTC';
SELECT pg_temp.check('Nicht-terminaler Übergang lässt closed_at und delete_after leer',
    (SELECT closed_at IS NULL AND delete_after IS NULL
       FROM application WHERE id = pg_temp.fx('a_received')));

-- ---------------------------------------------------------------------------------------------
-- Akteur: Rückzug nur durch Bewerber:in, alles andere nur intern
-- ---------------------------------------------------------------------------------------------
SELECT pg_temp.act('applicant');
SELECT pg_temp.expect_ok('Rückzug screening -> withdrawn durch Bewerber:in ist erlaubt',
    format('UPDATE application SET stage = %L WHERE id = %s', 'withdrawn', pg_temp.fx('a_screening')));
SELECT pg_temp.check('Rückzug: Historie ohne Nutzer (changed_by NULL), closed_at gesetzt',
    (SELECT h.changed_by IS NULL AND a.closed_at IS NOT NULL
       FROM application a JOIN status_history h ON h.application_id = a.id AND h.to_stage = 'withdrawn'
      WHERE a.id = pg_temp.fx('a_screening')));

SELECT pg_temp.act('applicant');
SELECT pg_temp.expect_error('Bewerber:in darf nicht received -> screening setzen',
    format('UPDATE application SET stage = %L WHERE id = %s', 'screening', pg_temp.fx('a_received2')),
    'AT002');

SELECT pg_temp.act('internal', pg_temp.fx('user'));
SELECT pg_temp.expect_error('Interner Akteur darf nicht zurückziehen (received -> withdrawn)',
    format('UPDATE application SET stage = %L WHERE id = %s', 'withdrawn', pg_temp.fx('a_received2')),
    'AT002');

SELECT pg_temp.act(NULL);
SELECT pg_temp.expect_error('Statuswechsel ohne Akteur wird abgelehnt',
    format('UPDATE application SET stage = %L WHERE id = %s', 'screening', pg_temp.fx('a_received2')),
    'AT002');

SELECT pg_temp.act('internal', NULL);
SELECT pg_temp.expect_error('Interner Statuswechsel ohne Nutzer-ID wird abgelehnt',
    format('UPDATE application SET stage = %L WHERE id = %s', 'screening', pg_temp.fx('a_received2')),
    'AT002');

-- ---------------------------------------------------------------------------------------------
-- Endstufen haben keine ausgehenden Übergänge
-- ---------------------------------------------------------------------------------------------
SELECT pg_temp.act('internal', pg_temp.fx('user'));
SELECT pg_temp.expect_error('Kein Übergang aus Endstufe hired (-> rejected)',
    format('UPDATE application SET stage = %L WHERE id = %s', 'rejected', pg_temp.fx('a_hired')),
    'AT001');
SELECT pg_temp.expect_error('Kein Übergang aus Endstufe withdrawn (-> screening)',
    format('UPDATE application SET stage = %L WHERE id = %s', 'screening', pg_temp.fx('a_withdrawn')),
    'AT001');

-- ---------------------------------------------------------------------------------------------
-- Regel 3: Bewerbung nur auf veröffentlichte Stelle, Beginn in 'received'
-- ---------------------------------------------------------------------------------------------
SELECT pg_temp.expect_ok('Bewerbung auf veröffentlichte Stelle ist erlaubt',
    format($q$INSERT INTO application (job_id, first_name, last_name, email, consent_given_at,
              consent_version, access_token_hash)
              VALUES (%s, 'T', 'Pos', 'pos@test.invalid', '2026-01-02', 'test', pg_temp.h('test-token-ins-pos'))$q$,
           pg_temp.fx('job_published')));
SELECT pg_temp.expect_error('Bewerbung auf Entwurf wird abgelehnt',
    format($q$INSERT INTO application (job_id, first_name, last_name, email, consent_given_at,
              consent_version, access_token_hash)
              VALUES (%s, 'T', 'Draft', 'd@test.invalid', '2026-01-02', 'test', pg_temp.h('test-token-ins-draft'))$q$,
           pg_temp.fx('job_draft')),
    'AT003');
SELECT pg_temp.expect_error('Bewerbung auf geschlossene Stelle wird abgelehnt',
    format($q$INSERT INTO application (job_id, first_name, last_name, email, consent_given_at,
              consent_version, access_token_hash)
              VALUES (%s, 'T', 'Closed', 'c@test.invalid', '2026-01-02', 'test', pg_temp.h('test-token-ins-closed'))$q$,
           pg_temp.fx('job_closed')),
    'AT003');
SELECT pg_temp.expect_error('Neue Bewerbung direkt in Stufe hired wird abgelehnt',
    format($q$INSERT INTO application (job_id, first_name, last_name, email, consent_given_at,
              consent_version, access_token_hash, stage)
              VALUES (%s, 'T', 'Hired', 'h@test.invalid', '2026-01-02', 'test', pg_temp.h('test-token-ins-hired'), 'hired')$q$,
           pg_temp.fx('job_published')),
    'AT004');

-- ---------------------------------------------------------------------------------------------
-- Härtung Auftrag 2: Spalten, die eine neue Bewerbung nicht setzen darf (AT005),
-- job_id unveränderlich (AT006), access_token_hash nur als SHA-256-Hex (CHECK)
-- ---------------------------------------------------------------------------------------------
SELECT pg_temp.check('Neue Bewerbung beginnt mit closed_at, delete_after und rating leer',
    (SELECT closed_at IS NULL AND delete_after IS NULL AND rating IS NULL
       FROM application WHERE access_token_hash = pg_temp.h('test-token-ins-pos')));
SELECT pg_temp.expect_error('Neue Bewerbung mit closed_at und delete_after wird abgelehnt',
    format($q$INSERT INTO application (job_id, first_name, last_name, email, consent_given_at,
              consent_version, access_token_hash, closed_at, delete_after)
              VALUES (%s, 'T', 'Early', 'e@test.invalid', '2026-01-02', 'test', pg_temp.h('test-token-ins-early'),
                      '2026-01-02', '2026-01-03')$q$,
           pg_temp.fx('job_published')),
    'AT005');
SELECT pg_temp.expect_error('Neue Bewerbung mit Bewertung wird abgelehnt',
    format($q$INSERT INTO application (job_id, first_name, last_name, email, consent_given_at,
              consent_version, access_token_hash, rating)
              VALUES (%s, 'T', 'Rated', 'r@test.invalid', '2026-01-02', 'test', pg_temp.h('test-token-ins-rated'), 3)$q$,
           pg_temp.fx('job_published')),
    'AT005');
SELECT pg_temp.expect_ok('job_id unverändert setzen (SET job_id = job_id) ist kein Fehler',
    format('UPDATE application SET job_id = job_id WHERE id = %s', pg_temp.fx('a_received2')));
SELECT pg_temp.expect_error('job_id einer Bewerbung ändern wird abgelehnt',
    format('UPDATE application SET job_id = %s WHERE id = %s', pg_temp.fx('job_closed'), pg_temp.fx('a_received2')),
    'AT006');
SELECT pg_temp.expect_error('Klartext statt SHA-256-Hash als access_token_hash wird abgelehnt',
    format($q$INSERT INTO application (job_id, first_name, last_name, email, consent_given_at,
              consent_version, access_token_hash)
              VALUES (%s, 'T', 'Plain', 'p@test.invalid', '2026-01-02', 'test', 'klartext-token')$q$,
           pg_temp.fx('job_published')),
    '23514');

-- ---------------------------------------------------------------------------------------------
-- Regel 1: Bewertung 1–5, Einwilligung Pflicht
-- ---------------------------------------------------------------------------------------------
SELECT pg_temp.expect_ok('Bewertung 5 ist erlaubt',
    format('UPDATE application SET rating = 5 WHERE id = %s', pg_temp.fx('a_received2')));
SELECT pg_temp.expect_error('Bewertung 0 wird abgelehnt',
    format('UPDATE application SET rating = 0 WHERE id = %s', pg_temp.fx('a_received2')), '23514');
SELECT pg_temp.expect_error('Bewertung 6 wird abgelehnt',
    format('UPDATE application SET rating = 6 WHERE id = %s', pg_temp.fx('a_received2')), '23514');
-- Iteration 4: Bewertung nach Endstufe eingefroren (AT010)
SELECT pg_temp.expect_error('Bewertung einer abgeschlossenen Bewerbung (hired) ändern wird abgelehnt',
    format('UPDATE application SET rating = 2 WHERE id = %s', pg_temp.fx('a_hired')), 'AT010');
SELECT pg_temp.expect_error('Bewertung einer zurückgezogenen Bewerbung erstmals setzen wird abgelehnt',
    format('UPDATE application SET rating = 4 WHERE id = %s', pg_temp.fx('a_withdrawn')), 'AT010');
SELECT pg_temp.expect_ok('Bewertung einer laufenden Bewerbung (interview) ändern ist erlaubt',
    format('UPDATE application SET rating = 3 WHERE id = %s', pg_temp.fx('a_interview')));
SELECT pg_temp.expect_ok('Gleiche Bewertung bei abgeschlossener Bewerbung erneut setzen ist keine Änderung',
    format('UPDATE application SET rating = rating WHERE id = %s', pg_temp.fx('a_hired')));
SELECT pg_temp.expect_error('Bewerbung ohne Einwilligung wird abgelehnt',
    format($q$INSERT INTO application (job_id, first_name, last_name, email, consent_given_at,
              consent_version, access_token_hash)
              VALUES (%s, 'T', 'NoConsent', 'n@test.invalid', NULL, 'test', pg_temp.h('test-token-ins-noconsent'))$q$,
           pg_temp.fx('job_published')),
    '23502');

-- ---------------------------------------------------------------------------------------------
-- Iteration 3: Stellenstatus nur draft -> published -> closed (AT007), Zeitpunkte setzt der Trigger
-- ---------------------------------------------------------------------------------------------
INSERT INTO job (title, location, employment_type, description, status, created_by)
VALUES ('TEST Lebenszyklus', 'Testort', 'full_time', 'Test', 'draft', pg_temp.fx('user'))
RETURNING id AS fx_job_cycle \gset
INSERT INTO fx VALUES ('job_cycle', :fx_job_cycle);

SELECT pg_temp.expect_error('Stelle draft -> closed (Veröffentlichen überspringen) wird abgelehnt',
    format($q$UPDATE job SET status = 'closed', closed_at = now() WHERE id = %s$q$, pg_temp.fx('job_cycle')),
    'AT007');
SELECT pg_temp.expect_ok('Stelle draft -> published ist erlaubt',
    format($q$UPDATE job SET status = 'published', published_at = '2000-01-01' WHERE id = %s$q$,
           pg_temp.fx('job_cycle')));
SELECT pg_temp.check('Veröffentlichen setzt published_at auf den Wechselzeitpunkt (nicht den mitgegebenen Wert)',
    (SELECT published_at = now() AND closed_at IS NULL FROM job WHERE id = pg_temp.fx('job_cycle')));
SELECT pg_temp.expect_error('Stelle published -> draft (zurück) wird abgelehnt',
    format($q$UPDATE job SET status = 'draft' WHERE id = %s$q$, pg_temp.fx('job_cycle')),
    'AT007');
SELECT pg_temp.expect_ok('Stelle published -> closed ist erlaubt',
    format($q$UPDATE job SET status = 'closed' WHERE id = %s$q$, pg_temp.fx('job_cycle')));
SELECT pg_temp.check('Schließen setzt closed_at auf den Wechselzeitpunkt',
    (SELECT closed_at = now() FROM job WHERE id = pg_temp.fx('job_cycle')));
SELECT pg_temp.expect_error('Stelle closed -> published (wieder öffnen) wird abgelehnt',
    format($q$UPDATE job SET status = 'published' WHERE id = %s$q$, pg_temp.fx('job_closed')),
    'AT007');
SELECT pg_temp.expect_error('Stelle closed -> draft wird abgelehnt',
    format($q$UPDATE job SET status = 'draft' WHERE id = %s$q$, pg_temp.fx('job_closed')),
    'AT007');

-- ---------------------------------------------------------------------------------------------
-- Iteration 4: Neue Stelle nur als Entwurf, ohne Zeitpunkte (AT008)
-- ---------------------------------------------------------------------------------------------
SELECT pg_temp.expect_ok('Neue Stelle als Entwurf ist erlaubt',
    format($q$INSERT INTO job (title, location, employment_type, description, created_by)
              VALUES ('TEST Neu Entwurf', 'Testort', 'full_time', 'Test', %s)$q$, pg_temp.fx('user')));
SELECT pg_temp.check('Neue Stelle beginnt als Entwurf ohne published_at und closed_at',
    (SELECT status = 'draft' AND published_at IS NULL AND closed_at IS NULL
       FROM job WHERE title = 'TEST Neu Entwurf'));
SELECT pg_temp.expect_error('Neue Stelle direkt als veröffentlicht wird abgelehnt',
    format($q$INSERT INTO job (title, location, employment_type, description, status, published_at, created_by)
              VALUES ('TEST Neu publ', 'Testort', 'full_time', 'Test', 'published', '2026-01-01', %s)$q$,
           pg_temp.fx('user')),
    'AT008');
SELECT pg_temp.expect_error('Neue Stelle direkt als geschlossen wird abgelehnt',
    format($q$INSERT INTO job (title, location, employment_type, description, status, published_at, closed_at, created_by)
              VALUES ('TEST Neu closed', 'Testort', 'full_time', 'Test', 'closed', '2026-01-01', '2026-02-01', %s)$q$,
           pg_temp.fx('user')),
    'AT008');
SELECT pg_temp.expect_error('Neuer Entwurf mit published_at wird abgelehnt',
    format($q$INSERT INTO job (title, location, employment_type, description, published_at, created_by)
              VALUES ('TEST Neu datiert', 'Testort', 'full_time', 'Test', '2026-01-01', %s)$q$,
           pg_temp.fx('user')),
    'AT008');

-- ---------------------------------------------------------------------------------------------
-- Iteration 4: Löschlauf delete_due_applications (P5 Regel 4, AT009)
-- Eigene Fixtures mit Abschluss 1999 und Stichtag 2000-01-01 – Seed-Bewerbungen (Fristen ab 2026)
-- werden davon nicht erfasst. Danach ein Lauf mit Stichtag now(), dessen Ergebnis gegen eine
-- vorher in derselben Transaktion gezählte Zahl fälliger Bewerbungen geprüft wird (keine feste Zahl).
-- ---------------------------------------------------------------------------------------------
SELECT pg_temp.new_app('d_due',    '{rejected}');
SELECT pg_temp.new_app('d_notdue', '{rejected}');
SELECT pg_temp.new_app('d_open',   '{screening}');
UPDATE application SET closed_at = '1999-01-01', delete_after = retention_deadline('1999-01-01')
 WHERE id IN (pg_temp.fx('d_due'), pg_temp.fx('d_open'));
INSERT INTO note (application_id, author_id, body) VALUES (pg_temp.fx('d_due'), pg_temp.fx('user'), 'Testnotiz');
INSERT INTO attachment (application_id, original_filename, storage_key, mime_type, size_bytes)
VALUES (pg_temp.fx('d_due'), 'test.pdf', '00000000-0000-4000-8000-000000000001', 'application/pdf', 100);

CREATE TEMP TABLE log_before AS SELECT coalesce(max(id), 0) AS max_id FROM deletion_log;
CREATE TEMP TABLE del_run1 AS SELECT * FROM delete_due_applications('2000-01-01');

SELECT pg_temp.check('Löschlauf (Stichtag 2000-01-01) meldet 1 Bewerbung und genau deren Dateinamen',
    (SELECT deleted_count = 1 AND storage_keys = '{00000000-0000-4000-8000-000000000001}' FROM del_run1));
SELECT pg_temp.check('Fällige Bewerbung ist gelöscht, mit Anhang, Notiz und Historie (Cascade)',
    NOT EXISTS (SELECT 1 FROM application WHERE id = pg_temp.fx('d_due'))
    AND NOT EXISTS (SELECT 1 FROM attachment WHERE application_id = pg_temp.fx('d_due'))
    AND NOT EXISTS (SELECT 1 FROM note WHERE application_id = pg_temp.fx('d_due'))
    AND NOT EXISTS (SELECT 1 FROM status_history WHERE application_id = pg_temp.fx('d_due')));
SELECT pg_temp.check('Nicht fällige abgeschlossene Bewerbung bleibt erhalten',
    EXISTS (SELECT 1 FROM application WHERE id = pg_temp.fx('d_notdue')));
SELECT pg_temp.check('Laufende Bewerbung mit (von Hand gesetzter) abgelaufener Frist bleibt erhalten',
    EXISTS (SELECT 1 FROM application WHERE id = pg_temp.fx('d_open')));
SELECT pg_temp.check('Genau eine Protokollzeile: Stelle, Stufe, Abschluss, Löschzeitpunkt, 1 Datei',
    (SELECT count(*) = 1
            AND bool_and(job_id = pg_temp.fx('job_published') AND stage_at_deletion = 'rejected'
                         AND closed_at = '1999-01-01' AND deleted_at = now() AND attachments_removed = 1)
       FROM deletion_log WHERE id > (SELECT max_id FROM log_before)));
SELECT pg_temp.check('Löschprotokoll hat genau die 6 Spalten ohne Personenbezug',
    (SELECT array_agg(column_name::text ORDER BY column_name::text)
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'deletion_log')
    = '{attachments_removed,closed_at,deleted_at,id,job_id,stage_at_deletion}');

CREATE TEMP TABLE del_run2 AS SELECT * FROM delete_due_applications('2000-01-01');
SELECT pg_temp.check('Zweiter Lauf mit demselben Stichtag löscht 0 und schreibt kein Protokoll',
    (SELECT deleted_count = 0 AND storage_keys = '{}' FROM del_run2)
    AND (SELECT count(*) = 1 FROM deletion_log WHERE id > (SELECT max_id FROM log_before)));
SELECT pg_temp.expect_error('Stichtag in der Zukunft wird abgelehnt',
    $q$SELECT delete_due_applications(now() + interval '1 second')$q$, 'AT009');

-- Stichtag now(): erfasst auch die fälligen Seed-Bewerbungen (wird wie alles hier zurückgerollt).
CREATE TEMP TABLE due_now AS
SELECT count(*)::int AS n
  FROM application a JOIN pipeline_stage s ON s.code = a.stage
 WHERE s.is_terminal AND a.delete_after < now();
CREATE TEMP TABLE del_now AS SELECT * FROM delete_due_applications();
SELECT pg_temp.check('Lauf mit Stichtag now() löscht genau die vorher gezählten fälligen Bewerbungen',
    (SELECT deleted_count FROM del_now) = (SELECT n FROM due_now) AND (SELECT n FROM due_now) >= 1,
    format('gezählt %s, gelöscht %s', (SELECT n FROM due_now), (SELECT deleted_count FROM del_now)));
SELECT pg_temp.check('Danach ist keine Bewerbung mehr fällig; laufende Bewerbung weiterhin vorhanden',
    NOT EXISTS (SELECT 1 FROM application a JOIN pipeline_stage s ON s.code = a.stage
                 WHERE s.is_terminal AND a.delete_after < now())
    AND EXISTS (SELECT 1 FROM application WHERE id = pg_temp.fx('d_open')));

-- ---------------------------------------------------------------------------------------------
-- Iteration 4: Letzter aktiver Admin bleibt erhalten (AT011)
-- Zwei eigene Admins; alle übrigen Admins (Seed) werden in dieser Transaktion deaktiviert.
-- ---------------------------------------------------------------------------------------------
INSERT INTO internal_user (email, password_hash, display_name, role)
VALUES ('db-test-admin1@test.invalid', 'kein-login', 'DB-Test Admin 1', 'admin'),
       ('db-test-admin2@test.invalid', 'kein-login', 'DB-Test Admin 2', 'admin');
INSERT INTO fx SELECT 'admin' || right(split_part(email, '@', 1), 1), id
  FROM internal_user WHERE email LIKE 'db-test-admin_@test.invalid';

SELECT pg_temp.expect_ok('Andere Admins deaktivieren, solange zwei Test-Admins aktiv sind, ist erlaubt',
    $q$UPDATE internal_user SET is_active = false
        WHERE role = 'admin' AND email NOT LIKE 'db-test-admin_@test.invalid'$q$);
SELECT pg_temp.expect_ok('Admin herabstufen, solange ein weiterer aktiver Admin existiert, ist erlaubt',
    format($q$UPDATE internal_user SET role = 'recruiter' WHERE id = %s$q$, pg_temp.fx('admin2')));
SELECT pg_temp.expect_error('Letzten aktiven Admin herabstufen wird abgelehnt',
    format($q$UPDATE internal_user SET role = 'recruiter' WHERE id = %s$q$, pg_temp.fx('admin1')), 'AT011');
SELECT pg_temp.expect_error('Letzten aktiven Admin deaktivieren wird abgelehnt',
    format('UPDATE internal_user SET is_active = false WHERE id = %s', pg_temp.fx('admin1')), 'AT011');
SELECT pg_temp.expect_error('Letzten aktiven Admin löschen wird abgelehnt',
    format('DELETE FROM internal_user WHERE id = %s', pg_temp.fx('admin1')), 'AT011');
SELECT pg_temp.expect_ok('Recruiter deaktivieren betrifft die Regel nicht',
    format('UPDATE internal_user SET is_active = false WHERE id = %s', pg_temp.fx('admin2')));
SELECT pg_temp.expect_ok('Letzten Admin umbenennen (ohne Rolle/Status) ist erlaubt',
    format($q$UPDATE internal_user SET display_name = 'Umbenannt' WHERE id = %s$q$, pg_temp.fx('admin1')));
SELECT pg_temp.check('Danach genau ein aktiver Admin',
    (SELECT count(*) = 1 FROM internal_user WHERE role = 'admin' AND is_active));

-- ---------------------------------------------------------------------------------------------
-- Beschäftigungsart nur aus der Stammdatentabelle employment_type (Iteration 5)
-- ---------------------------------------------------------------------------------------------
SELECT pg_temp.expect_ok('Stelle mit bekannter Beschäftigungsart ist erlaubt',
    format($q$INSERT INTO job (title, location, employment_type, description, created_by)
              VALUES ('TEST Art bekannt', 'Testort', 'working_student', 'Test', %s)$q$, pg_temp.fx('user')));
SELECT pg_temp.expect_error('Stelle mit unbekannter Beschäftigungsart wird abgelehnt (Fremdschlüssel)',
    format($q$INSERT INTO job (title, location, employment_type, description, created_by)
              VALUES ('TEST Art unbekannt', 'Testort', 'freelance', 'Test', %s)$q$, pg_temp.fx('user')),
    '23503');

-- ---------------------------------------------------------------------------------------------
-- Löschprotokoll nur anhängen (Iteration 5, AT012)
-- ---------------------------------------------------------------------------------------------
SELECT pg_temp.expect_ok('Löschprotokoll: neue Zeile anhängen ist erlaubt',
    $q$INSERT INTO deletion_log (job_id, stage_at_deletion, closed_at, deleted_at, attachments_removed)
       VALUES (NULL, 'rejected', '2000-01-01 00:00+00', '2000-07-02 00:00+00', 0)$q$);
SELECT pg_temp.expect_error('Löschprotokoll: Zeile ändern wird abgelehnt',
    $q$UPDATE deletion_log SET attachments_removed = 1 WHERE deleted_at = '2000-07-02 00:00+00'$q$, 'AT012');
SELECT pg_temp.expect_error('Löschprotokoll: Zeile löschen wird abgelehnt',
    $q$DELETE FROM deletion_log WHERE deleted_at = '2000-07-02 00:00+00'$q$, 'AT012');
SELECT pg_temp.expect_error('Löschprotokoll: TRUNCATE wird abgelehnt',
    'TRUNCATE deletion_log', 'AT012');

-- ---------------------------------------------------------------------------------------------
-- Auswertung
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE
    r        record;
    v_total  integer;
    v_passed integer;
BEGIN
    FOR r IN SELECT * FROM test_result ORDER BY nr LOOP
        IF r.passed THEN
            RAISE NOTICE '[OK]     %. %', lpad(r.nr::text, 2, '0'), r.name;
        ELSE
            RAISE NOTICE '[FEHLER] %. % – %', lpad(r.nr::text, 2, '0'), r.name, r.info;
        END IF;
    END LOOP;
    SELECT count(*), count(*) FILTER (WHERE passed) INTO v_total, v_passed FROM test_result;
    IF v_passed < v_total THEN
        RAISE EXCEPTION 'DB-Tests: % von % fehlgeschlagen', v_total - v_passed, v_total;
    END IF;
    RAISE NOTICE 'DB-Tests: %/% bestanden', v_passed, v_total;
END;
$$;

ROLLBACK;
