import type { NextRequest } from "next/server";
import { api, ApiError } from "@/lib/api";
import { getBoard, getBoardEvents, getCompany } from "@/lib/queries";
import { publicMembership } from "@/lib/public";

export const GET = api(async (_req: NextRequest, ctx: RouteContext<"/api/v1/companies/[ticker]/board/history">) => {
  const { ticker } = await ctx.params;
  const company = await getCompany(ticker);
  if (!company) throw new ApiError(404, "company not found");
  const [board, events] = await Promise.all([getBoard(company.id), getBoardEvents(company.id)]);
  return {
    company: company.slug,
    memberships: board.map(publicMembership),
    events: events.map(({ id, ...e }) => (void id, e)),
  };
});
