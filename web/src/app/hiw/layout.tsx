import type { Metadata } from "next";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { GreedFX } from "@/components/hiw/greed-fx";

export const metadata: Metadata = {
  title: { default: "Heads I Win: executive pay when shareholders lose", template: "%s · Heads I Win" },
  description: "Executive pay at US public companies, set against what shareholders got. Every figure is from the company's own SEC filings.",
};

// Same dark system as Boardtape; gold replaces violet as the chrome accent.
const THEME = {
  "--accent": "#f5c542",
  "--accent-ink": "#ffd666",
  "--accent-wash": "rgba(245, 197, 66, 0.14)",
} as CSSProperties;

const NAV = [
  ["/paid-anyway", "Paid anyway"],
  ["/heads-i-win", "Heads I win"],
  ["/raise", "The raise"],
  ["/ratio", "The ratio"],
  ["/sold", "What they sold"],
  ["/hellos", "Golden hellos"],
  ["/parachutes", "Golden parachutes"],
  ["/layoffs", "Layoffs"],
  ["/failing-up", "Failing up"],
  ["/about", "How we know"],
] as const;

export default function HiwLayout({ children }: { children: ReactNode }) {
  return (
    <div style={THEME} className="flex-1 flex flex-col">
      <GreedFX />
      <a href="#main"
         className="sr-only focus:not-sr-only focus:fixed focus:z-50 focus:left-4 focus:top-4 focus:rounded-lg focus:bg-surface-3 focus:px-4 focus:py-2.5 focus:text-[13px] focus:font-semibold focus:text-ink">
        Skip to content
      </a>
      <header className="sticky z-30 border-b border-line bg-bg/85 backdrop-blur" style={{ top: "env(safe-area-inset-top, 0px)" }}>
        <div className="max-w-[1240px] mx-auto px-4 sm:px-6 min-h-14 py-2 flex flex-wrap items-center gap-x-6 gap-y-1">
          <Link href="/" className="inline-flex items-center gap-2 max-md:min-h-11 font-extrabold tracking-tight text-[16px] text-ink">
            <span aria-hidden className="inline-grid place-items-center h-7 w-7 rounded-full bg-accent text-ink-on-mark text-[13px] font-black">$</span>
            Heads I Win
          </Link>
          <nav aria-label="Sections"
               className="flex items-center gap-x-5 text-[13px] text-ink-2 whitespace-nowrap max-md:w-full max-md:overflow-x-auto max-md:-mx-4 max-md:px-4 md:flex-wrap md:gap-y-1">
            {NAV.map(([href, label]) => (
              <Link key={href} href={href} className="inline-flex items-center max-md:min-h-11 hover:text-accent-ink">{label}</Link>
            ))}
          </nav>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="flex-1 w-full max-w-[1240px] mx-auto px-4 sm:px-6 py-6 sm:py-10 focus:outline-none">
        {children}
      </main>
      <footer className="border-t border-line mt-12">
        <div className="max-w-[1240px] mx-auto px-4 sm:px-6 py-8 text-[12px] leading-5 text-ink-3 space-y-2 max-w-prose">
          <p className="text-ink-2 font-semibold">Heads I Win</p>
          <p>Every figure comes from a company&apos;s own SEC filings, linked on each page. Stock figures describe what
            shareholders got while a person was paid; they don&apos;t say what that person caused. Commentary, not
            investment advice.</p>
          <p><Link href="/about" className="underline underline-offset-2 hover:text-ink-2">How we know</Link></p>
        </div>
      </footer>
    </div>
  );
}
