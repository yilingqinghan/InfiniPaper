#!/usr/bin/env bash
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: scripts/import.sh exports/xxx.sql"
  exit 1
fi

FILE="$1"
DB_URL=${DATABASE_URL:-postgresql://infinipaper:infinipaper@127.0.0.1:5432/infinipaper}

if ! command -v psql >/dev/null 2>&1; then
  echo "psql not found. Install PostgreSQL client tools."
  exit 1
fi

psql "$DB_URL" -f "$FILE"
echo "Import done."
