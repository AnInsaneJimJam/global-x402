#!/usr/bin/env bash
set -euo pipefail

if [[ -n "${TEST_DATABASE_URL:-}" ]]; then
  exec node --import tsx --test tests/*.test.ts
fi

TASK_PG_BIN="${PG_BIN:-$(pg_config --bindir)}"
if [[ ! -x "$TASK_PG_BIN/initdb" || ! -x "$TASK_PG_BIN/pg_ctl" ]]; then
  echo 'PostgreSQL server binaries required. Install PostgreSQL or set TEST_DATABASE_URL.' >&2
  exit 1
fi
TASK_PG_ROOT=$(mktemp -d /tmp/gob-test-postgres.XXXXXX)
TASK_PG_STARTED=false
cleanup() {
  if [[ "$TASK_PG_STARTED" == true ]]; then
    "$TASK_PG_BIN/pg_ctl" -D "$TASK_PG_ROOT/data" -m fast stop >/dev/null
  fi
  rm -rf -- "$TASK_PG_ROOT"
}
trap cleanup EXIT
"$TASK_PG_BIN/initdb" -D "$TASK_PG_ROOT/data" --encoding=UTF8 --auth-local=trust --auth-host=reject -U gob_dev >"$TASK_PG_ROOT/init.log"
# Unique private Unix socket; no TCP listener and no shared development database.
"$TASK_PG_BIN/pg_ctl" -D "$TASK_PG_ROOT/data" -l "$TASK_PG_ROOT/server.log" -o "-h '' -k $TASK_PG_ROOT -p 55432" start >/dev/null
TASK_PG_STARTED=true
export TEST_DATABASE_URL="postgresql://gob_dev@localhost/postgres?host=$TASK_PG_ROOT&port=55432"
node --import tsx --test tests/*.test.ts
