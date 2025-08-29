#!/usr/bin/env bash
set -euo pipefail

# This script targets Debian/Ubuntu-like systems. Adjust for your distro as needed.
if command -v apt-get >/dev/null 2>&1; then
  sudo apt-get update
  # Install Postgres 16 and pgvector extension (package names may vary by distro)
  sudo apt-get install -y postgresql postgresql-contrib
else
  echo "Please install PostgreSQL 16 and pgvector extension for your distribution."
  exit 1
fi

# Start service
sudo systemctl enable postgresql || true
sudo systemctl start postgresql || true

sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE ROLE infinipaper WITH LOGIN PASSWORD 'infinipaper';" || true
sudo -u postgres psql -v ON_ERROR_STOP=1 -c "ALTER ROLE infinipaper WITH SUPERUSER;" || true
sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE DATABASE infinipaper OWNER infinipaper;" || true
sudo -u postgres psql -d infinipaper -v ON_ERROR_STOP=1 -c "CREATE EXTENSION IF NOT EXISTS vector;"

echo "PostgreSQL ready. Connection: postgresql+psycopg://infinipaper:infinipaper@127.0.0.1:5432/infinipaper"
