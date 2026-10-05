import { NextResponse, type NextRequest } from "next/server";

// Optimistic gate for /admin; pages and actions re-verify with requireAdmin().
export function proxy(request: NextRequest) {
  const header = request.headers.get("authorization");
  const user = process.env.ADMIN_USER;
  const pass = process.env.ADMIN_PASSWORD;
  if (user && pass && header?.startsWith("Basic ")) {
    const decoded = atob(header.slice(6));
    if (decoded === `${user}:${pass}`) return NextResponse.next();
  }
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="BoardTenure admin", charset="UTF-8"' },
  });
}

export const config = { matcher: ["/admin", "/admin/:path*"] };
