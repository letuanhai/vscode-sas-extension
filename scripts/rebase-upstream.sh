#!/bin/bash
# Full rebase workflow for the sasstudio-web fork.
# Usage: ./scripts/rebase-upstream.sh [patch_number]
#
# First run:  backup tag → fetch → rebase (may stop on conflicts)
# Re-run after resolving conflicts: continue rebase → version bump
set -e

BRANCH=$(git rev-parse --abbrev-ref HEAD)
PATCH=${1:-1}

# Detect if a rebase is in progress
REBASE_IN_PROGRESS=false
if [ -d "$(git rev-parse --git-dir)/rebase-merge" ] || [ -d "$(git rev-parse --git-dir)/rebase-apply" ]; then
  REBASE_IN_PROGRESS=true
fi

if [ "$REBASE_IN_PROGRESS" = true ]; then
  echo "=== Resuming rebase ==="
  if ! git rebase --continue; then
    echo ""
    echo "⚠️  Still have conflicts. Resolve them, then re-run this script."
    exit 1
  fi
else
  # Step 1: Backup current state
  BACKUP_TAG="pre-rebase/$(date +%Y%m%d-%H%M%S)"
  echo "=== Step 1: Creating backup tag '${BACKUP_TAG}' ==="
  git tag "${BACKUP_TAG}"
  echo "  To restore: git rebase --abort  OR  git reset --hard ${BACKUP_TAG}"

  # Step 2: Fetch upstream (--no-prune to avoid deleting our backup tag)
  echo "=== Step 2: Fetching upstream ==="
  git fetch upstream --no-prune

  # Step 3: Rebase
  echo "=== Step 3: Rebasing onto upstream/main ==="
  if ! git rebase upstream/main; then
    echo ""
    echo "⚠️  Rebase conflicts detected. Resolve them, then re-run:"
    echo "  ./scripts/rebase-upstream.sh ${PATCH}"
    exit 1
  fi
fi

# Step 4: Update version
UPSTREAM_VER=$(node -p "require('./package.json').version")
echo "=== Setting version ${UPSTREAM_VER}-sasstudio-web.${PATCH} ==="
npm version "${UPSTREAM_VER}-sasstudio-web.${PATCH}" --no-git-tag-version

echo ""
echo "✅ Rebase complete."
echo "  Version: $(node -p "require('./package.json').version")"
echo ""
echo "Next steps:"
echo "  1. Review: git log --oneline upstream/main..HEAD"
echo "  2. Update CHANGELOG-SASSTUDIO-WEB.md if needed"
echo "  3. Push: git push --force-with-lease origin ${BRANCH}"
