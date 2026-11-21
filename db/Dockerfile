# PostgreSQL 16 mit eingebackenen Init-Skripten (keine Bind-Mounts, siehe CLAUDE.md §4).
# Nach Änderungen an db/init/ ist "docker compose up -d --build" Pflicht.
FROM postgres:16-alpine
COPY init/ /docker-entrypoint-initdb.d/
# Wiederholbarer Aufruf der DB-Regeltests: docker compose exec -T db ats-db-tests
COPY ats-db-tests /usr/local/bin/ats-db-tests
RUN chmod 0755 /usr/local/bin/ats-db-tests
