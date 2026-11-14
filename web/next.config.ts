import type { NextConfig } from "next";

// STATIC_EXPORT=1 builds the Heads I Win site as plain files for GitHub Pages (scripts/export-pages.sh
// assembles a copy of the app without Boardtape, the admin and the API first).
const isExport = process.env.STATIC_EXPORT === "1";

const nextConfig: NextConfig = isExport
  ? { output: "export", basePath: process.env.NEXT_PUBLIC_BASE_PATH || undefined, trailingSlash: true,
      images: { unoptimized: true },
      // each build worker opens its own database pool; keep the total under Postgres's connection limit
      experimental: { cpus: 4 } }
  : {};

export default nextConfig;
