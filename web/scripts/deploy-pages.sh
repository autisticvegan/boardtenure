#!/usr/bin/env bash
# Publish an export-pages.sh output directory to the repo's gh-pages branch, replacing what was there.
# The branch holds only the built site (including the company icons the pages show).
#
#   bash web/scripts/deploy-pages.sh /path/to/out
set -euo pipefail

OUT="${1:?usage: deploy-pages.sh <export output dir>}"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
REMOTE="$(git -C "$REPO" remote get-url origin)"
NAME="$(git -C "$REPO" config user.name)"
EMAIL="$(git -C "$REPO" config user.email)"

git -C "$OUT" init -q -b gh-pages
git -C "$OUT" add -A
git -C "$OUT" -c user.name="$NAME" -c user.email="$EMAIL" \
  commit -q -m "Heads I Win static site ($(git -C "$REPO" rev-parse --short HEAD))"
git -C "$OUT" push -q --force "$REMOTE" gh-pages
echo "published $(git -C "$OUT" rev-parse --short HEAD) to gh-pages"
