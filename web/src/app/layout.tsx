import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const mono = JetBrains_Mono({ variable: "--font-mono-face", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: { default: "BoardTenure", template: "%s · BoardTenure" },
  description:
    "How public-company stocks performed during each director's board tenure, with sources for every date.",
};

// Runs before first paint so the stored or system theme never flashes.
const themeScript = `(function(){try{var t=localStorage.getItem("theme");if(t!=="light"&&t!=="dark"){t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh flex flex-col text-[14px] leading-relaxed">
        <SiteHeader />
        <main className="flex-1 w-full max-w-[1240px] mx-auto px-4 sm:px-6 py-6 sm:py-8">{children}</main>
        <footer className="border-t border-line mt-12">
          <div className="max-w-[1240px] mx-auto px-4 sm:px-6 py-8 grid gap-6 sm:grid-cols-[2fr_1fr_1fr] text-[13px] text-ink-2">
            <div className="space-y-2 max-w-prose">
              <p className="font-medium text-ink">BoardTenure</p>
              <p>
                Tenure returns describe how a stock performed while a director served. They do not imply that
                any director caused that performance.
              </p>
            </div>
            <div className="space-y-1.5">
              <p className="text-ink-3 text-[12px] uppercase tracking-wide">Data</p>
              <p><Link className="hover:text-ink" href="/methodology">Methodology</Link></p>
              <p><Link className="hover:text-ink" href="/sources">Sources &amp; attribution</Link></p>
            </div>
            <div className="space-y-1.5">
              <p className="text-ink-3 text-[12px] uppercase tracking-wide">About</p>
              <p><Link className="hover:text-ink" href="/terms">Terms of use</Link></p>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
