#!/bin/bash

cd "$(dirname $0)/../config"

source postgres.vars

export PGUSER=postgres
export PGPASSWORD="$PG_MASTER_PASSWORD"

psql <<< "CREATE ROLE omnivore WITH LOGIN PASSWORD '$PG_APP_PASSWORD' CREATEDB"
psql -d template1 -c "CREATE EXTENSION ltree"
oids=$(
  psql -d template1 -At -c "SELECT 'const '||typname||' = '||oid||', '||typname||'_array = '||typarray||';' FROM pg_type WHERE typname IN ('ltree', 'lquery')"
)

cat <<< "// $PG_ID
const host = '$PGHOST';
const password = '$PG_APP_PASSWORD';
$oids
// ---
$(cat env-production.js)" > env-production.js
