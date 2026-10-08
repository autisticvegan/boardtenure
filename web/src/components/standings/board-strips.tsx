// Board by board (§5.2 BoardStrips): one StripRow per company on the page's shared domain, sorted by
// median seat (SQL order). Board-mates share one stock, so this is the clustering view.
// Server-rendered: StripRow is the client piece; tooltips arrive as rendered nodes.
import Link from "next/link";
import { pct } from "@/lib/format";
import type { BoardStripRow, RankScope } from "@/lib/queries";
import { perYear, seatWindow, withScope } from "@/lib/standings";
import { Signed } from "./primitives";
import { StripRow } from "./strip-row";
import { TipBody } from "./tooltip";

const LABEL_W = 200;
const GRID = "grid gap-x-4 grid-cols-1 md:grid-cols-[200px_1fr_96px]";
// StripRow insets its plot 8px on each side; the axis rows below use the same inset.
const at = (f: number) => `calc(8px + (100% - 16px) * ${f})`;

/** Shared x-axis rows: "S&P 500 pace" above the first strip, 10pp ticks under the last. */
export function StripAxis({ domain, position }: { domain: number; position: "top" | "bottom" }) {
  const f = (v: number) => (v + domain) / (2 * domain);
  const ticks: number[] = [];
  for (let t = -Math.round(domain * 10); t <= Math.round(domain * 10); t++) ticks.push(t / 10);
  return (
    <div className={GRID} aria-hidden>
      <div className="hidden md:block" />
      <div className={`relative ${position === "top" ? "h-5" : "h-7"}`}>
        {position === "top" ? (
          <span className="absolute bottom-0.5 -translate-x-1/2 whitespace-nowrap text-[12px] leading-4 text-ink-2" style={{ left: at(0.5) }}>
            S&amp;P 500 pace
          </span>
        ) : (
          <>
            <span className="absolute top-0 h-px bg-line-strong" style={{ left: 8, right: 8 }} />
            {ticks.map((t) => (
              <span key={t} className="absolute top-0 -translate-x-1/2 flex flex-col items-center" style={{ left: at(f(t)) }}>
                <span className="block h-1 w-px bg-line-strong" />
                <span className={`num mt-0.5 text-[11px] leading-[14px] text-ink-3 whitespace-nowrap ${Math.round(t * 100) % 20 ? "max-md:hidden" : ""}`}>
                  {pct(t, 0)}
                </span>
              </span>
            ))}
          </>
        )}
      </div>
      <div className="hidden md:block" />
    </div>
  );
}

function LegendDot({ fill, hollow = false }: { fill: string; hollow?: boolean }) {
  return (
    <svg width="10" height="10" aria-hidden className="shrink-0">
      <circle cx="5" cy="5" r={hollow ? 3.5 : 4} fill={hollow ? "none" : fill} stroke={hollow ? fill : "none"} strokeWidth={hollow ? 1.5 : 0} />
    </svg>
  );
}

/** Legend for the strip charts (§6.6): sign by colour and ▲/▼, exec seats as rings, the median tick. */
export function StripLegend({ hollow, median = false }: { hollow: boolean; median?: boolean }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 mb-3 text-[12px] leading-4 text-ink-2" aria-label="Legend">
      <li className="inline-flex items-center gap-1.5"><LegendDot fill="var(--gain)" /><span aria-hidden>▲</span> Beat the S&amp;P</li>
      <li className="inline-flex items-center gap-1.5"><LegendDot fill="var(--loss)" /><span aria-hidden>▼</span> Trailed the S&amp;P</li>
      {hollow && <li className="inline-flex items-center gap-1.5"><LegendDot fill="var(--ink-2)" hollow /> Exec seat</li>}
      {median && (
        <li className="inline-flex items-center gap-1.5">
          <svg width="10" height="12" aria-hidden className="shrink-0"><line x1="5" x2="5" y1="1" y2="11" stroke="var(--ink)" strokeWidth="2" /></svg>
          Board median
        </li>
      )}
    </ul>
  );
}

function Label({ r }: { r: BoardStripRow }) {
  return (
    <>
      <span className="block truncate">
        {r.symbol && <span className="font-mono text-[12px] leading-4 text-ink-2 mr-1.5">{r.symbol}</span>}
        <span className="text-[13px] leading-5 text-ink">{r.common_name}</span>
      </span>
      {r.scored > 0 && (
        <span className="block text-[12px] leading-4 text-ink-3">{r.beat} of {r.scored} seats beat the S&amp;P</span>
      )}
    </>
  );
}

export function BoardStrips({ rows, domain, scope }: { rows: BoardStripRow[]; domain: number; scope: RankScope }) {
  const hollow = rows.some((r) => r.seats.some((s) => s.executive_seat));
  const seats = rows.reduce((a, r) => a + r.scored, 0);
  return (
    <div role="group"
         aria-label={`Board by board: ${rows.length} companies, one dot per scored seat (${seats} in all), showing the stock vs the S&P 500 per year on a scale of ${pct(-domain, 0)} to ${pct(domain, 0)}.`}
         className="rounded-[14px] border border-line bg-surface shadow-card px-4 py-3 md:px-5 md:py-4">
      <StripLegend hollow={hollow} median />
      <StripAxis domain={domain} position="top" />
      <div className="space-y-2 md:space-y-1">
        {rows.map((r) => {
          const href = withScope(`/c/${r.slug}`, scope);
          if (r.scored === 0) {
            return (
              <div key={r.slug} className="grid items-center gap-x-4 grid-cols-1 md:grid-cols-[200px_1fr_96px]">
                <Link href={href} className="block min-w-0 max-md:min-h-11 max-md:content-center text-[13px] leading-5 hover:text-accent-ink"><Label r={r} /></Link>
                <div className="relative h-9 flex items-center justify-center">
                  <span className="absolute inset-x-2 top-1/2 border-t border-dashed border-line-strong" aria-hidden />
                  <span className="relative bg-surface px-2 text-[12px] leading-4 text-ink-3">No scored seats yet</span>
                </div>
                <div className="hidden md:block text-right text-[13px]"><Signed value={null} /></div>
              </div>
            );
          }
          return (
            <StripRow
              key={r.slug}
              label={<Label r={r} />}
              href={href}
              labelWidth={LABEL_W}
              domain={domain}
              median={r.median_excess}
              right={<Signed value={r.median_excess} kind="perYear" />}
              srSummary={`${r.common_name}: ${r.beat} of ${r.scored} scored seats beat the S&P; median ${pct(r.median_excess)} a year.`}
              dots={r.seats.map((s) => ({
                key: String(s.membership_id),
                href: withScope(`/c/${r.slug}/d/${s.person_slug}`, scope),
                x: s.annualized_excess,
                hollow: s.executive_seat,
                tip: (
                  <TipBody lines={[
                    `${s.full_name} · ${seatWindow(s.start_anchor_date, s.end_anchor_date, s.seat_status === "current")}`,
                    `${perYear(s.annualized_excess)} vs S&P 500`,
                    `Stock ${pct(s.total_return)} · S&P 500 ${pct(s.bench_total_return)}`,
                    s.executive_seat ? "Exec seat" : null,
                  ]} />
                ),
              }))}
            />
          );
        })}
      </div>
      <StripAxis domain={domain} position="bottom" />
    </div>
  );
}
