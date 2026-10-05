import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ReturnChart, type Marker } from "@/components/return-chart";
import { SourceList } from "@/components/source-list";
import { Badge, Card, Confidence, Disclaimer, Stat } from "@/components/ui";
import { fmtDate, money, pct, pp, tenureLength, toneClass } from "@/lib/format";
import { getBoard, getCompany, getDefaultBenchmark, getEvidence, getReturnSeries, type Membership } from "@/lib/queries";
import { END_REASON, primaryRole, roleLabel } from "@/lib/roles";

// Data refreshes weekly (historical focus), so a day-long cache is always fresh enough.
export const revalidate = 86400;

export async function generateMetadata({ params }: PageProps<"/c/[slug]/d/[person]">): Promise<Metadata> {
  const { slug, person } = await params;
  const company = await getCompany(slug);
  const seat = company ? (await getBoard(company.id)).find((m) => m.person_slug === person) : undefined;
  return company && seat ? { title: `${seat.full_name} on the ${company.common_name} board` } : {};
}

function shiftMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + months, Math.min(d, 28)));
  return dt.toISOString().slice(0, 10);
}

export default async function TenurePage({ params }: PageProps<"/c/[slug]/d/[person]">) {
  const { slug, person } = await params;
  const company = await getCompany(slug);
  if (!company) notFound();
  const seats = (await getBoard(company.id)).filter((m) => m.person_slug === person);
  if (seats.length === 0) notFound();
  const bench = await getDefaultBenchmark();
  const evidence = await getEvidence("board_membership", seats.map((s) => s.membership_id));

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 text-[12px] text-ink-3 mb-1.5">
          <Link href={`/c/${company.slug}`} className="hover:text-ink-2">{company.symbol}</Link>
          <span aria-hidden>/</span>
          <span>Board</span>
        </div>
        <h1 className="text-[26px] sm:text-[30px] font-semibold tracking-tight leading-tight">
          {seats[0].full_name}
          <span className="text-ink-3 font-normal"> on the {company.common_name} board</span>
        </h1>
        <p className="mt-1 text-[13px] text-ink-2">
          <Link href={`/d/${person}`} className="text-accent-ink hover:underline">Full board track record →</Link>
        </p>
      </div>
      {await Promise.all(seats.map(async (m) => (
        <Seat key={m.membership_id} m={m} company={company} benchName={bench?.name ?? "S&P 500 (SPY)"}
              benchSecurityId={bench?.security_id ?? null} />
      )))}
      <Card title="Sources">
        <SourceList rows={evidence} />
      </Card>
    </div>
  );
}

