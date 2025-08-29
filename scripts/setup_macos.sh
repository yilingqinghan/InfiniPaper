#!/usr/bin/env bash
set -euo pipefail

# Install Postgres 16
if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required. Install from https://brew.sh/"; exit 1
fi

brew list postgresql@16 >/dev/null 2>&1 || brew install postgresql@16
brew services start postgresql@16 || true

# Ensure PATH has psql from pg16
export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"

# Create role and database (idempotent)
createuser -s infinipaper || true
psql -U "$(whoami)" -d postgres -v ON_ERROR_STOP=1 -c "ALTER USER infinipaper WITH PASSWORD 'infinipaper';" || true
createdb -O infinipaper infinipaper || true

# Enable pgvector extension
psql -U infinipaper -d infinipaper -v ON_ERROR_STOP=1 -c "CREATE EXTENSION IF NOT EXISTS vector;"

echo "PostgreSQL ready. Connection: postgresql+psycopg://infinipaper:infinipaper@127.0.0.1:5432/infinipaper"
