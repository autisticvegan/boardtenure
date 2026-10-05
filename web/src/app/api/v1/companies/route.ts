import type { NextRequest } from "next/server";
import { api, intParam } from "@/lib/api";
import { listCompanies } from "@/lib/queries";

export const GET = api(async (req: NextRequest) => {
  const limit = intParam(req, "limit", 25, 1, 50);
  const offset = intParam(req, "offset", 0, 0, 10_000);
  const all = await listCompanies();
  return { total: all.length, limit, offset, companies: all.slice(offset, offset + limit) };
});
