// Podium card for one ranked director (§5.2). The whole card is one link; chips inside are spans.
import Link from "next/link";
import type { ReactNode } from "react";
import type { RankScope, ScopedDirector } from "@/lib/queries";
import { CHIP_HINT, floorYears, shortRecord, tagsFor, topPct, withScope, type Tag } from "@/lib/standings";
import { Chip, RankBadge, Signed } from "./primitives";

const GLOW = "0 0 0 1px rgba(245,197,66,.40), 0 12px 32px -16px rgba(245,197,66,.35)";
const TAG_ORDER: Tag["key"][] = ["white-knuckle", "rocket", "rough"];

/** Distinct tickers of the seats counted in this scope, best seat first. */
export function scopedTickers(d: ScopedDirector, max = 3): string[] {
  const out: string[] = [];
  for (const s of d.companies) {
    const t = s.symbol ?? s.company_name;
    if (s.in_scope && !out.includes(t)) out.push(t);
  }
  return out.slice(0, max);
}

/** Highest-priority tag across the director's counted seats (at most one on cards). */
export function topTag(d: ScopedDirector): Tag | null {
  const tags = d.companies.filter((s) => s.in_scope).flatMap((s) => tagsFor(s));
  tags.sort((a, b) => TAG_ORDER.indexOf(a.key) - TAG_ORDER.indexOf(b.key));
  return tags[0] ?? null;
}

/** Fact chips for a director row or card: Short record, From IPO, Exec seat (All seats only), then one tag. */
export function directorChips(d: ScopedDirector, scope: RankScope): ReactNode[] {
  const chips: ReactNode[] = [];
  if (shortRecord(d)) chips.push(<Chip key="short" kind="short" label="Short record" hint={CHIP_HINT.short} />);
  const ipo = d.companies.find((s) => s.in_scope && s.start_anchor_reason === "first_trade");
  if (ipo) chips.push(<Chip key="ipo" kind="ipo" label="From IPO" hint={CHIP_HINT.ipo(ipo.start_anchor_date)} />);
  if (scope === "all" && d.scored_executive_seat) {
    const exec = d.companies.find((s) => s.in_scope && s.executive_seat);
    chips.push(<Chip key="exec" kind="exec" label="Exec seat" hint={CHIP_HINT.exec(exec?.executive_title ?? null)} />);
  }
  const tag = topTag(d);
  if (tag) chips.push(<Chip key={tag.key} kind="tag" label={tag.label} hint={tag.hint} />);
  return chips;
}

export function DirectorCard({ d, variant, scope, glow = false }: {
  d: ScopedDirector; variant: "top" | "bottom"; scope: RankScope; glow?: boolean;
}) {
  const tickers = scopedTickers(d);
  const chips = directorChips(d, scope);
  const top = variant === "top" ? topPct(d.rank, d.of) : null;
  return (
    <Link
      href={withScope(`/d/${d.slug}`, scope)}
      className="@container block h-full min-h-[120px] md:min-h-[136px] rounded-[14px] border border-line bg-surface shadow-card p-4 md:p-5
                 transition duration-[120ms] hover:-translate-y-0.5 hover:border-line-strong focus-visible:-translate-y-0.5 focus-visible:border-line-strong"
      style={glow ? { boxShadow: GLOW } : undefined}
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)] @min-[500px]:grid-cols-[auto_minmax(0,1fr)_auto] gap-x-4 gap-y-2 items-start">
        <RankBadge rank={d.rank} tie={d.tie} of={d.of} medal={variant === "top"} size="lg" />
        <div className="min-w-0">
          <p className="text-[17px] leading-6 font-[650] text-ink line-clamp-2">{d.full_name}</p>
          <p className="mt-0.5 text-[13px] leading-5 text-ink-2">
            <span className="font-mono text-[12px]">{tickers.join(", ")}</span> · {floorYears(d.scored_years)} scored yrs ·{" "}
            {d.beat_seats} of {d.scored_seats} seats beat the S&amp;P
          </p>
        </div>
        {/* Wide cards run the chips under body and figure so they don't add a third body line. */}
        {chips.length > 0 && (
          <p className="col-start-2 @min-[500px]:col-[2/span_2] @min-[500px]:row-start-2 flex flex-wrap gap-1.5">{chips}</p>
        )}
        <div className="col-start-2 @min-[500px]:col-start-3 @min-[500px]:row-start-1 @min-[500px]:text-right">
          <Signed value={d.score} kind="perYear" glyph size="l" />
          <p className="mt-1 text-[12px] leading-4 text-ink-3">vs S&amp;P 500, per year while seated</p>
          <p className="text-[12px] leading-4 text-ink-3">{top != null ? `top ${top}%` : `of ${d.of}`}</p>
        </div>
      </div>
    </Link>
  );
}
