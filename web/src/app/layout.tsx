import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import { AsOf } from "@/components/standings/primitives";
import { SiteHeader } from "@/components/site-header";
import { FOOTER_DISCLAIMER } from "@/lib/copy";
import { getLeaderboardStats } from "@/lib/queries";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const mono = JetBrains_Mono({ variable: "--font-mono-face", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: { default: "Standings: board seats ranked by stock vs the S&P 500 · BoardTenure", template: "%s · BoardTenure" },
  description:
    "How each company's stock did against the S&P 500 while every director held a board seat, ranked. Every date cites an SEC filing.",
};

export const viewport: Viewport = { themeColor: "#0b0d12", colorScheme: "dark" };

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const stats = await getLeaderboardStats("independent");
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body className="min-h-dvh flex flex-col text-[14px] leading-[22px]">
        <SiteHeader />
        <main className="flex-1 w-full max-w-[1240px] mx-auto px-4 sm:px-6 py-6 sm:py-8">{children}</main>
        <footer className="border-t border-line mt-12">
          <div className="max-w-[1240px] mx-auto px-4 sm:px-6 py-8 grid gap-6 sm:grid-cols-[2fr_1fr_1fr] text-[13px] leading-5 text-ink-2">
            <div className="space-y-3 max-w-prose">
              <p className="font-semibold text-ink">BoardTenure</p>
              <p>{FOOTER_DISCLAIMER}</p>
              <p className="text-ink-3 text-[12px] leading-4">
                {stats.data_through && <><AsOf date={stats.data_through} /> · </>}
                {stats.companies} companies tracked · Benchmark: S&amp;P 500 (SPY, dividends reinvested)
              </p>
            </div>
            <div className="space-y-1.5">
              <p className="text-ink-3 text-[11px] leading-[14px] font-semibold uppercase tracking-[0.08em]">Explore</p>
              <p><Link className="hover:text-ink" href="/rankings">Standings</Link></p>
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
      </body>
    </html>
  );
}