async function Seat({ m, company, benchName, benchSecurityId }: {
  m: Membership;
  company: NonNullable<Awaited<ReturnType<typeof getCompany>>>;
  benchName: string;
  benchSecurityId: number | null;
}) {
  const p = m.perf;
  const anchorStart = p?.start_anchor_date ?? company.ipo_date ?? m.start_date;
  const anchorEnd = p?.end_anchor_date ?? company.last_date;
  const from = anchorStart && company.ipo_date
    ? [shiftMonths(anchorStart, -6), company.ipo_date].sort().at(-1)!
    : anchorStart;
  const to = anchorEnd && company.last_date ? [shiftMonths(anchorEnd, 6), company.last_date].sort()[0] : anchorEnd;
  const series = company.security_id && from && to && anchorStart
    ? await getReturnSeries(company.security_id, benchSecurityId, from, to, {
        baseDate: anchorStart, keep: [anchorStart, anchorEnd].filter(Boolean) as string[],
      })
    : [];
  const markers: Marker[] = [];
  if (p?.start_anchor_date) {
    markers.push({ d: p.start_anchor_date, kind: "join", label: p.start_anchor_reason === "first_trade" ? "IPO (joined earlier)" : "Joined" });
  }
  if (p?.end_anchor_date && m.status === "former") markers.push({ d: p.end_anchor_date, kind: "leave", label: "Left" });

  const sym = company.symbol ?? company.common_name;
  const ok = p?.status === "ok";
  const period = `${fmtDate(m.start_date, m.start_precision)} – ${m.status === "current" ? "present" : fmtDate(m.end_date, m.end_precision ?? "unknown")}`;

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-3">
          <Badge tone={m.status === "current" ? "accent" : "neutral"}>{m.status === "current" ? "Current director" : "Former director"}</Badge>
          <span>{primaryRole(m, m.status === "current")}</span>
          <span aria-hidden>·</span>
          <span className="num">{period}</span>
          <span aria-hidden>·</span>
          <span>{tenureLength(m.start_date, m.end_date, m.start_precision)}</span>
          <span className="ml-auto"><Confidence level={m.confidence} /></span>
        </div>
        <p className="mt-3 text-[15px] leading-relaxed text-ink max-w-3xl">
          <Summary m={m} company={company.common_name} sym={sym} benchName={benchName} />
        </p>
        {ok && (
          <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-6 gap-y-5">
            <Stat label={`${sym} total return`} value={pct(p.total_return)} valueClass={toneClass(p.total_return)} />
            <Stat label={benchName} value={pct(p.bench_total_return)} valueClass={toneClass(p.bench_total_return)} />
            <Stat label="Relative" value={pp(p.relative_return_pp)} valueClass={toneClass(p.relative_return_pp)} sub="percentage points" />
            <Stat label="Annualized" value={pct(p.annualized_return)} valueClass={toneClass(p.annualized_return)}
                  sub={p.annualized_return == null ? "under one year" : `${benchName} ${pct(p.bench_annualized_return)}`} />
            <Stat label="Max drawdown" value={pct(p.max_drawdown)} valueClass="text-neg"
                  sub={p.mdd_peak_date ? `${fmtDate(p.mdd_peak_date)} → ${fmtDate(p.mdd_trough_date)}` : undefined} />
            <Stat label="Price at start → end" value={<span className="text-[18px]">{money(p.start_close)} → {money(p.end_close)}</span>}
                  sub="unadjusted closes" />
          </div>
        )}
      </Card>

      {series.length > 1 && (
        <Card title="Stock performance during tenure">
          <ReturnChart
            points={series}
            stockLabel={sym}
            benchLabel={benchName}
            band={p?.start_anchor_date ? { from: p.start_anchor_date, to: p.end_anchor_date ?? series.at(-1)!.d } : undefined}
            markers={markers}
            height={340}
            baseCaption={p?.start_anchor_date ? `Rebased to 0% at the ${fmtDate(p.start_anchor_date)} close` : undefined}
          />
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="How this was measured">
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[13px]">
            <dt className="text-ink-3">Joined</dt>
            <dd>{fmtDate(m.start_date, m.start_precision)} <span className="text-ink-3">· {m.start_basis ?? "basis not recorded"}</span></dd>
            {m.status === "former" && <>
              <dt className="text-ink-3">Left</dt>
              <dd>{fmtDate(m.end_date, m.end_precision ?? "unknown")}{m.end_reason && <span className="text-ink-3"> · {END_REASON[m.end_reason]}</span>}</dd>
            </>}
            <dt className="text-ink-3">Start anchor</dt>
            <dd className="num">{p?.start_anchor_date ? `${fmtDate(p.start_anchor_date)} close ${money(p.start_close)}` : "—"}
              <span className="text-ink-3"> · {anchorNote(p?.start_anchor_reason)}</span></dd>
            <dt className="text-ink-3">End anchor</dt>
            <dd className="num">{p?.end_anchor_date ? `${fmtDate(p.end_anchor_date)} close ${money(p.end_close)}` : "—"}
              <span className="text-ink-3"> · {anchorNote(p?.end_anchor_reason)}</span></dd>
            <dt className="text-ink-3">Trading days</dt>
            <dd className="num">{p?.trading_days ?? "—"}</dd>
            <dt className="text-ink-3">Returns</dt>
            <dd>Total return with dividends reinvested, for both the stock and SPY</dd>
            <dt className="text-ink-3">Method</dt>
            <dd><Link href="/methodology" className="text-accent-ink hover:underline">v{p?.methodology_version ?? "—"}</Link>
              <span className="text-ink-3"> · prices through {fmtDate(p?.data_through)}</span></dd>
          </dl>
        </Card>
        <Card title="Roles & committees">
          {m.roles.length === 0 && m.committees.length === 0 && <p className="text-[13px] text-ink-3">No leadership roles or committee assignments recorded.</p>}
          {m.roles.length > 0 && (
            <ul className="space-y-1.5 text-[13px] mb-3">
              {m.roles.map((r, i) => (
                <li key={i} className="flex justify-between gap-4">
                  <span>{roleLabel(r)}</span>
                  <span className="text-ink-3 num">{fmtDate(r.start_date, r.start_precision)} – {r.is_current ? "present" : fmtDate(r.end_date, r.end_precision ?? "unknown")}</span>
                </li>
              ))}
            </ul>
          )}
          {m.committees.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {m.committees.map((c) => (
                <Badge key={c.committee}>{c.committee.replace(/_/g, " ")}{c.role === "chair" ? " (chair)" : ""}</Badge>
              ))}
              <span className="text-[12px] text-ink-3 self-center">per latest proxy statement</span>
            </div>
          )}
        </Card>
      </div>
      <Disclaimer />
    </div>
  );
}

