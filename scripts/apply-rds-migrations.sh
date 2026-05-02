#!/bin/bash
# apply-rds-migrations.sh — apply Drizzle migrations to staging RDS.
#
# Extracts DATABASE_URL from .env.local (without sourcing other vars that
# might have unescaped `$` characters in their values).
#
# Run: bash scripts/apply-rds-migrations.sh

set -eo pipefail

cd "$(dirname "$0")/.."
ENV_FILE=".env.local"

if [ ! -f "$ENV_FILE" ]; then
  echo "✗ .env.local not found at $(pwd)" >&2
  exit 1
fi

# Extract just the DATABASE_URL line — avoids parsing other env values
DATABASE_URL=$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d'=' -f2-)
export DATABASE_URL

if [ -z "$DATABASE_URL" ]; then
  echo "✗ DATABASE_URL not found in .env.local — run scripts/wire-database-url.sh first" >&2
  exit 1
fi

HOST=$(echo "$DATABASE_URL" | sed -E 's|.*@([^:/]+).*|\1|')
echo "==> DATABASE_URL host: $HOST"
echo "==> Applying Drizzle migrations to RDS..."
echo "    (NODE_TLS_REJECT_UNAUTHORIZED=0 — RDS uses Amazon's CA;"
echo "     production should download the cert and verify properly)"
echo ""

NODE_TLS_REJECT_UNAUTHORIZED=0 npx drizzle-kit migrate

echo ""
echo "==> Done."
