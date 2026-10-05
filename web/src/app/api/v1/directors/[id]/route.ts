import type { NextRequest } from "next/server";
import { api, ApiError } from "@/lib/api";
import { getPerson } from "@/lib/queries";

export const GET = api(async (_req: NextRequest, ctx: RouteContext<"/api/v1/directors/[id]">) => {
  const { id } = await ctx.params;
  const person = await getPerson(id);
  if (!person) throw new ApiError(404, "director not found");
  const { id: _internal, ...rest } = person;
  void _internal;
  return { director: rest };
});
