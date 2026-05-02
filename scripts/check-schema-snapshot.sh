#!/bin/bash
# check-schema-snapshot.sh
#
# Warn when a commit adds a new migration file but leaves supabase/schema.sql
# unchanged. Called from the pre-commit hook.
#
# Exits 0 (warning only) so developers can override when intentional
# (e.g., a no-op migration or a data-only migration). CI's `supabase db diff`
# step is the hard gate — this script is just a friendly heads-up.

set -e

# Only consider files staged for this commit.
STAGED=$(git diff --cached --name-only --diff-filter=A -- 'supabase/migrations/*.sql' 2>/dev/null || true)

if [ -z "$STAGED" ]; then
  # No newly-added migrations — nothing to check.
  exit 0
fi

# Did this commit also touch the schema snapshot?
SNAPSHOT_TOUCHED=$(git diff --cached --name-only -- 'supabase/schema.sql' 2>/dev/null || true)

if [ -n "$SNAPSHOT_TOUCHED" ]; then
  # Snapshot updated alongside the migration — all good.
  exit 0
fi

echo ""
echo "WARNING: New migration(s) staged but supabase/schema.sql is unchanged:"
for f in $STAGED; do
  echo "  + $f"
done
echo ""
echo "Regenerate the snapshot so CI's schema-drift gate stays green:"
echo "  cat supabase/.temp/project-ref   # must be zzebptrztuwnqlxxmjuo (staging)"
echo "  npx supabase db push"
echo "  npx supabase db dump --linked --schema public --data-only=false > supabase/schema.sql"
echo "  git add supabase/schema.sql"
echo ""
echo "If this migration intentionally makes no public-schema changes"
echo "(e.g., data-only, private schema, reversible no-op), you can commit as-is."
echo ""

# Warning only — do not block the commit. CI is the hard gate.
exit 0