function anchorNote(reason: string | null | undefined): string {
  switch (reason) {
    case "join_date": return "last close on or before the join date";
    case "first_trade": return "joined before listing; first trading day";
    case "join_window": return "join date known only to a window";
    case "leave_date": return "last close on or before the departure date";
    case "latest_close": return "latest available close (still serving)";
    case "last_trade": return "last trading day";
    case "leave_window": return "departure known only to a window";
    default: return "not measurable";
  }
}

function Summary({ m, company, sym, benchName }: { m: Membership; company: string; sym: string; benchName: string }) {
  const p = m.perf;
  const name = m.full_name;
  if (!p) return <>Performance has not been computed for this tenure yet.</>;
  if (p.status === "no_price_history") return <>{name} left the board before {company} stock began trading, so there is no tenure return to measure.</>;
  if (p.status === "unknown_dates") return <>We have not established when {name} joined{m.status === "former" ? " or left" : ""} the board, so no return is shown.</>;
  if (p.status === "history_gap") return <>{name} joined before the earliest {sym} price history we hold, so the tenure return can&rsquo;t be measured yet.</>;
  if (p.status === "too_short") return <>{name}&rsquo;s tenure spans less than one full trading session; no return is shown.</>;
  if (p.status === "approximate") {
    return <>Because a tenure date is known only to the {m.start_precision === "day" ? "month or year" : m.start_precision}, {sym}&rsquo;s return during {name}&rsquo;s tenure is shown as a range: between <b className="num">{pct(p.return_low)}</b> and <b className="num">{pct(p.return_high)}</b>.</>;
  }
  const since = p.start_anchor_reason === "first_trade" ? `since its IPO (${name} joined before listing)` : `during ${name}’s tenure`;
  const verb = m.status === "current" ? "has returned" : "returned";
  const rel = p.relative_return_pp;
  return (
    <>
      {company} {verb} <b className={`num ${toneClass(p.total_return)}`}>{pct(p.total_return)}</b> {since}
      {p.bench_total_return != null && rel != null && (
        <>, compared with <b className="num">{pct(p.bench_total_return)}</b> for the {benchName}. It {m.status === "current" ? "has " : ""}
          {rel >= 0 ? "outperformed" : "underperformed"} the index by <b className="num">{Math.abs(rel * 100).toFixed(1)} percentage points</b> over the same period</>
      )}.
    </>
  );
}
