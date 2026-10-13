#!/usr/bin/env bash
# Applies every migration + seed to a throwaway Postgres database and runs the
# RLS / workflow assertions in workflow_test.sql.
#   PGHOST=... PGUSER=... supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB=${TEST_DB:-northgate_test}
dropdb --if-exists "$DB" >/dev/null 2>&1 || true
createdb "$DB"
run() { psql -v ON_ERROR_STOP=1 -q -d "$DB" "$@"; }
run -f tests/auth_stub.sql
for f in migrations/*.sql; do run -f "$f"; done
run -o /dev/null -f seed.sql
run -o /dev/null -f tests/workflow_test.sql 2>&1 | sed "s/^psql:[^ ]* NOTICE:  //"
echo "all database tests passed"
