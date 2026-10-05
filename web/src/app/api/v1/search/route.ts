import type { NextRequest } from "next/server";
import { api, ApiError } from "@/lib/api";
import { search } from "@/lib/queries";

export const GET = api(async (req: NextRequest) => {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  if (q.length > 80) throw new ApiError(400, "query too long");
  const results = (await search(q)).map(({ kind, slug, label, sublabel }) => ({ kind, slug, label, sublabel }));
  return { query: q, results };
}, { maxAge: 600 });
