-- 02_regeln.sql
-- Geschäftsregeln auf Datenbankebene (Konzept P5, Regeln 2 und 3; dazu ab Iteration 3 der Stellenstatus):
--   * Statuswechsel nur entlang allowed_transition und nur durch den dort genannten Akteur,
--     Eintrag in status_history, bei Endstufe closed_at und delete_after = closed_at + 6 Monate
--     (retention_deadline() aus 01_schema.sql; CHECK application_retention_fixed hält das Paar fest).
--   * Neue Bewerbung nur auf veröffentlichte Stelle und nur in der Stufe 'received'; Spalten, die
--     erst im Verfahren entstehen (closed_at, delete_after, rating), sind beim Anlegen leer.
--   * Die Stelle einer Bewerbung (job_id) ist nach dem Anlegen nicht mehr änderbar.
--   * Stellenstatus nur draft -> published (setzt published_at) und published -> closed
--     (setzt closed_at); kein anderer Wechsel, kein Zurück.
--   * Neue Stelle nur als Entwurf, ohne published_at/closed_at (ab Iteration 4).
--   * Bewertung einer abgeschlossenen Bewerbung (Endstufe) ist eingefroren (ab Iteration 4).
-- Regel 1 (rating 1–5, Einwilligung Pflicht) steht als Constraint in 01_schema.sql.
--
-- Wer einen Statuswechsel auslöst, teilt der Aufrufer per transaktionslokaler Einstellung mit
-- (set_config(..., true) gilt nur bis zum Ende der Transaktion):
--   ats.actor   = 'internal' | 'applicant'   (Pflicht, sonst Abbruch)
--   ats.user_id = id aus internal_user        (Pflicht bei 'internal')
--   ats.comment = optionaler Kommentar für status_history
--
-- Eigene Fehlercodes (SQLSTATE), damit Aufrufer und Tests die Ursache eindeutig erkennen:
--   AT001 Übergang nicht erlaubt   AT002 Akteur fehlt/ungültig/nicht berechtigt
--   AT003 Stelle nicht veröffentlicht   AT004 neue Bewerbung nicht in Stufe 'received'
--   AT005 Spalte darf beim Anlegen nicht gesetzt sein (closed_at, delete_after, rating)
--   AT006 job_id einer Bewerbung geändert
--   AT007 Statuswechsel einer Stelle nicht erlaubt
--   AT008 neue Stelle nicht als Entwurf angelegt (oder mit published_at/closed_at)
--   AT010 Bewertung einer abgeschlossenen Bewerbung geändert
--   (AT009 Löschlauf, AT012 Löschprotokoll nur anhängen: siehe 02a_loeschlauf.sql;
--    AT011 letzter aktiver Admin: siehe 02b_nutzer.sql)

-- Liest eine ats.*-Einstellung; nicht gesetzt oder leer ergibt NULL.
-- (Nach Transaktionsende steht eine einmal gesetzte Einstellung auf '' statt NULL.)
CREATE FUNCTION ats_setting(p_name text) RETURNS text
LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting(p_name, true), '')
$$;

CREATE FUNCTION application_stage_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_required_actor text;
    v_actor          text := ats_setting('ats.actor');
    v_user_raw       text := ats_setting('ats.user_id');
    v_user_id        integer;
    v_is_terminal    boolean;
BEGIN
    -- Gleiche Stufe erneut gesetzt: kein Statuswechsel, nichts protokollieren.
    IF NEW.stage = OLD.stage THEN
        RETURN NEW;
    END IF;

    SELECT actor INTO v_required_actor
      FROM allowed_transition
     WHERE from_stage = OLD.stage AND to_stage = NEW.stage;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Statusübergang % -> % ist nicht erlaubt', OLD.stage, NEW.stage
              USING ERRCODE = 'AT001';
    END IF;

    IF v_actor IS NULL OR v_actor NOT IN ('internal', 'applicant') THEN
        RAISE EXCEPTION 'Akteur fehlt oder ist ungültig (ats.actor = %)', coalesce(v_actor, 'NULL')
              USING ERRCODE = 'AT002';
    END IF;
    IF v_actor <> v_required_actor THEN
        RAISE EXCEPTION 'Statusübergang % -> % ist für Akteur % nicht erlaubt',
              OLD.stage, NEW.stage, v_actor
              USING ERRCODE = 'AT002';
    END IF;

    IF v_actor = 'internal' THEN
        IF v_user_raw IS NULL OR v_user_raw !~ '^[1-9][0-9]{0,9}$' THEN
            RAISE EXCEPTION 'Interner Statuswechsel ohne gültige ats.user_id'
                  USING ERRCODE = 'AT002';
        END IF;
        v_user_id := v_user_raw::integer;
    END IF;

    INSERT INTO status_history (application_id, from_stage, to_stage, changed_by, comment)
    VALUES (OLD.id, OLD.stage, NEW.stage, v_user_id, ats_setting('ats.comment'));

    SELECT is_terminal INTO v_is_terminal FROM pipeline_stage WHERE code = NEW.stage;
    IF v_is_terminal THEN
        NEW.closed_at    := now();
        NEW.delete_after := retention_deadline(NEW.closed_at);
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER application_stage_change
    BEFORE UPDATE OF stage ON application
    FOR EACH ROW EXECUTE FUNCTION application_stage_change();

