import type { NextRequest } from "next/server";
import { api, ApiError } from "@/lib/api";
import { getCompany } from "@/lib/queries";
import { getExecPay, getExecPayYears, getPayVsPerformance } from "@/lib/queries-pay";

// Named-executive pay against the stock over the same window. See docs/methodology.md "Executive pay".
export const GET = api(async (_req: NextRequest, ctx: RouteContext<"/api/v1/companies/[ticker]/pay">) => {
  const { ticker } = await ctx.params;
  const company = await getCompany(ticker);
  if (!company) throw new ApiError(404, "company not found");
  const [execs, years, pvp] = await Promise.all([
    getExecPay(company.id), getExecPayYears(company.id), getPayVsPerformance(company.id),
  ]);
  if (execs.length === 0) throw new ApiError(404, "no executive pay on file for this company");
  return {
    company: company.slug,
    benchmark: "S&P 500 (SPY total return)",
    pay_measure: "Summary Compensation Table total (grant-date value of equity awards)",
    executives: execs.map(({ person_id, ...e }) => ({
      ...e,
      fiscal_years: years.filter((y) => y.person_id === person_id).map(({ person_id: _p, ...y }) => (void _p, y)),
    })),
    pay_vs_performance: pvp.map((r) => ({ ...r, peos: r.peos.map(({ person_id: _p, ...p }) => (void _p, p)) })),
  };
}, { cost: 2 });
