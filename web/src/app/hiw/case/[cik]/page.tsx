import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ceoNames, companyLabel } from "@/components/hiw/case-card";
import { CompanySearch } from "@/components/hiw/company-search";
import { HundredBar, hundred } from "@/components/hiw/hundred";
import { Logo } from "@/components/logo";
import { compactMoney } from "@/lib/format";
import {
  fig, getAllChutes, getCompanyPayChanges, getCompanyPayRatio, getExecutiveSales, getFailingUp, getHiwCases,
  getHubIdentity, getPanelYears, getScreenCase,
} from "@/lib/queries-hiw";
import { caughtUpAt, ratioLabel } from "@/lib/ratio";

export const revalidate = 3600;

const signed = (x: number, d = 0) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x * 100).toFixed(d)}%`;

export async function generateMetadata({ params }: PageProps<"/hiw/case/[cik]">): Promise<Metadata> {
  const cik = Number((await params).cik);
  const who = Number.isInteger(cik) ? await getHubIdentity(cik) : null;
  return who ? { title: `${companyLabel({ entity_name: who.name, tickers: who.tickers }).name}: pay vs shareholders` } : {};
}

export default async function CompanyPage({ params }: PageProps<"/hiw/case/[cik]">) {
  const cik = Number((await params).cik);
  if (!Number.isInteger(cik) || cik <= 0) notFound();
  const who = await getHubIdentity(cik);
  if (!who) notFound();
  const [screen, panel, ratio, changes, chutes, hellos, layoffs, failing, sales] = await Promise.all([
    getScreenCase(cik), getPanelYears(cik), getCompanyPayRatio(cik), getCompanyPayChanges(cik), getAllChutes(),
    getHiwCases("golden_hello"), getHiwCases("layoffs"), getFailingUp(), getExecutiveSales(),
  ]);
  const { name, ticker } = companyLabel({ entity_name: who.name, tickers: who.tickers });
  const held = who.implausible === true;
  const years = held ? [] : panel.years;
  const myChutes = chutes.filter((c) => c.cik === cik && (c.total ?? 0) > 0);
  const myHellos = hellos.filter((c) => c.cik === cik);
  const myLayoffs = layoffs.filter((c) => c.cik === cik);
  const myFailing = failing.filter((f) => f.from_cik === cik || f.to_cik === cik);
  const mySales = sales.filter((s) => Number(s.company_cik) === cik);

  const sct = years.reduce((a, y) => a + y.peos.reduce((b, p) => b + (p.sct ?? 0), 0), 0);
  const cap = years.reduce((a, y) => a + y.peos.reduce((b, p) => b + (p.cap ?? 0), 0), 0);
  const last = years.at(-1);
  const ceos = [...new Set(years.flatMap((y) => y.peos.map((p) => p.name).filter((n): n is string => !!n)))];
  const anything = years.length || ratio || changes.length || myChutes.length || myHellos.length || myLayoffs.length
    || myFailing.length || mySales.length;

  return (
    <div className="space-y-10 max-w-[1000px]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Breadcrumb" className="text-[12px] leading-4 text-ink-3">
          <Link href="/" className="hover:text-ink-2">Heads I Win</Link> / {ticker ?? name}
        </nav>
        <div className="w-full sm:w-auto lg:hidden"><CompanySearch compact placeholder="Look up another company…" /></div>
      </div>

      <header className="flex items-center gap-4">
        <Logo cik={cik} size={56} />
        <div className="min-w-0">
          <h1 className="text-[32px] leading-[38px] sm:text-[44px] sm:leading-[48px] font-extrabold tracking-[-0.03em] text-ink">{name}</h1>
          <p className="mt-1 text-[14px] leading-5 text-ink-3">
            {who.tickers ?? "—"}{ceos.length > 0 && <> · CEO{ceos.length > 1 ? "s" : ""} in the table: {ceoNames(ceos)}</>}
          </p>
        </div>
      </header>

      {held && (
        <p className="rounded-[14px] border border-warn/40 bg-warn-wash px-5 py-4 text-[14px] leading-6 text-ink">
          This company&apos;s tagged pay figures look like a scale error (for example, dollars tagged as thousands), so its
          pay table is held out until checked by hand.
        </p>
      )}

      {years.length > 0 && last && (
        <section aria-labelledby="pvp" className="space-y-4">
          <H id="pvp" kicker="Pay vs shareholders" title={`${years[0].period_end.slice(0, 4)}–${last.period_end.slice(0, 4)}, from its own proxy`} />
          <div className="grid gap-4 sm:grid-cols-3">
            <Big value={compactMoney(sct)} label={ceos.length > 1 ? "reported CEO pay over these years, every CEO combined" : "reported CEO pay over these years"} />
            <Big value={cap < 0 ? `−${compactMoney(-cap)}` : compactMoney(cap)} label="CEO pay “actually paid” (stock awards at year-end value)" />
            <Big value={hundred(last.tsr)} label="what $100 invested at the start was worth at the end" tone={(last.tsr ?? 100) < 100 ? "loss" : "gain"} />
          </div>
          {last.tsr != null && (
            <div className="rounded-[14px] border border-line bg-surface px-5 py-4 shadow-card space-y-2">
              <HundredBar value={last.tsr} peer={last.peer_tsr} />
              <p className="text-[12px] leading-4 text-ink-3">
                Bar: this company&apos;s $100; tick: the $100 start{last.peer_tsr != null && <>; grey mark: the peer group the company chose ({hundred(last.peer_tsr)})</>}.
              </p>
            </div>
          )}
          <div className="relative overflow-x-auto rounded-[14px] border border-line bg-surface shadow-card" role="region" aria-label="Year by year" tabIndex={0}>
            <table className="w-full min-w-[640px] text-[13px] leading-5">
              <caption className="sr-only">CEO pay and shareholder return by fiscal year, as filed.</caption>
              <thead className="text-[12px] leading-4 text-ink-3 text-left">
                <tr className="border-b border-line">
                  <th scope="col" className="font-medium px-4 py-3">Fiscal year ending</th>
                  {ceos.length > 0 && <th scope="col" className="font-medium px-3 py-3">CEO</th>}
                  <th scope="col" className="font-medium px-3 py-3 text-right">Reported pay</th>
                  <th scope="col" className="font-medium px-3 py-3 text-right">Actually paid</th>
                  <th scope="col" className="font-medium px-4 py-3 text-right">$100 became</th>
                </tr>
              </thead>
              <tbody>
                {years.map((y) => (
                  <tr key={y.period_end} className="border-b border-line last:border-0 align-top">
                    <th scope="row" className="font-normal text-left px-4 py-2.5">{y.period_end}</th>
                    {ceos.length > 0 && <td className="px-3 py-2.5 text-ink-2">{y.peos.map((p) => p.name ?? "—").join(" · ") || "—"}</td>}
                    <td className="px-3 py-2.5 text-right num text-ink">{y.peos.map((p) => compactMoney(p.sct)).join(" · ") || "—"}</td>
                    <td className="px-3 py-2.5 text-right num text-ink">
                      {y.peos.map((p) => (p.cap != null && p.cap < 0 ? `−${compactMoney(-p.cap)}` : compactMoney(p.cap))).join(" · ") || "—"}
                    </td>
                    <td className={`px-4 py-2.5 text-right num font-semibold ${(y.tsr ?? 100) < 100 ? "text-loss-ink" : "text-gain-ink"}`}>{hundred(y.tsr)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[12px] leading-4 text-ink-3">
            Read from the filing&apos;s own tagged table{screen ? ", and every figure checked against it" : ""}. Years with two
            CEOs show both.{" "}
            {panel.doc_url && <a href={panel.doc_url} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-ink-2">Read the proxy</a>}
          </p>
        </section>
      )}

      {ratio && (
        <section aria-labelledby="ratio" className="space-y-3">
          <H id="ratio" kicker="The ratio" title={`The CEO made ${ratioLabel(ratio.ratio)} the median worker`} />
          <div className="grid gap-4 sm:grid-cols-3">
            <Big value={compactMoney(ratio.ceo_pay)} label={`CEO pay${ratio.fiscal_year ? `, ${ratio.fiscal_year}` : ""}`} />
            <Big value={compactMoney(ratio.median_pay)} label="the median employee's pay" />
            <Big value={caughtUpAt(ratio.ratio)} label="when the CEO had earned the worker's whole year (if pay arrived evenly)" small />
          </div>
          <blockquote className="border-l-2 border-accent/60 pl-4 text-[13px] leading-5 text-ink-2">
            &ldquo;{ratio.quote}&rdquo; <a href={ratio.doc_url} target="_blank" rel="noreferrer" className="underline underline-offset-2 text-ink-3 hover:text-ink-2">source</a>
          </blockquote>
        </section>
      )}

      {changes.length > 0 && (
        <section aria-labelledby="changes" className="space-y-3">
          <H id="changes" kicker="Year to year" title="The same CEO's pay, against the stock that year" />
          <ul className="grid gap-2 sm:grid-cols-2">
            {changes.map((c) => {
              const up = c.sct > c.sct_prev;
              return (
                <li key={c.fiscal_year} className="rounded-[12px] border border-line bg-surface px-4 py-3">
                  <div className="text-[11px] leading-4 uppercase tracking-[0.08em] text-ink-3">FY{c.fiscal_year} · {c.peo_name}</div>
                  <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3 text-[14px] leading-5">
                    <span>Stock <span className={`num font-bold ${c.ret < 0 ? "text-loss-ink" : "text-gain-ink"}`}>{signed(c.ret)}</span></span>
                    <span className="num text-ink-2">{compactMoney(c.sct_prev)} → <span className={`font-bold ${up ? "text-accent-ink" : "text-ink"}`}>{compactMoney(c.sct)}</span></span>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {(myHellos.length > 0 || myChutes.length > 0 || myLayoffs.length > 0 || myFailing.length > 0 || mySales.length > 0) && (
        <section aria-labelledby="also" className="space-y-3">
          <H id="also" kicker="Also on this site" title="Every other entry for this company" />
          <ul className="grid gap-3 sm:grid-cols-2">
            {myHellos.map((c) => (
              <Entry key={c.id} href="/hellos" emoji="👋" kicker={`Golden hello · ${c.event_date?.slice(0, 7) ?? ""}`}
                     title={c.person_name ?? ""} value={compactMoney(fig(c, "sign_on_total")?.value
                       ?? c.figures.filter((f) => ["sign_on_cash", "make_whole_equity", "sign_on_equity", "other_perks"].includes(f.key)).reduce((a, f) => a + f.value, 0))}
                     sub="handed over for joining" />
            ))}
            {myChutes.map((c) => (
              <Entry key={c.key} href="/parachutes" emoji="🪂" kicker={`Golden parachute · ${c.exit_date?.slice(0, 4) ?? ""}`}
                     title={c.person} value={compactMoney(c.total)} sub={c.basis === "estimated" ? "estimated in the filing" : "on the way out"} />
            ))}
            {myLayoffs.map((c) => (
              <Entry key={c.id} href="/layoffs" emoji="✂️" kicker={`Layoffs · ${c.event_date?.slice(0, 7) ?? ""}`}
                     title={fig(c, "jobs_cut") ? `${Math.round(fig(c, "jobs_cut")!.value).toLocaleString("en-US")} ${fig(c, "jobs_cut")!.label}` : `${fig(c, "pct_workforce")?.value}% ${fig(c, "pct_workforce")?.label ?? ""}`}
                     value={compactMoney(fig(c, "ceo_pay")?.value)} sub={`paid to ${c.person_name ?? "the CEO"} that year`} />
            ))}
            {myFailing.map((f) => (
              <Entry key={f.id} href="/failing-up" emoji="🪜" kicker={f.from_cik === cik ? `Failing up · left for ${f.to_company}` : `Failing up · came from ${f.from_company}`}
                     title={f.person_name} value={hundred(f.from_value_of_100)} sub={`${f.from_company}'s $100, vs ${hundred(f.comparison_value_of_100)} for ${f.comparison_name}`} />
            ))}
            {mySales.map((s) => (
              <Entry key={`${s.full_name}-${s.window_start}`} href="/sold" emoji="🏦" kicker="What they sold"
                     title={s.full_name} value={compactMoney(s.proceeds)} sub="of stock sold while in office" />
            ))}
          </ul>
        </section>
      )}

      {!anything && (
        <p className="text-[15px] leading-6 text-ink-2">
          We know this company, but none of its filings we&apos;ve read has a pay table or case to show yet.
        </p>
      )}

      <p className="text-[12px] leading-4 text-ink-3 max-w-[80ch]">
        Everything here is from the company&apos;s own SEC filings. These are facts about pay and stock; they don&apos;t
        say what any one person caused. <Link href="/about" className="underline underline-offset-2 hover:text-ink-2">How we know</Link>
      </p>
    </div>
  );
}

