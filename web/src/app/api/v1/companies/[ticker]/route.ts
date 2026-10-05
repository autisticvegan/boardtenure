import type { NextRequest } from "next/server";
import { api, ApiError } from "@/lib/api";
import { getCompany, getCoverage } from "@/lib/queries";

export const GET = api(async (_req: NextRequest, ctx: RouteContext<"/api/v1/companies/[ticker]">) => {
  const { ticker } = await ctx.params;
  const company = await getCompany(ticker);
  if (!company) throw new ApiError(404, "company not found");
  const { id, security_id, ...rest } = company;
  void security_id;
  return { company: rest, coverage: await getCoverage(id) };
});
