import type { NextRequest } from "next/server";
import { api, ApiError } from "@/lib/api";
import { getCompany, getDefaultBenchmark, getReturnSeries } from "@/lib/queries";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

// Cumulative total returns (not raw prices), downsampled to at most 520 points.
export const GET = api(async (req: NextRequest, ctx: RouteContext<"/api/v1/companies/[ticker]/stock-performance">) => {
  const { ticker } = await ctx.params;
  const company = await getCompany(ticker);
  if (!company?.security_id) throw new ApiError(404, "company not found");
  const from = req.nextUrl.searchParams.get("from") ?? company.ipo_date ?? "1900-01-01";
  const to = req.nextUrl.searchParams.get("to") ?? company.last_date ?? "2999-12-31";
  if (!ISO.test(from) || !ISO.test(to)) throw new ApiError(400, "from/to must be YYYY-MM-DD");
  const bench = await getDefaultBenchmark();
  const series = await getReturnSeries(company.security_id, bench?.security_id ?? null, from, to);
  return { company: company.slug, benchmark: bench?.name ?? null, base_date: series[0]?.d ?? null, series };
}, { cost: 3 });
