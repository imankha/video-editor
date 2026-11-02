#!/usr/bin/env bash
# Sourced: exports DATABASE_URL with localhost rewritten to host.docker.internal (T11500 extract).
# Needs cwd = repo root (reads .env). No-op if DATABASE_URL already set.
if [ -z "${DATABASE_URL:-}" ] && [ -f .env ]; then
  RAW="$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2-)"
  RAW="${RAW//$'\r'/}"   # .env is copied from the Windows host with CRLF endings;
                         # strip the trailing CR or the DB name becomes "..._dev\r".
  if [ -n "$RAW" ]; then
    export DATABASE_URL="${RAW/@localhost:/@host.docker.internal:}"
    export DATABASE_URL="${DATABASE_URL/@127.0.0.1:/@host.docker.internal:}"
    echo "[stack] DATABASE_URL -> host.docker.internal (was localhost)"
  fi
fi
