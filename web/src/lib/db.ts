import "server-only";
import postgres from "postgres";

// One pool per server process; reused across hot reloads in development.
const globalForDb = globalThis as unknown as { sql?: postgres.Sql };

export const sql =
  globalForDb.sql ??
  postgres(process.env.DATABASE_URL ?? "postgresql:///boardtenure_dev", {
    max: 10,
    idle_timeout: 30,
    // numeric -> number: every numeric column we read is a price or ratio that fits a double.
    types: {
      numeric: { to: 1700, from: [1700], serialize: (x: number) => String(x), parse: (x: string) => Number(x) },
      // Calendar dates stay ISO strings so no timezone can shift them a day.
      date: { to: 1082, from: [1082], serialize: (x: string) => x, parse: (x: string) => x },
    },
    transform: { undefined: null },
  });

if (process.env.NODE_ENV !== "production") globalForDb.sql = sql;
