#!/usr/bin/env bash
# Build Heads I Win as a static site for GitHub Pages (https://<user>.github.io/<repo>/).
#
# The live app serves two sites from one server and a Postgres database; Pages serves plain files.
# This copies the app into a fresh temp directory without Boardtape, the admin and the JSON API, makes
# Heads I Win the root, and pre-renders every page from the local database. Figures derived from the
# unlicensed prototype price data are left out (HIW_NO_PRICES=1). Prints the output directory.
#
#   web/scripts/export-pages.sh            # then publish the printed directory to the gh-pages branch
set -euo pipefail

WEB="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(dirname "$WEB")"
BASE_PATH="${BASE_PATH:-/boardtenure}"
SITE_URL="${HIW_SITE_URL:-https://autisticvegan.github.io}"   # origin only; Next adds the base path
WORK="$(mktemp -d -t hiw-pages)"

rsync -a "$WEB/" "$WORK/web/" \
  --exclude node_modules --exclude .next --exclude out --exclude scripts \
  --exclude 'src/app/(boardtape)' --exclude src/app/api --exclude src/proxy.ts \
  --exclude src/app/hiw/sold --exclude 'src/app/hiw/case/[[]cik]/opengraph-image.tsx' \
  --exclude src/app/not-found.tsx --exclude src/app/robots.ts
ln -s "$WEB/node_modules" "$WORK/web/node_modules"
ln -s "$REPO/data" "$WORK/data"   # the logo files in the raw store

cd "$WORK/web"
mv src/app/hiw "src/app/(hiw)"    # a route group: Heads I Win at the site root
grep -rl 'PageProps<"/hiw' src | xargs sed -i '' 's|PageProps<"/hiw/|PageProps<"/|g; s|PageProps<"/hiw">|PageProps<"/">|g'

cat > src/app/not-found.tsx <<'TSX'
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="py-24 text-center">
      <p className="text-[12px] text-ink-3 uppercase tracking-wide">Not found</p>
      <h1 className="mt-2 text-[24px] font-semibold tracking-tight">We don&rsquo;t have that page</h1>
      <p className="mt-6"><Link href="/" className="text-[14px] text-accent-ink hover:underline underline-offset-2">Back to Heads I Win →</Link></p>
    </div>
  );
}
TSX
cat > src/app/robots.ts <<'TSX'
import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", allow: "/" }] };
}
TSX

STATIC_EXPORT=1 NEXT_PUBLIC_BASE_PATH="$BASE_PATH" HIW_NO_PRICES=1 HIW_SITE_URL="$SITE_URL" DB_POOL_MAX=2 \
  ./node_modules/.bin/next build --webpack >&2   # Turbopack rejects the symlinked node_modules
touch out/.nojekyll               # Pages' Jekyll would hide _next/
echo "$WORK/web/out"