function H({ id, kicker, title }: { id: string; kicker: string; title: string }) {
  return (
    <div>
      <div className="text-[12px] font-bold uppercase tracking-[0.16em] text-accent-ink">{kicker}</div>
      <h2 id={id} className="mt-1 text-[22px] leading-7 sm:text-[26px] sm:leading-8 font-extrabold tracking-[-0.02em] text-ink">{title}</h2>
    </div>
  );
}

function Big({ value, label, tone, small }: { value: string; label: string; tone?: "loss" | "gain"; small?: boolean }) {
  return (
    <div className="rounded-[14px] border border-line bg-surface px-5 py-4 shadow-card">
      <div className={`${small ? "text-[22px] leading-[30px]" : "text-[32px] leading-[36px]"} font-extrabold num ${tone === "loss" ? "text-loss-ink" : tone === "gain" ? "text-gain-ink" : "text-accent-ink"}`}>{value}</div>
      <div className="mt-1 text-[12px] leading-4 text-ink-3">{label}</div>
    </div>
  );
}

function Entry({ href, emoji, kicker, title, value, sub }: { href: string; emoji: string; kicker: string; title: string; value: ReactNode; sub: string }) {
  return (
    <li>
      <Link href={href} className="group flex h-full items-start gap-3 rounded-[14px] border border-line bg-surface px-4 py-3 hover:border-accent/60">
        <span aria-hidden className="text-[24px] leading-8">{emoji}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] leading-4 uppercase tracking-[0.08em] text-ink-3 truncate">{kicker}</span>
          <span className="block text-[15px] leading-6 font-bold text-ink group-hover:text-accent-ink truncate">{title}</span>
          <span className="block text-[12px] leading-4 text-ink-3">{sub}</span>
        </span>
        <span className="text-[18px] font-black text-accent-ink num whitespace-nowrap">{value}</span>
      </Link>
    </li>
  );
}
