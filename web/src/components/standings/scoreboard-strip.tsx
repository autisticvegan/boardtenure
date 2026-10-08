// Five headline counts for the active scope (§5.2). No tooltips: How the standings work defines them.
import type { ReactNode } from "react";
import type { LeaderboardStats } from "@/lib/queries";
import { Signed } from "./primitives";

function Tile({ value, label, className = "" }: { value: ReactNode; label: string; className?: string }) {
  // dt first for screen readers ("directors ranked: 137"); the value sits on top visually.
  return (
    <div className={`flex flex-col-reverse justify-end min-w-0 bg-surface px-4 py-3 md:px-5 md:py-4 ${className}`}>
      <dt className="mt-0.5 text-[12px] leading-4 text-ink-3">{label}</dt>
      <dd className="text-[24px] leading-[30px] font-bold tracking-[-0.01em] text-ink whitespace-nowrap">{value}</dd>
    </div>
  );
}

export function ScoreboardStrip({ stats }: { stats: LeaderboardStats }) {
  // gap-px over a --line ground draws the 1px dividers in both layouts.
  return (
    <dl className="grid grid-cols-2 md:grid-cols-5 gap-px overflow-hidden rounded-[14px] border border-line bg-line shadow-card">
      <Tile value={stats.ranked_directors} label="directors ranked" />
      <Tile value={stats.scored_seats} label="scored seats" />
      <Tile
        value={<>{stats.directors_beating} <span className="text-[16px] font-semibold text-ink-3">of</span> {stats.ranked_directors}</>}
        label="had stocks that beat the S&P"
      />
      <Tile value={<Signed value={stats.median_score} kind="perYear" />} label="median score" />
      <Tile value={stats.companies} label="companies tracked" className="max-md:col-span-2" />
    </dl>
  );
}
