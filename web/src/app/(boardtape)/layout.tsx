import type { Metadata } from "next";
import Link from "next/link";
import { AsOf } from "@/components/standings/primitives";
import { SiteHeader } from "@/components/site-header";
import { FOOTER_DISCLAIMER } from "@/lib/copy";
import { getLeaderboardStats } from "@/lib/queries";

export const metadata: Metadata = {
  title: { default: "Standings: board seats ranked by stock vs the S&P 500 · Boardtape", template: "%s · Boardtape" },
  description:
    "How each company's stock did against the S&P 500 while every director held a board seat, ranked. Every date cites an SEC filing.",
};

export default async function BoardtapeLayout({ children }: { children: React.ReactNode }) {
  const stats = await getLeaderboardStats("independent");
  return (
    <>
      <a href="#main"
         className="sr-only focus:not-sr-only focus:fixed focus:z-50 focus:left-4 focus:top-[calc(env(safe-area-inset-top,0px)+8px)] focus:rounded-lg focus:bg-surface-3 focus:px-4 focus:py-2.5 focus:text-[13px] focus:font-semibold focus:text-ink">
        Skip to content
      </a>
      <SiteHeader />
      <main id="main" tabIndex={-1} className="flex-1 w-full max-w-[1240px] mx-auto px-4 sm:px-6 py-6 sm:py-8 focus:outline-none">
        {children}
      </main>
      <footer className="border-t border-line mt-12">
        <div className="max-w-[1240px] mx-auto px-4 sm:px-6 py-8 grid gap-6 sm:grid-cols-[2fr_1fr_1fr] text-[13px] leading-5 text-ink-2">
          <div className="space-y-3 max-w-prose">
            <p className="font-semibold text-ink">Boardtape</p>
            <p>{FOOTER_DISCLAIMER}</p>
            <p className="text-ink-3 text-[12px] leading-4">
              {stats.data_through && <><AsOf date={stats.data_through} /> · </>}
              {stats.companies} companies tracked · Benchmark: S&amp;P 500 (SPY, dividends reinvested)
            </p>
          </div>
          <div className="space-y-1.5">
            <p className="text-ink-3 text-[11px] leading-[14px] font-semibold uppercase tracking-[0.08em]">Explore</p>
            <p><Link className="hover:text-ink" href="/rankings">Standings</Link></p>
            <p><Link className="hover:text-ink" href="/pay">Executive pay</Link></p>
            <p><Link className="hover:text-ink" href="/companies">Companies</Link></p>
            <p><Link className="hover:text-ink" href="/methodology">Methodology</Link></p>
          </div>
          <div className="space-y-1.5">
            <p className="text-ink-3 text-[11px] leading-[14px] font-semibold uppercase tracking-[0.08em]">About</p>
            <p><Link className="hover:text-ink" href="/sources">Sources &amp; attribution</Link></p>
            <p><Link className="hover:text-ink" href="/terms">Terms of use</Link></p>
          </div>
        </div>
      </footer>
    </>
  );
}
