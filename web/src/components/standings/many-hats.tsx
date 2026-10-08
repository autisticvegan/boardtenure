// Many hats (§5.2): one StripRow per person on 2+ tracked boards, widest spread first (SQL order).
import { pct } from "@/lib/format";
import type { MultiBoardPerson, RankScope, ScopedDirector } from "@/lib/queries";
import { perYear, seatWindow, withScope } from "@/lib/standings";
import { StripAxis, StripLegend } from "./board-strips";
import { Signed } from "./primitives";
import { StripRow } from "./strip-row";
import { TipBody } from "./tooltip";

export function ManyHats({ people, ranked, domain, scope }: {
  people: MultiBoardPerson[]; ranked: Map<string, ScopedDirector>; domain: number; scope: RankScope;
}) {
  const hollow = people.some((p) => p.seats.some((s) => s.in_scope && s.executive_seat));
  return (
    <div role="group"
         aria-label={`Many hats: ${people.length} people, one dot per scored seat, showing the stock vs the S&P 500 per year on a scale of ${pct(-domain, 0)} to ${pct(domain, 0)}.`}
         className="rounded-[14px] border border-line bg-surface shadow-card px-4 py-3 md:px-5 md:py-4">
      <StripLegend hollow={hollow} />
      <StripAxis domain={domain} position="top" />
      <div className="space-y-3 md:space-y-2">
        {people.map((p) => {
          // Seats counted in this scope's score; exec seats (All seats only) are hollow.
          const seats = p.seats.filter((s) => s.in_scope && s.annualized_excess != null);
          const d = ranked.get(p.slug);
          const summary = seats.map((s) => `${s.symbol ?? s.company_name} ${pct(s.annualized_excess)} a year`).join(", ");
          return (
            <StripRow
              key={p.slug}
              href={withScope(`/d/${p.slug}`, scope)}
              label={
                <>
                  <span className="block truncate text-[13px] leading-5 text-ink">{p.full_name}</span>
                  <span className="block text-[12px] leading-4 text-ink-3">
                    {p.boards} boards{p.spread != null && <> · {(p.spread * 100).toFixed(1)} pts/yr spread</>}
                  </span>
                </>
              }
              domain={domain}
              right={d ? <Signed value={d.score} kind="perYear" /> : <span className="text-ink-3">Not ranked</span>}
              srSummary={`${p.full_name}: ${p.boards} boards${summary ? `; ${summary}` : ""}.${d ? ` Score ${perYear(d.score)}.` : " Not ranked."}`}
              dots={seats.map((s) => ({
                key: String(s.membership_id),
                href: withScope(`/c/${s.company_slug}/d/${p.slug}`, scope),
                x: s.annualized_excess!,
                hollow: s.executive_seat,
                caption: s.symbol ?? undefined,
                tip: (
                  <TipBody lines={[
                    `${s.symbol ?? s.company_name} · ${seatWindow(s.start_anchor_date, s.end_anchor_date, s.seat_status === "current")}`,
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
