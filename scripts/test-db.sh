#!/usr/bin/env bash
# Applies the migrations to a throwaway database and runs the RLS checks.
# Usage: PGHOST=... PGPORT=... PGUSER=postgres scripts/test-db.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB=sf_test_$$
psql -v ON_ERROR_STOP=1 -q -c "create database $DB"
trap 'psql -q -c "drop database if exists $DB"' EXIT
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/tests/local_auth_stub.sql
for f in supabase/migrations/*.sql; do psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f"; done
psql -v ON_ERROR_STOP=1 -q -t -d "$DB" -f supabase/tests/rls_test.sql
