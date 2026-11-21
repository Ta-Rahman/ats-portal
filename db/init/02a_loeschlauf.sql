-- 02a_loeschlauf.sql
-- Löschlauf auf Datenbankebene (Konzept P3 Löschkonzept, P5 Regel 4); am Ende der Schutz des
-- Löschprotokolls (nur anhängen, AT012).
--
-- delete_due_applications(p_cutoff) löscht in EINER Transaktion alle abgeschlossenen Bewerbungen,
-- deren Löschfrist vor dem Stichtag liegt: Bewerbung physisch, per Cascade Anhang-Zeilen, Notizen
-- und Status-Historie. Je Bewerbung entsteht genau eine Zeile im Löschprotokoll ohne Personenbezug.
-- Rückgabe: Anzahl gelöschter Bewerbungen und die storage_keys der Lebenslauf-Dateien. Die Dateien
-- entfernt der Aufrufer (API, api/src/services/deletion.service.js) erst nach dem COMMIT – so
-- bleibt bei einem Datenbankfehler keine Bewerbung ohne Datei zurück.
--
-- Fällig ist eine Bewerbung nur, wenn
--   * delete_after < p_cutoff (Frist abgelaufen; delete_after = retention_deadline(closed_at)) und
--   * ihre Stufe eine Endstufe ist – eine laufende Bewerbung wird nie gelöscht, auch wenn jemand
--     closed_at/delete_after von Hand gesetzt hat.
--
-- p_cutoff (Stichtag) ist im Betrieb now(). Ein früherer Stichtag ist erlaubt (Tests, nachvollziehbare
-- Läufe), ein späterer nicht: Vor Ablauf der Frist darf nichts gelöscht werden (AT009).
--
-- attachments_removed im Löschprotokoll = Anzahl der mitgelöschten Anhang-Zeilen, also der Dateien,
-- die zu entfernen sind. Ob eine Datei tatsächlich entfernt wurde oder schon fehlte, weiß die
-- Datenbank zu diesem Zeitpunkt nicht; das meldet die Zusammenfassung des Löschlaufs.
--
-- Eigener Fehlercode: AT009 Stichtag in der Zukunft (oder NULL).

CREATE FUNCTION delete_due_applications(p_cutoff timestamptz DEFAULT now())
RETURNS TABLE (deleted_count integer, storage_keys text[])
LANGUAGE plpgsql AS $$
DECLARE
    v_ids   integer[];
    v_keys  text[];
    v_count integer;
BEGIN
    IF p_cutoff IS NULL OR p_cutoff > now() THEN
        RAISE EXCEPTION 'Stichtag % liegt in der Zukunft – vor Ablauf der Frist wird nicht gelöscht',
              coalesce(p_cutoff::text, 'NULL')
              USING ERRCODE = 'AT009';
    END IF;

    -- 1. Fällige Bewerbungen bestimmen und sperren (FOR UPDATE): Ein gleichzeitiger zweiter Lauf
    --    wartet hier und findet die Zeilen danach nicht mehr.
    SELECT array_agg(d.id ORDER BY d.id) INTO v_ids
      FROM (SELECT a.id
              FROM application a
              JOIN pipeline_stage s ON s.code = a.stage
             WHERE a.delete_after < p_cutoff
               AND s.is_terminal
               FOR UPDATE OF a) d;

    -- 2. Dateinamen der Lebensläufe merken, bevor die Anhang-Zeilen per Cascade verschwinden.
    SELECT coalesce(array_agg(t.storage_key::text ORDER BY t.storage_key), '{}') INTO v_keys
      FROM attachment t
     WHERE t.application_id = ANY (v_ids);

    -- 3. Löschprotokoll: nur Stelle, Stufe, Zeitpunkte und Anzahl der Dateien – keine Personendaten.
    INSERT INTO deletion_log (job_id, stage_at_deletion, closed_at, deleted_at, attachments_removed)
    SELECT a.job_id, a.stage, a.closed_at, now(),
           (SELECT count(*) FROM attachment t WHERE t.application_id = a.id)
      FROM application a
     WHERE a.id = ANY (v_ids)
     ORDER BY a.id;

    -- 4. Physisch löschen; Cascade entfernt attachment, note und status_history.
    DELETE FROM application WHERE id = ANY (v_ids);
    GET DIAGNOSTICS v_count = ROW_COUNT;

    RETURN QUERY SELECT v_count, v_keys;
END;
$$;

-- Löschprotokoll nur anhängen (Iteration 5, AT012): Einträge dürfen weder geändert noch gelöscht
-- werden, damit der Nachweis der Löschläufe nachträglich nicht verändert werden kann. Ein Trigger je
-- Anweisung, damit auch TRUNCATE erfasst ist (und UPDATE/DELETE ohne betroffene Zeile).
-- Grenze: Schutz gegen Fehler der Anwendung, nicht gegen einen Superuser – der kann Trigger umgehen
-- (z. B. session_replication_role = replica). Die Anwendung verbindet sich als DB-Superuser; die
-- API-Tests räumen ihre eigenen Protokollzeilen genau so auf (api/test/helpers.js).
CREATE FUNCTION deletion_log_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Das Löschprotokoll kann nur ergänzt werden (% nicht erlaubt)', TG_OP
        USING ERRCODE = 'AT012';
END;
$$;

CREATE TRIGGER deletion_log_append_only
    BEFORE UPDATE OR DELETE OR TRUNCATE ON deletion_log
    FOR EACH STATEMENT EXECUTE FUNCTION deletion_log_append_only();
