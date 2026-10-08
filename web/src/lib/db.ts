import "server-only";
import postgres from "postgres";

// One pool per server process; reused across hot reloads in development. Bump the key when the
// pool options change, or a hot reload keeps serving the pool built with the old ones.
const POOL_KEY = "boardtenure.sql.v2";
const globalForDb = globalThis as unknown as Record<string, postgres.Sql | undefined>;

export const sql =
  globalForDb[POOL_KEY] ??
  postgres(process.env.DATABASE_URL ?? "postgresql:///boardtenure_dev", {
    max: 10,
    idle_timeout: 30,
    // numeric -> number: every numeric column we read is a price or ratio that fits a double.
    types: {
      numeric: { to: 1700, from: [1700], serialize: (x: number) => String(x), parse: (x: string) => Number(x) },
      // int8 -> number: every id is bigint, and ids built inside json_build_object already arrive
      // as numbers, so bare columns must match or Map/=== lookups between the two silently miss.
      bigint: { to: 20, from: [20], serialize: (x: number) => String(x), parse: (x: string) => Number(x) },
      // Calendar dates stay ISO strings so no timezone can shift them a day.
      date: { to: 1082, from: [1082], serialize: (x: string) => x, parse: (x: string) => x },
    },
    transform: { undefined: null },
  });

if (process.env.NODE_ENV !== "production") globalForDb[POOL_KEY] = sql;
