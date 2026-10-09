import { NextResponse, type NextRequest } from "next/server";
import { getRandomRankedSlug } from "@/lib/queries-dashboard";
import { parseScope, withScope } from "@/lib/standings";

// A different director on every request (§4.8).
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const scope = parseScope({ scope: request.nextUrl.searchParams.get("scope") ?? undefined });
  const slug = await getRandomRankedSlug(scope);
  const target = slug ? withScope(`/d/${slug}`, scope) : withScope("/", scope);
  const res = NextResponse.redirect(new URL(target, request.nextUrl.origin), 307);
  res.headers.set("Cache-Control", "no-store");
  return res;
}
