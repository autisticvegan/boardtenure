import { readFile } from "node:fs/promises";
import path from "node:path";
import { sql } from "@/lib/db";

// Company icons as /logo/<cik>.svg, from the raw store (bt logos fetch), or a lettered badge for companies
// without one. Static, so the Pages export writes every icon a page can show as a plain file.
const DIR = path.join(process.cwd(), "..", "data", "raw", "logos");
const CACHE = "public, max-age=86400, stale-while-revalidate=604800";
// Images only: an SVG opened directly can't run script or load anything.
const SAFE = { "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox" };

function initials(name: string): string {
  const words = name
    .replace(/[,.’']/g, "")
    .replace(/\b(inc|corp|corporation|co|company|holdings?|group|plc|ltd|the|n\.?v|s\.?a|l\.?p)\b/gi, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return (words.length >= 2 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2)).toUpperCase();
}

function badge(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = h % 360;
  const text = initials(name).replace(/[<&>"]/g, "");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="hsl(${hue} 70% 90%)"/><text x="32" y="41" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif" font-size="24" font-weight="800" fill="hsl(${hue} 55% 30%)">${text}</text></svg>`;
}

/** The icon on a rounded chip: white for most, dark for white-on-transparent marks; wordmarks keep
 *  their shape up to 3:1. */
function chip(data: Buffer, type: string, tone: string | null, w: number | null, h: number | null): string {
  const aspect = w && h ? Math.min(3, Math.max(1, w / h)) : 1;
  const ih = 48, iw = Math.round(ih * aspect), pad = tone === "opaque" ? 0 : 8;
  const W = iw + pad * 2, H = ih + pad * 2;
  const bg = tone === "light" ? "#1d2230" : "#ffffff";
  const img = `data:${type};base64,${data.toString("base64")}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><defs><clipPath id="c"><rect width="${W}" height="${H}" rx="12"/></clipPath></defs><g clip-path="url(#c)"><rect width="${W}" height="${H}" fill="${bg}"/><image href="${img}" x="${pad}" y="${pad}" width="${iw}" height="${ih}" preserveAspectRatio="xMidYMid meet"/></g></svg>`;
}

export const dynamic = "force-static";

/** Every company a page can link or show, when exporting; otherwise icons render on first request. */
export async function generateStaticParams() {
  if (process.env.STATIC_EXPORT !== "1") return [];
  const rows = await sql<{ cik: number }[]>`
    SELECT cik FROM pvp_screen_ok UNION SELECT cik FROM company_logo
    UNION SELECT from_cik FROM failing_up_case WHERE from_cik IS NOT NULL
    UNION SELECT to_cik FROM failing_up_case WHERE to_cik IS NOT NULL`;
  return rows.map((r) => ({ file: `${r.cik}.svg` }));
}

export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const m = (await ctx.params).file.match(/^(\d{1,10})\.svg$/);
  if (!m) return new Response("Not found", { status: 404 });
  const cik = Number(m[1]);
  const rows = await sql<{ file: string | null; content_type: string | null; name: string | null; tone: string | null;
                          width: number | null; height: number | null }[]>`
    SELECT file, content_type, coalesce(l.name, s.entity_name) AS name, tone, width, height
    FROM (SELECT ${cik}::bigint AS cik) k
    LEFT JOIN company_logo l ON l.cik = k.cik
    LEFT JOIN LATERAL (SELECT entity_name FROM xbrl_frame_fact f WHERE f.cik = k.cik LIMIT 1) s ON true`;
  const row = rows[0];
  let svg: string | null = null;
  if (row?.file && /^[\w.-]+$/.test(row.file)) {
    try {
      svg = chip(await readFile(path.join(DIR, row.file)), row.content_type ?? "image/png", row.tone, row.width, row.height);
    } catch {
      /* file missing from this machine's raw store: fall through to the badge */
    }
  }
  return new Response(svg ?? badge(row?.name ?? String(cik)), {
    headers: { "content-type": "image/svg+xml", "cache-control": CACHE, ...SAFE },
  });
}
