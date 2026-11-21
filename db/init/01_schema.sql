-- 01_schema.sql
-- Legt alle zehn Tabellen des Datenmodells an (Konzept P5 plus employment_type seit Iteration 5):
-- Primär- und Fremdschlüssel,
-- Löschverhalten (CASCADE/RESTRICT), CHECK-Constraints und die zwei Indizes aus P5.
-- Die Geschäftsregeln per Trigger (Statusübergänge, Historie, Löschfrist, Bewerbung nur auf
-- veröffentlichte Stellen) stehen in 02_regeln.sql, die Stammdaten der Pipeline in 03_stammdaten.sql.

-- Interne Nutzer (Recruiter, Admin). Nutzer werden deaktiviert, nicht gelöscht.
CREATE TABLE internal_user (
    id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email         text        NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
    password_hash text        NOT NULL,
    display_name  text        NOT NULL CHECK (length(display_name) BETWEEN 1 AND 100),
    role          text        NOT NULL CHECK (role IN ('recruiter', 'admin')),
    is_active     boolean     NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now()
);
-- E-Mail eindeutig ohne Rücksicht auf Groß-/Kleinschreibung (nur interne Nutzer).
CREATE UNIQUE INDEX internal_user_email_uq ON internal_user (lower(email));

-- Stufen der Bewerbungs-Pipeline (Stammdaten).
CREATE TABLE pipeline_stage (
    code        text    PRIMARY KEY,
    label       text    NOT NULL,
    sort_order  integer NOT NULL UNIQUE,
    is_terminal boolean NOT NULL
);

-- Erlaubte Statusübergänge; actor = wer den Übergang auslösen darf.
CREATE TABLE allowed_transition (
    from_stage text NOT NULL REFERENCES pipeline_stage (code),
    to_stage   text NOT NULL REFERENCES pipeline_stage (code),
    actor      text NOT NULL CHECK (actor IN ('internal', 'applicant')),
    PRIMARY KEY (from_stage, to_stage),
    CONSTRAINT allowed_transition_not_self CHECK (from_stage <> to_stage)
);

-- Beschäftigungsarten (Stammdaten, Iteration 5). Einzige Quelle der erlaubten Werte: API und
-- Oberfläche lesen die Liste von hier (GET /api/employment-types) statt eigener Kopien.
CREATE TABLE employment_type (
    code       text    PRIMARY KEY CHECK (code ~ '^[a-z_]{1,40}$'),
    label      text    NOT NULL CHECK (length(label) BETWEEN 1 AND 100),
    sort_order integer NOT NULL UNIQUE
);

-- Stellenanzeigen.
CREATE TABLE job (
    id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    title           text        NOT NULL CHECK (length(title) BETWEEN 3 AND 200),
    location        text        NOT NULL CHECK (length(location) BETWEEN 1 AND 100),
    employment_type text        NOT NULL REFERENCES employment_type (code),
    description     text        NOT NULL CHECK (length(description) BETWEEN 1 AND 20000),
    status          text        NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'published', 'closed')),
    published_at    timestamptz,
    closed_at       timestamptz,
    created_by      integer     NOT NULL REFERENCES internal_user (id) ON DELETE RESTRICT,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT job_published_has_date CHECK (status <> 'published' OR published_at IS NOT NULL),
    CONSTRAINT job_closed_has_date    CHECK (status <> 'closed' OR closed_at IS NOT NULL)
);

-- Löschfrist einer abgeschlossenen Bewerbung: Abschluss + 6 Monate (Konzept P3, Löschkonzept).
-- Einzige Stelle, an der die Frist berechnet wird (CHECK unten, Trigger in 02_regeln.sql, Seed).
-- Gerechnet wird in UTC: Monatsarithmetik mit timestamptz hinge sonst von der Zeitzone der
-- Verbindung ab (Sommer-/Winterzeit verschiebt das Ergebnis um eine Stunde).
CREATE FUNCTION retention_deadline(p_closed timestamptz) RETURNS timestamptz
LANGUAGE sql IMMUTABLE STRICT AS $$
    SELECT ((p_closed AT TIME ZONE 'UTC') + interval '6 months') AT TIME ZONE 'UTC'
$$;

