// Same boardroom (seat page, docs/design/rankings-ui.md §4.5): every scored seat on this
// company on one strip, this seat ringed. Board-mates share one stock, so they cluster.
import { pct } from "@/lib/format";
import type { BoardStripRow, RankScope } from "@/lib/queries";
import { perYear, seatWindow, withScope } from "@/lib/standings";
import { Signed } from "./primitives";
import { StripRow, type StripDot } from "./strip-row";
import { TipBody } from "./tooltip";

// Must match StripRow's grid: 200px label, the strip, a 96px right column (md and up).
const GRID = "grid gap-x-4 md:grid-cols-[200px_minmax(0,1fr)_96px]";
const PAD = 8; // StripRow's inner padding on each side of the strip

const at = (v: number, domain: number) =>
  `calc(${PAD}px + ${(Math.max(-domain, Math.min(domain, v)) + domain) / (2 * domain)} * (100% - ${2 * PAD}px))`;

function Dot({ hollow = false, ring = false, fill }: { hollow?: boolean; ring?: boolean; fill: string }) {
  return (
    <svg width="18" height="18" aria-hidden className="shrink-0">
      {ring && <circle cx="9" cy="9" r="7" fill="none" stroke="var(--ink)" strokeWidth="2" />}
      <circle cx="9" cy="9" r="4" fill={hollow ? "none" : fill} stroke={hollow ? fill : "none"} strokeWidth={hollow ? 2 : 0} />
    </svg>
  );
}

export function SameBoardroom({ row, highlight, scope, domain }: {
  row: BoardStripRow; highlight: number[]; scope: RankScope; domain: number;
}) {
  const sym = row.symbol ?? row.common_name;
  const dots: StripDot[] = row.seats.map((s) => ({
    key: String(s.membership_id),
    href: withScope(`/c/${row.slug}/d/${s.person_slug}`, scope),
    x: s.annualized_excess,
    hollow: scope === "all" && s.executive_seat,
    ring: highlight.includes(Number(s.membership_id)),
    tip: (
      <TipBody
        lines={[
          `${s.full_name} · ${seatWindow(s.start_anchor_date, s.end_anchor_date, s.seat_status === "current")}`,
          `${perYear(s.annualized_excess)} vs S&P 500`,
          `Stock ${pct(s.total_return)} · S&P 500 ${pct(s.bench_total_return)}`,
          s.executive_seat ? "Exec seat" : null,
        ]}
      />
    ),
  }));
  const ringed = row.seats.some((s) => highlight.includes(Number(s.membership_id)));
  const anyHollow = dots.some((d) => d.hollow);
  const step = 0.1;
  const ticks: number[] = [];
  for (let v = -domain; v <= domain + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);

  return (
    <div role="group" className="space-y-2"
         aria-label={`Same boardroom: ${row.scored} scored seats on ${row.common_name}'s board, showing the stock vs the S&P 500 per year on a scale of ${pct(-domain, 0)} to ${pct(domain, 0)}.`}>
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] leading-4 text-ink-2" aria-label="Legend">
        <li className="inline-flex items-center gap-1"><Dot fill="var(--gain)" /><span aria-hidden>▲</span> Beat the S&amp;P</li>
        <li className="inline-flex items-center gap-1"><Dot fill="var(--loss)" /><span aria-hidden>▼</span> Trailed the S&amp;P</li>
        {ringed && <li className="inline-flex items-center gap-1"><Dot ring fill="var(--ink-3)" /> This seat</li>}
        {anyHollow && <li className="inline-flex items-center gap-1"><Dot hollow fill="var(--ink-3)" /> Exec seat</li>}
      </ul>

      <div className={GRID} aria-hidden>
        <span className="hidden md:block" />
        <span className="relative h-4">
          <span className="absolute -translate-x-1/2 whitespace-nowrap text-[12px] leading-4 text-ink-2" style={{ left: at(0, domain) }}>
            S&amp;P 500 pace
          </span>
        </span>
      </div>

      <StripRow
        label={
          <span className="block">
            <span className="font-mono text-[12px] text-ink-2">{sym}</span>{" "}
            <span className="text-[13px] text-ink">{row.common_name}</span>
            <span className="block text-[12px] leading-4 text-ink-3 num">
              {row.beat} of {row.scored} seats beat the S&amp;P
            </span>
          </span>
        }
        href={withScope(`/c/${row.slug}`, scope)}
        dots={dots}
        domain={domain}
        median={row.median_excess}
        right={
          <span className="block">
            <span className="block text-[11px] leading-[14px] text-ink-3">Median</span>
            <Signed value={row.median_excess} />
          </span>
        }
        srSummary={`${row.common_name}: ${row.beat} of ${row.scored} scored seats beat the S&P; median ${pct(row.median_excess)} a year.`}
      />

      <div className={GRID} aria-hidden>
        <span className="hidden md:block" />
        <span className="relative h-4 text-[11px] leading-[14px] text-ink-3 num">
          {ticks.map((v) => (
            <span
              key={v}
              className={`absolute -translate-x-1/2 whitespace-nowrap ${Math.round(v * 100) % 20 === 0 ? "" : "hidden lg:inline"}`}
              style={{ left: at(v, domain) }}
            >
              {pct(v, 0)}
            </span>
          ))}
        </span>
      </div>
      <p className="text-[11px] leading-[14px] text-ink-3 md:pl-[216px]">Stock vs S&amp;P 500, % per year during the seat</p>
    </div>
  );
}
