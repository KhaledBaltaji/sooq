#!/bin/bash
# Install git hooks for safety governance
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

cp "$SCRIPT_DIR/hooks/pre-commit" .git/hooks/pre-commit
cp "$SCRIPT_DIR/hooks/pre-push" .git/hooks/pre-push
chmod +x .git/hooks/pre-commit .git/hooks/pre-push

echo "Git hooks installed successfully."
echo "  - pre-commit: type check (npx tsc --noEmit)"
echo "  - pre-push: blocks direct pushes to main"
