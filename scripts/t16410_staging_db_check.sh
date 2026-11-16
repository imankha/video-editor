#!/usr/bin/env bash
# T16410 acceptance checks for the staging accounts database move (ord -> lax).
# Needs flyctl with FLY_API_TOKEN, psql and curl. Staging only: never point this at prod apps.
#
#   c1  both staging apps run in lax, the API's DATABASE_URL user exists on the new DB, the old
#       ord database app is gone, every schema_migrations row of the frozen old DB is on the new DB,
#       and every old table exists on the new DB. The frozen old DB is
#       scripts/t16410_staging_frozen.txt: T16460 destroyed the old app on 2026-11-16 after a final
#       dump to R2. Row counts are not compared any more: they matched at the switch (2026-11-14),
#       and since then staging both adds and removes rows (expired sessions, storage refs), so
#       "at least the old count" is no longer a property of a correct move.
#   c2  a signed-in GET /api/auth/me logs [REQ_TIMING] auth_ms < 20
#   c3  sign-in, a public shared link and the admin dashboard answer 200
set -euo pipefail

API_APP=reel-ballers-api-staging
NEW_DB=${T16410_NEW_DB:-reel-ballers-db-staging-lax}
OLD_DB=reel-ballers-db-staging  # destroyed by T16460; only its absence is checked
FROZEN=${T16410_FROZEN:-scripts/t16410_staging_frozen.txt}
DB_NAME=reel_ballers_api_staging
NEW_DB_NAME=${T16410_NEW_DB_NAME:-$DB_NAME}  # red run: an empty database stands in for a failed restore
API=https://api-staging.reelballers.com
ADMIN_EMAIL=${T16410_ADMIN_EMAIL:-imankh@gmail.com}
CHECK_EMAIL=${E2E_CHECK_EMAIL:-e2e-gate@test.local}
WORK=$(mktemp -d)
PROXY_PID=

cleanup() { [ -n "$PROXY_PID" ] && kill "$PROXY_PID" 2>/dev/null; rm -rf "$WORK"; }
trap cleanup EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

machine_regions() {  # app -> one region per machine
  fly machine list -a "$1" --json | python3 -c 'import json,sys; print("\n".join(m["region"] for m in json.load(sys.stdin)))'
}

operator_password() {  # app -> the postgres user's password (postgres-flex OPERATOR_PASSWORD)
  fly ssh console -a "$1" -C printenv 2>/dev/null | tr -d '\r' | sed -n 's/^OPERATOR_PASSWORD=//p'
}

db_query() {  # app port sql [dbname] -> rows
  local app=$1 port=$2 sql=$3 dbname=${4:-$DB_NAME}
  fly proxy "$port:5432" -a "$app" >"$WORK/proxy-$port.log" 2>&1 &
  PROXY_PID=$!
  for _ in $(seq 30); do (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null && break; sleep 1; done
  PGPASSWORD=$(operator_password "$app") psql "host=127.0.0.1 port=$port user=postgres dbname=$dbname" -Atc "$sql"
  kill "$PROXY_PID"; PROXY_PID=
}

login() {  # email cookiejar
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 60 -c "$2" -X POST \
    -H 'Content-Type: application/json' -H 'X-Test-Mode: true' \
    -d "{\"email\":\"$1\"}" "$API/api/auth/dev-login")
  [ "$code" = 200 ] || fail "dev-login $1 returned $code"
}

get() {  # cookiejar path -> http code
  curl -s -o "$WORK/body" -w '%{http_code}' --max-time 60 -b "$1" "$API$2"
}

