#!/bin/bash
# Verify Supabase CLI is linked to staging, not production
# Skip in CI — no local Supabase link, tests use env vars directly
if [ -n "$CI" ]; then
  echo "CI detected — skipping Supabase link check"
  exit 0
fi

ALLOWED_REF="zzebptrztuwnqlxxmjuo"
PROD_REF="dwpizrhtyrquhibqcuuu"
CURRENT=$(cat supabase/.temp/project-ref 2>/dev/null)

if [ "$CURRENT" = "$PROD_REF" ]; then
  echo "DANGER: Supabase CLI is linked to PRODUCTION!"
  echo "Run: npx supabase link --project-ref $ALLOWED_REF"
  exit 1
elif [ "$CURRENT" = "$ALLOWED_REF" ]; then
  echo "OK: Linked to staging ($ALLOWED_REF)"
elif [ -z "$CURRENT" ]; then
  echo "WARNING: No project linked. Link staging first:"
  echo "  npx supabase link --project-ref $ALLOWED_REF"
  exit 1
else
  echo "WARNING: Linked to unknown project: $CURRENT"
  exit 1
fi