CREATE FUNCTION application_insert_check() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_job_status text;
BEGIN
    -- FOR SHARE sperrt die Stellenzeile, damit sie nicht parallel geschlossen werden kann.
    SELECT status INTO v_job_status FROM job WHERE id = NEW.job_id FOR SHARE;
    IF NOT FOUND THEN
        RETURN NEW;  -- nicht existierende Stelle meldet der Fremdschlüssel
    END IF;
    IF v_job_status <> 'published' THEN
        RAISE EXCEPTION 'Bewerbung nur auf veröffentlichte Stellen möglich (Stelle % ist %)',
              NEW.job_id, v_job_status
              USING ERRCODE = 'AT003';
    END IF;
    IF NEW.stage <> 'received' THEN
        RAISE EXCEPTION 'Neue Bewerbung muss in Stufe received beginnen (angegeben: %)', NEW.stage
              USING ERRCODE = 'AT004';
    END IF;
    -- Sonst könnte eine neue Bewerbung z. B. mit einer frühen Löschfrist oder einer Bewertung
    -- angelegt werden; diese Werte entstehen erst im Verfahren (Trigger oben bzw. Recruiter).
    IF NEW.closed_at IS NOT NULL THEN
        RAISE EXCEPTION 'Neue Bewerbung darf closed_at nicht setzen' USING ERRCODE = 'AT005';
    END IF;
    IF NEW.delete_after IS NOT NULL THEN
        RAISE EXCEPTION 'Neue Bewerbung darf delete_after nicht setzen' USING ERRCODE = 'AT005';
    END IF;
    IF NEW.rating IS NOT NULL THEN
        RAISE EXCEPTION 'Neue Bewerbung darf rating nicht setzen' USING ERRCODE = 'AT005';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER application_insert_check
    BEFORE INSERT ON application
    FOR EACH ROW EXECUTE FUNCTION application_insert_check();

-- Die Stelle einer Bewerbung bleibt fest (sonst ließe sich die Regel "nur veröffentlichte
-- Stellen" nachträglich umgehen). Die WHEN-Bedingung lässt SET job_id = job_id zu.
CREATE FUNCTION application_job_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Die Stelle einer Bewerbung ist nicht änderbar (% -> %)', OLD.job_id, NEW.job_id
          USING ERRCODE = 'AT006';
END;
$$;

CREATE TRIGGER application_job_immutable
    BEFORE UPDATE OF job_id ON application
    FOR EACH ROW
    WHEN (OLD.job_id IS DISTINCT FROM NEW.job_id)
    EXECUTE FUNCTION application_job_immutable();

-- Bewertung einfrieren (AT010): Nach der Endstufe (eingestellt, abgelehnt, zurückgezogen) bleibt die
-- Bewertung so, wie sie zur Entscheidung vorlag – nachträgliche Änderungen würden die Nachvollziehbarkeit
-- (AGG) untergraben. Erneutes Setzen desselben Werts ist keine Änderung.
CREATE FUNCTION application_rating_frozen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.rating IS DISTINCT FROM OLD.rating
       AND (SELECT is_terminal FROM pipeline_stage WHERE code = OLD.stage) THEN
        RAISE EXCEPTION 'Bewertung einer abgeschlossenen Bewerbung (%) ist nicht änderbar', OLD.stage
              USING ERRCODE = 'AT010';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER application_rating_frozen
    BEFORE UPDATE OF rating ON application
    FOR EACH ROW EXECUTE FUNCTION application_rating_frozen();

-- Lebenszyklus einer Stelle (UC6): Entwurf -> veröffentlicht -> geschlossen, kein Zurück.
-- Die Zeitpunkte setzt die Datenbank beim Wechsel selbst (now()); vom Aufrufer mitgegebene Werte
-- für published_at/closed_at werden dabei überschrieben. Neue Stellen beginnen immer als Entwurf
-- (job_insert_check unten); auch Seed und DB-Tests durchlaufen die Wechsel über diesen Trigger.
CREATE FUNCTION job_status_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status = OLD.status THEN
        RETURN NEW;
    END IF;
    IF OLD.status = 'draft' AND NEW.status = 'published' THEN
        NEW.published_at := now();
    ELSIF OLD.status = 'published' AND NEW.status = 'closed' THEN
        NEW.closed_at := now();
    ELSE
        RAISE EXCEPTION 'Statuswechsel der Stelle % -> % ist nicht erlaubt', OLD.status, NEW.status
              USING ERRCODE = 'AT007';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER job_status_change
    BEFORE UPDATE OF status ON job
    FOR EACH ROW EXECUTE FUNCTION job_status_change();

-- Neue Stelle nur als Entwurf (AT008): Sonst ließe sich der Lebenszyklus beim Anlegen überspringen,
-- z. B. eine Stelle direkt als 'published' mit beliebigem published_at. Die Zeitpunkte setzt erst
-- job_status_change beim Wechsel.
CREATE FUNCTION job_insert_check() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status <> 'draft' THEN
        RAISE EXCEPTION 'Neue Stelle muss als Entwurf angelegt werden (angegeben: %)', NEW.status
              USING ERRCODE = 'AT008';
    END IF;
    IF NEW.published_at IS NOT NULL OR NEW.closed_at IS NOT NULL THEN
        RAISE EXCEPTION 'Neue Stelle darf published_at und closed_at nicht setzen'
              USING ERRCODE = 'AT008';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER job_insert_check
    BEFORE INSERT ON job
    FOR EACH ROW EXECUTE FUNCTION job_insert_check();