c1() {
  for app in "$API_APP" "$NEW_DB"; do
    regions=$(machine_regions "$app") || fail "cannot list machines of $app"
    [ -n "$regions" ] || fail "$app has no machines"
    echo "$regions" | grep -qv '^lax$' && fail "$app has a machine outside lax: $regions"
    echo "$app: $(echo $regions)"
  done
  user_sql="select count(*) from pg_user where usename = '$DB_NAME'"
  [ "$(db_query "$NEW_DB" 25432 "$user_sql")" = 1 ] || fail "$NEW_DB has no $DB_NAME user (not attached)"
  fly apps list --json | python3 -c 'import json,sys; print("\n".join(a["Name"] for a in json.load(sys.stdin)))' >"$WORK/apps" \
    || fail "cannot list fly apps"
  grep -qx "$OLD_DB" "$WORK/apps" && fail "$OLD_DB still exists"
  echo "attached to $NEW_DB; $OLD_DB is gone"

  [ -s "$FROZEN" ] || fail "frozen snapshot $FROZEN is missing"
  ledger_sql="select string_agg(m::text, E'\\n' order by m::text) from schema_migrations m"
  new_ledger=$(db_query "$NEW_DB" 25432 "$ledger_sql" "$NEW_DB_NAME" 2>&1) || fail "cannot read schema_migrations on $NEW_DB/$NEW_DB_NAME: $new_ledger"
  sed -n 's/^ledger|//p' "$FROZEN" >"$WORK/ledger_old"
  [ -s "$WORK/ledger_old" ] || fail "$FROZEN has no ledger rows"
  while IFS= read -r row; do
    grep -qxF -- "$row" <<<"$new_ledger" || fail "schema_migrations row missing on $NEW_DB/$NEW_DB_NAME: $row"
  done <"$WORK/ledger_old"
  echo "all $(wc -l <"$WORK/ledger_old") frozen schema_migrations rows present on $NEW_DB"

  counts_sql="select table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', table_name), false, true, '')))[1]::text
    from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1"
  grep -v '^#' "$FROZEN" | grep -v '^ledger|' >"$WORK/counts_old"
  db_query "$NEW_DB" 25432 "$counts_sql" "$NEW_DB_NAME" >"$WORK/counts_new"
  [ -s "$WORK/counts_old" ] || fail "$FROZEN has no tables"
  while IFS='|' read -r table _old; do
    grep -q "^$table|" "$WORK/counts_new" || fail "table $table is missing on $NEW_DB/$NEW_DB_NAME"
  done <"$WORK/counts_old"
  echo "all $(wc -l <"$WORK/counts_old") old tables present on $NEW_DB"
}

c2() {
  login "$CHECK_EMAIL" "$WORK/jar"
  # `fly logs --no-tail` keeps only a few lines, so stream the log while the requests run.
  timeout 45 fly logs -a "$API_APP" >"$WORK/log" 2>&1 &
  local tail_pid=$!
  sleep 10
  for _ in 1 2 3; do [ "$(get "$WORK/jar" /api/auth/me)" = 200 ] || fail "/api/auth/me not 200"; done
  wait "$tail_pid" || true
  ms=$(grep '\[REQ_TIMING\] GET /api/auth/me ' "$WORK/log" | grep -o 'auth_ms=[0-9]*' | cut -d= -f2 || true)
  [ -n "$ms" ] || fail "no [REQ_TIMING] line for /api/auth/me in the log"
  echo "auth_ms of the last /api/auth/me requests: $(echo $ms)"
  best=$(echo "$ms" | sort -n | head -1)
  [ "$best" -lt 20 ] || fail "session check took ${best} ms (>= 20)"
}

c3() {
  login "$CHECK_EMAIL" "$WORK/jar"
  [ "$(get "$WORK/jar" /api/auth/me)" = 200 ] || fail "signed-in /api/auth/me not 200"
  grep -q "\"email\":\"$CHECK_EMAIL\"" "$WORK/body" || fail "/api/auth/me is not $CHECK_EMAIL"
  echo "sign-in ok"
  token=$(db_query "$NEW_DB" 25432 "select s.share_token from shares s join share_videos v on v.share_id = s.id
    where s.revoked_at is null and v.is_public order by s.shared_at desc limit 1")
  [ -n "$token" ] || fail "no public video share on staging to open"
  [ "$(get "$WORK/jar" "/api/shared/$token")" = 200 ] || fail "shared link $token not 200"
  grep -q "\"share_token\":\"$token\"" "$WORK/body" || fail "shared link body lacks its token"
  echo "shared link ok"
  login "$ADMIN_EMAIL" "$WORK/admin"
  [ "$(get "$WORK/admin" /api/admin/dashboard)" = 200 ] || fail "admin dashboard not 200"
  grep -q '"users"' "$WORK/body" || fail "admin dashboard body lacks users"
  echo "admin dashboard ok"
}

case "${1:-}" in
  c1|c2|c3) "$1"; echo "PASS T16410:${1^^}" ;;
  *) echo "usage: $0 c1|c2|c3" >&2; exit 2 ;;
esac
