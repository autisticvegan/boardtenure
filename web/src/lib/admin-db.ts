import "server-only";
import type postgres from "postgres";
import { sql } from "./db";

/**
 * Run an admin mutation in a transaction whose writes the audit triggers attribute to
 * this admin, with the reason they gave.
 */
export async function asAdmin<T>(actor: string, reason: string, fn: (tx: postgres.TransactionSql) => Promise<T>) {
  if (!reason.trim()) throw new Error("A reason is required for every correction.");
  return sql.begin(async (tx) => {
    await tx`SELECT set_config('bt.actor', ${`admin:${actor}`}, true), set_config('bt.reason', ${reason.trim()}, true)`;
    return fn(tx);
  }) as Promise<T>;
}
