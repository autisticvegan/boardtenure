import type { NextRequest } from "next/server";
import { api, ApiError } from "@/lib/api";
import { getBoard, getCompany } from "@/lib/queries";
import { publicMembership } from "@/lib/public";

export const GET = api(async (_req: NextRequest, ctx: RouteContext<"/api/v1/companies/[ticker]/board">) => {
  const { ticker } = await ctx.params;
  const company = await getCompany(ticker);
  if (!company) throw new ApiError(404, "company not found");
  const board = (await getBoard(company.id)).filter((m) => m.status === "current");
  return { company: company.slug, directors: board.map(publicMembership) };
});