-- Bewerbungen. Eine Person darf sich auf mehrere Stellen bewerben (E-Mail nicht eindeutig).
CREATE TABLE application (
    id                integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_id            integer     NOT NULL REFERENCES job (id) ON DELETE RESTRICT,
    first_name        text        NOT NULL CHECK (length(first_name) BETWEEN 1 AND 100),
    last_name         text        NOT NULL CHECK (length(last_name) BETWEEN 1 AND 100),
    email             text        NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
    phone             text        CHECK (length(phone) BETWEEN 3 AND 40),
    cover_letter      text        CHECK (length(cover_letter) <= 10000),
    -- Einwilligung ist Pflicht (Konzept P5 Regel 1: consent_given_at IS NOT NULL).
    consent_given_at  timestamptz NOT NULL,
    consent_version   text        NOT NULL CHECK (length(consent_version) BETWEEN 1 AND 50),
    stage             text        NOT NULL DEFAULT 'received' REFERENCES pipeline_stage (code),
    rating            smallint    CHECK (rating BETWEEN 1 AND 5),
    -- Token für den Status-Link, nur als Hash gespeichert. Das Format (SHA-256, 64 Hex-Zeichen)
    -- stellt sicher, dass nie ein Klartext-Token in dieser Spalte landen kann.
    access_token_hash text        NOT NULL UNIQUE
                      CONSTRAINT application_token_hash_format CHECK (access_token_hash ~ '^[0-9a-f]{64}$'),
    closed_at         timestamptz,
    delete_after      timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT application_closed_pair CHECK ((closed_at IS NULL) = (delete_after IS NULL)),
    -- Die Löschfrist ist fest an den Abschluss gebunden und lässt sich nicht allein vorziehen.
    CONSTRAINT application_retention_fixed CHECK (delete_after = retention_deadline(closed_at))
);
-- Index für den Löschlauf (nur abgeschlossene Bewerbungen haben delete_after).
CREATE INDEX application_delete_after_idx ON application (delete_after) WHERE delete_after IS NOT NULL;
-- Index für die Kanban-Ansicht je Stelle und Stufe.
CREATE INDEX application_job_stage_idx ON application (job_id, stage);

-- Lebenslauf-PDF; die Datei liegt unter storage_key im Upload-Volume.
CREATE TABLE attachment (
    id                integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    application_id    integer     NOT NULL REFERENCES application (id) ON DELETE CASCADE,
    original_filename text        NOT NULL CHECK (length(original_filename) BETWEEN 1 AND 255),
    storage_key       uuid        NOT NULL UNIQUE,
    mime_type         text        NOT NULL CHECK (mime_type = 'application/pdf'),
    size_bytes        integer     NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
    created_at        timestamptz NOT NULL DEFAULT now()
);

-- Verlauf der Statuswechsel; wird ausschließlich vom Trigger in 02_regeln.sql geschrieben.
-- changed_by NULL = Bewerber:in (Token-Link) bzw. System.
CREATE TABLE status_history (
    id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    application_id integer     NOT NULL REFERENCES application (id) ON DELETE CASCADE,
    from_stage     text        NOT NULL REFERENCES pipeline_stage (code),
    to_stage       text        NOT NULL REFERENCES pipeline_stage (code),
    changed_by     integer     REFERENCES internal_user (id) ON DELETE RESTRICT,
    changed_at     timestamptz NOT NULL DEFAULT now(),
    comment        text        CHECK (length(comment) <= 2000)
);

-- Interne Notizen zu einer Bewerbung.
CREATE TABLE note (
    id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    application_id integer     NOT NULL REFERENCES application (id) ON DELETE CASCADE,
    author_id      integer     NOT NULL REFERENCES internal_user (id) ON DELETE RESTRICT,
    body           text        NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
    created_at     timestamptz NOT NULL DEFAULT now()
);

-- Löschprotokoll ohne Personenbezug; job_id bewusst ohne Fremdschlüssel.
CREATE TABLE deletion_log (
    id                  integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_id              integer,
    stage_at_deletion   text        NOT NULL,
    closed_at           timestamptz,
    deleted_at          timestamptz NOT NULL DEFAULT now(),
    attachments_removed integer     NOT NULL DEFAULT 0 CHECK (attachments_removed >= 0)
);
