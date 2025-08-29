#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../frontend"
if ! command -v pnpm >/dev/null 2>&1; then
  corepack enable && corepack prepare pnpm@9.6.0 --activate
fi
pnpm install
NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL:-http://localhost:8000} pnpm dev
