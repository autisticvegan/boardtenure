import type { Metadata } from "next";
import { hundred } from "@/components/hiw/hundred";
import { compactMoney } from "@/lib/format";
import { getFailingUp } from "@/lib/queries-hiw";

export const metadata: Metadata = { title: "Failing up" };
export const revalidate = 3600;

export default async function FailingUp() {
  const cases = await getFailingUp();
  return (
    <div className="space-y-8">
      <header className="max-w-[820px] space-y-3">
        <h1 className="text-[36px] leading-[40px] sm:text-[48px] sm:leading-[52px] font-extrabold tracking-[-0.03em] text-ink">Failing up</h1>
        <p className="text-[16px] leading-7 text-ink-2">
          Executives who left a public company after its own filings showed shareholders losing at least 40%, or
          trailing the company&apos;s chosen comparison by at least 50 points, during their time there, and who were
          then hired as an executive by another public company.
        </p>
        <p className="text-[12px] leading-4 text-ink-3">
          Each window is a table from the first company&apos;s own 10-K or proxy that starts and ends inside the person&apos;s
          tenure; a case was dropped if any other in-tenure table showed the stock doing better. A strict, short list:
          candidates with ambiguous windows were left out.
        </p>
      </header>
      <ol className="space-y-4">
        {cases.map((c) => (
          <li key={c.id} className="rounded-[14px] border border-line bg-surface shadow-card overflow-hidden">
            <div className="grid md:grid-cols-[1fr_auto_1fr]">
              <div className="px-5 py-4">
                <div className="text-[11px] leading-[14px] uppercase tracking-[0.08em] text-ink-3">Before · {c.from_company}</div>
                <div className="mt-1 text-[18px] leading-6 font-semibold text-ink">{c.person_name}</div>
                <div className="text-[12px] leading-4 text-ink-3">{c.from_role} · {c.from_start}–{c.from_end}</div>
                <div className="mt-3 flex items-baseline gap-3">
                  <span className="text-[28px] leading-[32px] font-extrabold text-loss-ink num">{hundred(c.from_value_of_100)}</span>
                  <span className="text-[12px] leading-4 text-ink-3">
                    from $100, {c.period_start?.slice(0, 7)} to {c.period_end?.slice(0, 7)}<br />
                    {c.comparison_name}: {hundred(c.comparison_value_of_100)}
                  </span>
                </div>
                {c.exit_pay_total != null && (
                  <div className="mt-2 text-[13px] leading-5 text-ink-2">Left with <strong className="text-accent-ink">{compactMoney(c.exit_pay_total)}</strong></div>
                )}
              </div>
              <div aria-hidden className="hidden md:grid place-items-center px-2 text-[28px] text-accent-ink">→</div>
              <div className="px-5 py-4 border-t md:border-t-0 md:border-l border-line bg-surface-2">
                <div className="text-[11px] leading-[14px] uppercase tracking-[0.08em] text-ink-3">Next · {c.to_company}</div>
                <div className="mt-1 text-[15px] leading-6 font-semibold text-ink">{c.to_role}</div>
                <div className="text-[12px] leading-4 text-ink-3">from {c.to_start}</div>
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1">
                  {c.pay.map((p) => (
                    <div key={p.fiscal_year}>
                      <div className="text-[24px] leading-[28px] font-extrabold text-accent-ink num">{compactMoney(p.total)}</div>
                      <div className="text-[12px] leading-4 text-ink-3">paid, FY{p.fiscal_year}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <p className="px-5 py-2 border-t border-line text-[12px] leading-4 text-ink-3">
              {c.exit_description && <>How they left, per the filings: {c.exit_description}. </>}
              Sources:{" "}
              {c.source_urls.map((u, i) => (
                <a key={u} href={u} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-ink-2 mr-2">{i + 1}</a>
              ))}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}
