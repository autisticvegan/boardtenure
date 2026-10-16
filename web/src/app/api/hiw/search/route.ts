import type { NextRequest } from "next/server";
import { searchCompanies } from "@/lib/queries-hiw";

// Company lookup for Heads I Win's search box: name or ticker -> company pages.
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2 || q.length > 60) return Response.json({ results: [] });
  const rows = await searchCompanies(q);
  return Response.json(
    { results: rows.map((r) => ({ cik: Number(r.cik), name: r.name, ticker: r.ticker || null })) },
    { headers: { "cache-control": "public, max-age=3600" } },
  );
}
