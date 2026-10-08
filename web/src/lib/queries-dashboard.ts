import "server-only";
import { sql } from "./db";
import type { RankScope } from "./queries";

/** One random rank-eligible director's slug in the scope (null when nobody is ranked). */
export async function getRandomRankedSlug(scope: RankScope): Promise<string | null> {
  const eligible = scope === "independent" ? sql`d.independent_rank_eligible` : sql`d.rank_eligible`;
  const [r] = await sql<{ slug: string }[]>`
    SELECT d.slug FROM director_scorecard d WHERE ${eligible} ORDER BY random() LIMIT 1`;
  return r?.slug ?? null;
}
