-- 02b_nutzer.sql
-- Nutzerverwaltung (UC12): Es bleibt immer mindestens ein aktiver Admin.
--
-- Der Trigger greift, wenn ein aktiver Admin diesen Status verliert – durch Rollenwechsel zu
-- 'recruiter', Deaktivierung oder Löschen. Gibt es danach keinen anderen aktiven Admin mehr, wird die
-- Änderung abgelehnt (AT011); sonst könnte niemand mehr Nutzer verwalten oder das Löschprotokoll sehen.
--
-- Gleichzeitige Änderungen: Zwei Admins könnten sich zeitgleich gegenseitig entfernen – jede
-- Transaktion sähe den jeweils anderen noch als aktiv. pg_advisory_xact_lock reiht solche Änderungen
-- hintereinander (Sperre bis Transaktionsende); die Zählung danach sieht die bereits bestätigte
-- Änderung der anderen Transaktion.
--
-- Dass ein Admin sich nicht selbst deaktivieren oder herabstufen kann, prüft die API (nur sie kennt
-- die angemeldete Person).

CREATE FUNCTION internal_user_admin_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_others integer;
BEGIN
    -- Nur relevant, wenn ein bisher aktiver Admin diesen Status verliert.
    IF OLD.role = 'admin' AND OLD.is_active
       AND (TG_OP = 'DELETE' OR NEW.role <> 'admin' OR NOT NEW.is_active) THEN
        PERFORM pg_advisory_xact_lock(hashtext('ats-admin-guard'));
        SELECT count(*) INTO v_others
          FROM internal_user
         WHERE role = 'admin' AND is_active AND id <> OLD.id;
        IF v_others = 0 THEN
            RAISE EXCEPTION 'Der letzte aktive Admin kann nicht entfernt, deaktiviert oder herabgestuft werden'
                  USING ERRCODE = 'AT011';
        END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER internal_user_admin_guard
    BEFORE UPDATE OF role, is_active OR DELETE ON internal_user
    FOR EACH ROW EXECUTE FUNCTION internal_user_admin_guard();
