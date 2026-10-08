// ChipKey (docs/design/rankings-ui.md §5.3): the visible definitions of every chip and tag, so the
// chips' hover hints are never the only place that information lives.
import type { ReactNode } from "react";
import {
  CHIP_HINT, EXEC_SEAT_REASON, MIN_DIRECTOR_YEARS, NEW_COMPANY_DAYS, ROCKET, ROUGH, tagsFor, WHITE_KNUCKLE_MDD,
} from "@/lib/standings";
import { Chip, type ChipKind } from "./primitives";

// Tags are read back from tagsFor() so their names and rule text stay single-sourced.
const TAGS = [
  ...tagsFor({ annualized_excess: ROCKET, max_drawdown: WHITE_KNUCKLE_MDD, relative_return_pp: 1 }, 3),
  ...tagsFor({ annualized_excess: ROUGH, max_drawdown: null, relative_return_pp: null }, 3),
];

const FACTS: { kind: ChipKind; label: string; text: ReactNode }[] = [
  { kind: "short", label: "Short record", text: CHIP_HINT.short },
  { kind: "exec", label: "Exec seat", text: CHIP_HINT.exec(null) },
  { kind: "ipo", label: "From IPO", text: CHIP_HINT.ipo(null) },
  { kind: "current", label: "Current", text: CHIP_HINT.current },
  { kind: "new", label: "New", text: `The company joined the tracked set in the last ${NEW_COMPANY_DAYS} days.` },
  {
    kind: "warming",
    label: "Warming up",
    text: `Not ranked yet: needs ${MIN_DIRECTOR_YEARS} scored years. When a current seat would get there, the chip shows roughly when, if the seat continues.`,
  },
];

const REASONS: { label: string; text: string }[] = [
  { label: "Under 1 year", text: "The seat has less than a year of daily closes, so it isn't scored yet." },
  { label: "Under 1 year after listing", text: "The person joined before the stock listed, and the seat has less than a year of daily closes since the first trading day." },
  { label: "≈ Dates known to the year", text: "A join or leave date is known only to the month or year (the chip says which), so the stock's move is shown as a range and the seat isn't scored." },
  { label: "Dates unknown", text: "No filing gives a usable join date yet." },
  { label: "Price history gap", text: "Daily closes are missing for part of the seat." },
  { label: "Before listing", text: "The seat was held before the stock had a price history we can measure." },
  { label: EXEC_SEAT_REASON, text: "Held while an employee. Left out of Non-exec seats scores; switch to All seats to include it." },
];

/** `headingLevel` keeps the outline unbroken: 2 on /rankings (under the h1), 3 inside an h2 section. */
export function ChipKey({ headingLevel = 3 }: { headingLevel?: 2 | 3 }) {
  return (
    <details className="group rounded-xl border border-line bg-surface">
      <summary className="flex items-center justify-between gap-3 cursor-pointer select-none list-none px-4 sm:px-5 min-h-11 text-[13px] font-semibold text-ink hover:text-accent-ink [&::-webkit-details-marker]:hidden">
        What the chips mean
        <span aria-hidden className="text-ink-3 transition-transform group-open:rotate-180">▾</span>
      </summary>
      <div className="px-4 sm:px-5 pb-5 grid gap-6 lg:grid-cols-3">
        <KeyList level={headingLevel} title="Facts"
                 items={FACTS.map((f) => ({ chip: <Chip kind={f.kind} label={f.label} />, text: f.text }))} />
        <KeyList level={headingLevel} title="Tags (seat rules, at most 2 per row)"
                 items={TAGS.map((t) => ({ chip: <Chip kind="tag" label={t.label} />, text: t.hint }))} />
        <KeyList level={headingLevel} title="Why a seat isn't scored"
                 items={REASONS.map((r) => ({ chip: <Chip kind="reason" label={r.label} />, text: r.text }))} />
      </div>
    </details>
  );
}

function KeyList({ title, items, level }: { title: string; items: { chip: ReactNode; text: ReactNode }[]; level: 2 | 3 }) {
  const H = level === 2 ? "h2" : "h3";
  return (
    <div>
      <H className="text-[11px] leading-[14px] uppercase font-semibold tracking-[0.08em] text-ink-3 mb-3">{title}</H>
      <dl className="space-y-3">
        {items.map((it, i) => (
          <div key={i}>
            <dt>{it.chip}</dt>
            <dd className="mt-1 text-[13px] leading-5 text-ink-2">{it.text}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
