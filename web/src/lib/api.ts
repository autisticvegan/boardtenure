import "server-only";
import { NextResponse, type NextRequest } from "next/server";

/*
 * API guardrails. The public API exposes page-shaped, server-aggregated data only:
 * no bulk endpoints, capped page sizes, derived returns instead of raw price bars.
 *
 * Rate limiting here is a per-process token bucket keyed by client IP (and API key when
 * present). Production runs behind CloudFront + AWS WAF rate-based rules, which stop
 * volumetric abuse at the edge; this layer enforces per-client fairness at the origin.
 * Swap `buckets` for Redis when more than one origin instance runs.
 */

type Bucket = { tokens: number; updated: number };
const buckets = new Map<string, Bucket>();

const ANON = { capacity: 60, refillPerSec: 1 }; // burst 60, sustained 60/min
const KEYED = { capacity: 600, refillPerSec: 10 };

function clientKey(req: NextRequest): { key: string; limits: typeof ANON } {
  const apiKey = req.headers.get("x-api-key");
  if (apiKey && validApiKey(apiKey)) return { key: `k:${apiKey}`, limits: KEYED };
  // Trust only the first X-Forwarded-For hop, which our CDN/load balancer sets.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
  return { key: `ip:${ip}`, limits: ANON };
}

function validApiKey(key: string): boolean {
  const allowed = (process.env.API_KEYS ?? "").split(",").filter(Boolean);
  return allowed.includes(key);
}

export function takeToken(req: NextRequest, cost = 1): { ok: boolean; remaining: number; retryAfter: number } {
  const { key, limits } = clientKey(req);
  const now = Date.now() / 1000;
  const b = buckets.get(key) ?? { tokens: limits.capacity, updated: now };
  b.tokens = Math.min(limits.capacity, b.tokens + (now - b.updated) * limits.refillPerSec);
  b.updated = now;
  const ok = b.tokens >= cost;
  if (ok) b.tokens -= cost;
  buckets.set(key, b);
  if (buckets.size > 50_000) prune(now);
  return { ok, remaining: Math.floor(b.tokens), retryAfter: ok ? 0 : Math.ceil((cost - b.tokens) / limits.refillPerSec) };
}

function prune(now: number) {
  for (const [k, b] of buckets) if (now - b.updated > 600) buckets.delete(k);
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Handler<C> = (req: NextRequest, ctx: C) => Promise<unknown>;

/** Wrap a GET handler with rate limiting, error shaping and CDN cache headers. */
export function api<C>(handler: Handler<C>, opts: { cost?: number; maxAge?: number } = {}) {
  return async (req: NextRequest, ctx: C) => {
    const limit = takeToken(req, opts.cost ?? 1);
    if (!limit.ok) {
      return NextResponse.json(
        { error: "rate_limited", message: "Too many requests. Slow down or use an API key." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
      );
    }
    try {
      const body = await handler(req, ctx);
      return NextResponse.json(body, {
        headers: {
          "Cache-Control": `public, max-age=60, s-maxage=${opts.maxAge ?? 3600}, stale-while-revalidate=86400`,
          "X-RateLimit-Remaining": String(limit.remaining),
          "X-Robots-Tag": "noindex",
        },
      });
    } catch (e) {
      if (e instanceof ApiError) return NextResponse.json({ error: e.message }, { status: e.status });
      console.error(e);
      return NextResponse.json({ error: "internal_error" }, { status: 500 });
    }
  };
}

export function intParam(req: NextRequest, name: string, def: number, min: number, max: number): number {
  const raw = req.nextUrl.searchParams.get(name);
  const v = raw == null ? def : Number.parseInt(raw, 10);
  if (!Number.isFinite(v)) throw new ApiError(400, `invalid ${name}`);
  return Math.min(max, Math.max(min, v));
}
