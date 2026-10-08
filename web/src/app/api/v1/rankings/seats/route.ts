import type { NextRequest } from "next/server";
import { api, ApiError, intParam } from "@/lib/api";
import { getSeatRankings, type RankScope } from "@/lib/queries";

export const GET = api(async (req: NextRequest) => {
  const scope = (req.nextUrl.searchParams.get("scope") ?? "all") as RankScope;
  if (scope !== "all" && scope !== "independent") throw new ApiError(400, "scope must be all or independent");
  const order = req.nextUrl.searchParams.get("order") ?? "best";
  if (order !== "best" && order !== "worst") throw new ApiError(400, "order must be best or worst");
  const limit = intParam(req, "limit", 25, 1, 50);
  const offset = intParam(req, "offset", 0, 0, 10_000);
  const all = await getSeatRankings(scope);
  const ordered = order === "best" ? all : [...all].reverse();
  return {
    scope, order, total: all.length, limit, offset,
    metric: "annualized excess return vs SPY total return; exact seats lasting >= 365 days",
    seats: ordered.slice(offset, offset + limit).map(({ membership_id, ...s }) => (void membership_id, s)),
  };
});
