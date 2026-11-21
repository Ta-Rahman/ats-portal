-- 03_stammdaten.sql
-- Stammdaten: Beschäftigungsarten (Iteration 5) und die feste Pipeline (Konzept P5) mit sieben
-- Stufen und den erlaubten Übergängen.
-- Kein Zurück (z. B. interview -> screening); Endstufen haben keine ausgehenden Übergänge.

INSERT INTO employment_type (code, label, sort_order) VALUES
    ('full_time',       'Vollzeit',       1),
    ('part_time',       'Teilzeit',       2),
    ('working_student', 'Werkstudent:in', 3);

INSERT INTO pipeline_stage (code, label, sort_order, is_terminal) VALUES
    ('received',  'Eingegangen',   1, false),
    ('screening', 'Sichtung',      2, false),
    ('interview', 'Interview',     3, false),
    ('offer',     'Angebot',       4, false),
    ('hired',     'Eingestellt',   5, true),
    ('rejected',  'Abgelehnt',     6, true),
    ('withdrawn', 'Zurückgezogen', 7, true);

INSERT INTO allowed_transition (from_stage, to_stage, actor) VALUES
    -- Vorwärts und Absage: nur intern (Recruiter/Admin)
    ('received',  'screening', 'internal'),
    ('received',  'rejected',  'internal'),
    ('screening', 'interview', 'internal'),
    ('screening', 'rejected',  'internal'),
    ('interview', 'offer',     'internal'),
    ('interview', 'rejected',  'internal'),
    ('offer',     'hired',     'internal'),
    ('offer',     'rejected',  'internal'),
    -- Rückzug: nur Bewerber:in über den Token-Link, aus jeder nicht-terminalen Stufe
    ('received',  'withdrawn', 'applicant'),
    ('screening', 'withdrawn', 'applicant'),
    ('interview', 'withdrawn', 'applicant'),
    ('offer',     'withdrawn', 'applicant');
