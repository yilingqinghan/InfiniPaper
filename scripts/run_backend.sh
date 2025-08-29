#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../backend"
if [ ! -f ".env" ]; then
  cp .env.example .env
fi
# Use Poetry if available, else fallback to system pip
if command -v poetry >/dev/null 2>&1; then
  poetry install
  poetry run uvicorn app.main:app --reload --port 8000
else
  echo "Poetry not found. Install from https://python-poetry.org/ or manage deps manually."
  exit 1
fi
