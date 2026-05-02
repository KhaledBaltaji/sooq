#!/bin/bash
# wire-database-url.sh — pulls RDS master password from AWS Secrets Manager
# and writes a single DATABASE_URL line to .env.local. Idempotent: removes
# any existing DATABASE_URL lines (commented or not) before writing the new one.
#
# Run: bash scripts/wire-database-url.sh

set -euo pipefail

ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env.local"
SECRET_ARN='arn:aws:secretsmanager:eu-central-1:940161469084:secret:rds!db-fc910551-747a-4b28-8abc-f9c271c3a2e7-gki8se'
ENDPOINT='sooq-staging-db.cl0keqcqsenr.eu-central-1.rds.amazonaws.com'

echo "==> Pulling RDS master password from Secrets Manager..."
SECRET_JSON=$(aws secretsmanager get-secret-value \
  --secret-id "$SECRET_ARN" \
  --query SecretString \
  --output text)

PGPASSWORD=$(echo "$SECRET_JSON" | python3 -c "import sys,json;print(json.load(sys.stdin)['password'])")
PGUSER=$(echo "$SECRET_JSON"  | python3 -c "import sys,json;print(json.load(sys.stdin)['username'])")

if [ -z "$PGPASSWORD" ]; then
  echo "✗ Failed to extract password from secret" >&2
  exit 1
fi

echo "==> Cleaning any existing DATABASE_URL lines from .env.local..."
# Remove lines that start with DATABASE_URL= or # DATABASE_URL=
# (matches both commented and uncommented entries)
if [ -f "$ENV_FILE" ]; then
  grep -vE '^[[:space:]]*#?[[:space:]]*DATABASE_URL=' "$ENV_FILE" > "$ENV_FILE.tmp" || true
  mv "$ENV_FILE.tmp" "$ENV_FILE"
fi

echo "==> Appending fresh DATABASE_URL..."
{
  echo ""
  echo "# Wired by scripts/wire-database-url.sh on $(date '+%Y-%m-%d')"
  echo "DATABASE_URL=postgresql://${PGUSER}:${PGPASSWORD}@${ENDPOINT}:5432/sooq?sslmode=require"
} >> "$ENV_FILE"

echo "==> Verifying..."
COUNT=$(grep -cE '^DATABASE_URL=' "$ENV_FILE")
if [ "$COUNT" -eq 1 ]; then
  echo "✓ Exactly one DATABASE_URL line in .env.local"
  echo "✓ User: $PGUSER"
  echo "✓ Host: $ENDPOINT"
  echo "✓ Password length: ${#PGPASSWORD} chars"
else
  echo "✗ Expected 1 DATABASE_URL line, found $COUNT" >&2
  exit 1
fi

echo ""
echo "Done. You can now run:"
echo "  cd /Users/khaledbaltaji/Desktop/Sooq && npm run dev"
