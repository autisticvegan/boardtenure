import { NextResponse, type NextRequest } from "next/server";

// Two sites, one app: requests for the Heads I Win host are served from app/hiw/.
const HIW_HOSTS = (process.env.HIW_HOSTS ?? "absurd.localhost").split(",").map((h) => h.trim()).filter(Boolean);

function isHiwHost(request: NextRequest): boolean {
  const host = (request.headers.get("host") ?? "").split(":")[0].toLowerCase();
  return HIW_HOSTS.includes(host);
}

// Optimistic gate for /admin; pages and actions re-verify with requireAdmin().
function adminGate(request: NextRequest) {
  const header = request.headers.get("authorization");
  const user = process.env.ADMIN_USER;
  const pass = process.env.ADMIN_PASSWORD;
  if (user && pass && header?.startsWith("Basic ")) {
    const decoded = atob(header.slice(6));
    if (decoded === `${user}:${pass}`) return NextResponse.next();
  }
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Boardtape admin", charset="UTF-8"' },
  });
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isHiwHost(request)) {
    if (pathname.startsWith("/admin")) return new NextResponse("Not found", { status: 404 });
    if (pathname.startsWith("/hiw") || pathname.startsWith("/api")) return NextResponse.next();
    const url = request.nextUrl.clone();
    url.pathname = `/hiw${pathname === "/" ? "" : pathname}`;
    return NextResponse.rewrite(url);
  }
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return adminGate(request);
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"] };
