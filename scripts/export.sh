#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Ensure exports dir
mkdir -p exports

# SQL dump (requires pg_dump)
if ! command -v pg_dump >/dev/null 2>&1; then
  echo "pg_dump not found. Install PostgreSQL client tools."
  exit 1
fi

DB_URL=${DATABASE_URL:-postgresql://infinipaper:infinipaper@127.0.0.1:5432/infinipaper}
TS=$(date +"%Y%m%d_%H%M%S")
pg_dump "$DB_URL" > "exports/infinipaper_${TS}.sql"
echo "Wrote exports/infinipaper_${TS}.sql"

# JSON export via Poetry
if command -v poetry >/dev/null 2>&1; then
  (cd backend && poetry run python ../scripts/export_json.py)
else
  echo "Poetry not found, skipping JSON export. You can run scripts/export_json.py inside backend venv."
fi
