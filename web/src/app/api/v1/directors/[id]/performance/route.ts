import type { NextRequest } from "next/server";
import { api, ApiError } from "@/lib/api";
import { getCareer, getPerson } from "@/lib/queries";
import { trackRecord } from "@/lib/track-record";

export const GET = api(async (_req: NextRequest, ctx: RouteContext<"/api/v1/directors/[id]/performance">) => {
  const { id } = await ctx.params;
  const person = await getPerson(id);
  if (!person) throw new ApiError(404, "director not found");
  return { director: person.slug, track_record: trackRecord(await getCareer(person.id)) };
});
