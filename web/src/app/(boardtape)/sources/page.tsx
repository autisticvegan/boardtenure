import type { Metadata } from "next";

export const metadata: Metadata = { title: "Sources & attribution" };

export default function SourcesPage() {
  return (
    <article className="doc max-w-3xl">
      <h1>Sources &amp; attribution</h1>
      <h2>Board membership</h2>
      <p>
        Board seats, dates and roles come from filings on the U.S. Securities and Exchange Commission&rsquo;s EDGAR
        system: proxy statements (DEF 14A), current reports (8-K, Items 5.02 and 5.07), registration statements, annual
        reports, and insider ownership reports (Forms 3, 4 and 5). Each fact links to the filing it came from, with the
        supporting passage quoted and machine-checked against the document.
      </p>
      <h2>Stock prices</h2>
      <p>
        Daily closing prices and corporate actions (splits and dividends) are used to compute total returns. The
        benchmark is the SPDR S&amp;P 500 ETF Trust (SPY) total return, used as a proxy for the S&amp;P 500. The site
        shows derived returns rather than redistributing raw price histories.
      </p>
      <p>
        <em>Prototype note:</em> the current price data comes from keyless public sources for development only. A
        licensed end-of-day data feed will replace it before public launch (see <code>docs/research/data-sources.md</code>).
      </p>
      <h2>Corrections</h2>
      <p>
        If a date or role is wrong, the cited filing is the place to check first. Every manual correction we make is
        recorded in an audit log with its reason.
      </p>
    </article>
  );
}
