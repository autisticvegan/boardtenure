// The rest of the top 10 / bottom 10 (§5.2 StandingsPreview). Rows link to the director;
// rank badges show the SQL rank as-is.
import Link from "next/link";
import type { RankScope, ScopedDirector } from "@/lib/queries";
import { floorYears, withScope } from "@/lib/standings";
import { scopedTickers } from "./director-card";
import { PreviewTabs } from "./preview-tabs";
import type { PodiumRows } from "./podium";
import { ExcessBar, RankBadge, Signed } from "./primitives";

const PREVIEW = 10;

/** Ranks 4–10 and the mirror at the bottom, never repeating anyone already on the podium. */
export function pickPreview(rows: ScopedDirector[], podium: PodiumRows): { top: ScopedDirector[]; bottom: ScopedDirector[] } {
  const seen = new Set([...podium.top, ...podium.bottom].map((d) => d.person_id));
  const podiumTop = new Set(rows.filter((r) => r.rank <= 3).map((r) => r.person_id));
  const top = rows.filter((r) => r.rank > 3 && r.rank <= PREVIEW && !seen.has(r.person_id));
  top.forEach((r) => seen.add(r.person_id));
  let bottom: ScopedDirector[] = [];
  if (podium.bottom.length > 0) {
    const worst = [...rows].sort((a, b) => b.rank - a.rank || a.full_name.localeCompare(b.full_name));
    const cut = worst[Math.min(PREVIEW, worst.length) - 1].rank; // the 10th-lowest score's SQL rank
    bottom = worst.filter((r) => r.rank >= cut && !seen.has(r.person_id) && !podiumTop.has(r.person_id));
  }
  return { top, bottom };
}

function Row({ d, domain, scope, i }: { d: ScopedDirector; domain: number; scope: RankScope; i: number }) {
  return (
    <li>
      <Link
        href={withScope(`/d/${d.slug}`, scope)}
        className="grid grid-cols-[auto_minmax(0,1fr)_auto] md:grid-cols-[auto_minmax(0,1fr)_140px_auto] items-center gap-x-3 min-h-12 px-3 py-1.5 rounded-lg hover:bg-surface-2 transition-colors"
      >
        <RankBadge rank={d.rank} tie={d.tie} of={d.of} size="sm" />
        <span className="min-w-0">
          <span className="block truncate text-[14px] leading-5 font-semibold text-ink">{d.full_name}</span>
          <span className="block truncate text-[12px] leading-4 text-ink-3">
            <span className="font-mono">{scopedTickers(d).join(", ")}</span> · {floorYears(d.scored_years)} yrs
          </span>
        </span>
        <span className="hidden md:block">
          <ExcessBar value={d.score} domain={domain} size="md" width={140} animate delayMs={i * 15} />
        </span>
        <span className="text-right text-[13px] leading-5 min-w-[5.5rem]"><Signed value={d.score} kind="perYear" /></span>
      </Link>
    </li>
  );
}

function Column({ id, title, rows, domain, scope, tabbed }: {
  id: string; title: string; rows: ScopedDirector[]; domain: number; scope: RankScope; tabbed: boolean;
}) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className={`${tabbed ? "max-md:sr-only" : ""} mb-3 text-[20px] leading-[26px] font-bold tracking-[-0.01em] text-ink`}>{title}</h2>
      <ol className="rounded-[14px] border border-line bg-surface p-1.5 space-y-0.5">
        {rows.map((d, i) => <Row key={d.person_id} d={d} domain={domain} scope={scope} i={i} />)}
      </ol>
    </section>
  );
}

export function StandingsPreview({ top, bottom, domain, scope }: {
  top: ScopedDirector[]; bottom: ScopedDirector[]; domain: number; scope: RankScope;
}) {
  const tabbed = top.length > 0 && bottom.length > 0;
  const panels = [];
  if (top.length > 0) {
    panels.push({ key: "top", label: "Top 10",
      content: <Column id="rest-top" title="The rest of the top 10" rows={top} domain={domain} scope={scope} tabbed={tabbed} /> });
  }
  if (bottom.length > 0) {
    panels.push({ key: "bottom", label: "Bottom 10",
      content: <Column id="rest-bottom" title="The rest of the bottom 10" rows={bottom} domain={domain} scope={scope} tabbed={tabbed} /> });
  }
  if (panels.length === 0) return null;
  return (
    <div>
      <PreviewTabs panels={panels} />
      <p className="mt-3 text-[13px] leading-5">
        <Link href={withScope("/rankings", scope)} className="text-accent-ink hover:underline underline-offset-2">Full standings →</Link>
      </p>
    </div>
  );
}
