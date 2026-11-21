-- fingerprint.sql
-- Fingerabdruck des Datenbestands: Zeilenzahl und MD5 über den vollständigen Inhalt jeder Tabelle.
-- Dient dem Nachweis, dass zwei Seed-Läufe identische Daten erzeugen:
--   docker compose exec -T db psql -U ats -d ats -At -f - < db/werkzeuge/fingerprint.sql
SELECT 'internal_user',      count(*), md5(coalesce(string_agg(t::text, E'\n' ORDER BY t::text), '')) FROM internal_user t
UNION ALL SELECT 'job',                count(*), md5(coalesce(string_agg(t::text, E'\n' ORDER BY t::text), '')) FROM job t
UNION ALL SELECT 'application',        count(*), md5(coalesce(string_agg(t::text, E'\n' ORDER BY t::text), '')) FROM application t
UNION ALL SELECT 'attachment',         count(*), md5(coalesce(string_agg(t::text, E'\n' ORDER BY t::text), '')) FROM attachment t
UNION ALL SELECT 'employment_type',    count(*), md5(coalesce(string_agg(t::text, E'\n' ORDER BY t::text), '')) FROM employment_type t
UNION ALL SELECT 'pipeline_stage',     count(*), md5(coalesce(string_agg(t::text, E'\n' ORDER BY t::text), '')) FROM pipeline_stage t
UNION ALL SELECT 'allowed_transition', count(*), md5(coalesce(string_agg(t::text, E'\n' ORDER BY t::text), '')) FROM allowed_transition t
UNION ALL SELECT 'status_history',     count(*), md5(coalesce(string_agg(t::text, E'\n' ORDER BY t::text), '')) FROM status_history t
UNION ALL SELECT 'note',               count(*), md5(coalesce(string_agg(t::text, E'\n' ORDER BY t::text), '')) FROM note t
UNION ALL SELECT 'deletion_log',       count(*), md5(coalesce(string_agg(t::text, E'\n' ORDER BY t::text), '')) FROM deletion_log t;
