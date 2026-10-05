import "server-only";
import { timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";

/*
 * Admin access: HTTP Basic auth against ADMIN_USER / ADMIN_PASSWORD. proxy.ts challenges
 * browsers on /admin; every admin page and Server Action re-checks here, because Server
 * Actions are reachable by direct POST and proxy checks are only optimistic.
 * Production should put SSO in front of /admin as well (e.g. ALB + Cognito).
 */

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function checkBasicAuth(header: string | null): string | null {
  const user = process.env.ADMIN_USER;
  const pass = process.env.ADMIN_PASSWORD;
  if (!user || !pass || !header?.startsWith("Basic ")) return null;
  const [u, ...rest] = Buffer.from(header.slice(6), "base64").toString("utf8").split(":");
  return safeEqual(u, user) && safeEqual(rest.join(":"), pass) ? u : null;
}

/** The authenticated admin's name, or throws. */
export async function requireAdmin(): Promise<string> {
  const who = checkBasicAuth((await headers()).get("authorization"));
  if (!who) throw new Error("Unauthorized");
  return who;
}
