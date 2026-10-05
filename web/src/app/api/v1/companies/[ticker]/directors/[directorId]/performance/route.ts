import type { NextRequest } from "next/server";
import { api, ApiError } from "@/lib/api";
import { getBoard, getCompany } from "@/lib/queries";
import { publicMembership } from "@/lib/public";

export const GET = api(async (
  _req: NextRequest,
  ctx: RouteContext<"/api/v1/companies/[ticker]/directors/[directorId]/performance">,
) => {
  const { ticker, directorId } = await ctx.params;
  const company = await getCompany(ticker);
  if (!company) throw new ApiError(404, "company not found");
  const seats = (await getBoard(company.id)).filter((m) => m.person_slug === directorId);
  if (seats.length === 0) throw new ApiError(404, "director not found on this board");
  return { company: company.slug, director: directorId, tenures: seats.map(publicMembership) };
});
