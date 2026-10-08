import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Metadata } from "next";
import { marked } from "marked";
import { HowItWorks } from "@/components/standings/how-it-works";
import { getLeaderboardStats } from "@/lib/queries";
import { DEFAULT_SCOPE } from "@/lib/standings";

export const metadata: Metadata = { title: "Methodology" };
// How the standings work carries live counts; a day-long cache is fresh enough for daily closes.
export const revalidate = 86400;

// Single source of truth: the repository's docs/methodology.md. Its title and intro stay first;
// "How the standings work" is the first section, ahead of the doc's own sections.
export default async function MethodologyPage() {
  const [raw, stats] = await Promise.all([
    readFile(path.join(process.cwd(), "..", "docs", "methodology.md"), "utf8"),
    getLeaderboardStats(DEFAULT_SCOPE),
  ]);
  // The two ranking formulas, read from the doc's "Rankings" section so the doc stays the one source (§4.6).
  const formula = (label: string, re: RegExp) => {
    const m = raw.match(re);
    return m ? [{ label, code: m[1] }] : [];
  };
  const formulas = [
    ...formula("Per seat: annualized excess", /`(annualized excess = [^`]+)`/),
    ...formula("Per director: time-weighted score", /`(score = [^`]+)`/),
  ];
  const split = raw.search(/^## /m);
  const [intro, rest] = split < 0 ? [raw, ""] : [raw.slice(0, split), raw.slice(split)];
  const [introHtml, restHtml] = await Promise.all([marked.parse(intro), marked.parse(rest)]);
  return (
    <div className="max-w-3xl">
      <article className="doc" dangerouslySetInnerHTML={{ __html: introHtml }} />
      <div className="my-8">
        <HowItWorks stats={stats} scope={DEFAULT_SCOPE} methodologyHref="#full-methodology" methodologyLabel="Full methodology ↓">
          {formulas.length > 0 && (
            <dl className="mt-4 max-w-[680px] space-y-3 text-[13px] leading-5 text-ink-2">
              {formulas.map((f) => (
                <div key={f.label}>
                  <dt className="font-semibold text-ink">{f.label}</dt>
                  <dd className="mt-1"><code className="font-mono text-[12.5px] text-ink [overflow-wrap:anywhere]">{f.code}</code></dd>
                </div>
              ))}
            </dl>
          )}
        </HowItWorks>
      </div>
      <article id="full-methodology" className="doc scroll-mt-20" dangerouslySetInnerHTML={{ __html: restHtml }} />
    </div>
  );
}
