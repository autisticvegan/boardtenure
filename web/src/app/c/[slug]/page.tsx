import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BoardTimeline, type TimelineRow } from "@/components/board-timeline";
import { ReturnChart, type Marker } from "@/components/return-chart";
import { Annualized, Badge, Card, Confidence, Disclaimer, Relative, Stat, TenureReturn } from "@/components/ui";
import { daysBetween, fmtDate, money, pct, tenureLength, todayIso, toneClass, years } from "@/lib/format";
import {
  getBoard, getBoardEvents, getCompany, getCoverage, getDefaultBenchmark, getReturnSeries, type Membership,
} from "@/lib/queries";
import { END_REASON, primaryRole, shortTag } from "@/lib/roles";
import { median } from "@/lib/track-record";

export const revalidate = 3600;

export async function generateMetadata({ params }: PageProps<"/c/[slug]">): Promise<Metadata> {
  const c = await getCompany((await params).slug);
  return c ? { title: `${c.common_name} (${c.symbol}) board & director tenure returns` } : {};
}

/** Midpoint of an imprecise start, for tenure averages only. */
function approxStart(m: Membership): string | null {
  if (!m.start_date) return null;
  if (m.start_precision === "year") return `${m.start_date.slice(0, 4)}-07-01`;
  if (m.start_precision === "month") return `${m.start_date.slice(0, 7)}-15`;
  return m.start_date;
}

export default async function CompanyPage({ params }: PageProps<"/c/[slug]">) {
  const { slug } = await params;
  const company = await getCompany(slug);
  if (!company) notFound();

  const [board, events, coverage, bench] = await Promise.all([
    getBoard(company.id), getBoardEvents(company.id), getCoverage(company.id), getDefaultBenchmark(),
  ]);
  const current = board.filter((m) => m.status === "current");
  const former = board
    .filter((m) => m.status === "former")
    .sort((a, b) => (b.end_date ?? "").localeCompare(a.end_date ?? ""));
  const asOf = company.last_date ?? todayIso();
  const series = company.security_id && company.ipo_date
    ? await getReturnSeries(company.security_id, bench?.security_id ?? null, company.ipo_date, asOf)
    : [];

  const tenures = current.map(approxStart).filter((d): d is string => d != null).map((d) => daysBetween(d, todayIso()));
  const avgTenure = tenures.length ? tenures.reduce((a, b) => a + b, 0) / tenures.length : null;
  const anyImprecise = current.some((m) => m.start_precision !== "day");
  const dayChange = company.last_close && company.prev_close ? company.last_close / company.prev_close - 1 : null;
  const sinceIpo = series.length ? series[series.length - 1] : null;
  const twoYearsAgo = `${Number(todayIso().slice(0, 4)) - 2}${todayIso().slice(4)}`;
  const recentJoins = board.filter((m) => m.start_precision === "day" && m.start_date && m.start_date >= twoYearsAgo);
  const recentLeaves = former.filter((m) => m.end_date && m.end_date >= twoYearsAgo);

  const markers: Marker[] = company.ipo_date ? [{ d: company.ipo_date, label: "IPO", kind: "ipo" }] : [];
  const timeline: TimelineRow[] = [...board]
    .sort((a, b) => (a.start_date ?? "9999").localeCompare(b.start_date ?? "9999"))
    .map((m) => ({
      key: String(m.membership_id),
      href: `/c/${company.slug}/d/${m.person_slug}`,
      name: m.full_name,
      status: m.status,
      start_date: m.start_date,
      start_precision: m.start_precision,
      end_date: m.end_date,
      end_precision: m.end_precision,
      tag: shortTag(m),
    }));
  const currentCoverage = coverage.find((c) => c.scope === "current_board");
  const historyCoverage = coverage.filter((c) => c.scope === "board_history");

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[12px] text-ink-3 mb-1.5">
            <Link href="/companies" className="hover:text-ink-2">Companies</Link>
            <span aria-hidden>/</span>
            <span>{company.symbol}</span>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-[26px] sm:text-[30px] font-semibold tracking-tight leading-tight">{company.common_name}</h1>
            <span className="font-mono text-[13px] px-2 py-0.5 rounded-md bg-surface-2 border border-line text-ink-2">
              {company.exchange === "XNAS" ? "NASDAQ" : company.exchange === "XNYS" ? "NYSE" : company.exchange}: {company.symbol}
            </span>
          </div>
          <p className="text-ink-2 mt-1 text-[13px]">
            {company.legal_name}
            {company.ipo_date && <> · Listed {fmtDate(company.ipo_date)}</>}
            {company.cik && (
              <> · <a className="hover:text-ink underline decoration-line-strong underline-offset-2"
                      href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${company.cik}`}
                      target="_blank" rel="noreferrer">SEC filings</a></>
            )}
          </p>
        </div>
        {company.last_close != null && (
          <div className="sm:text-right">
            <div className="text-[28px] font-semibold tracking-tight leading-none">{money(company.last_close)}</div>
            <div className="text-[12px] text-ink-3 mt-1.5">
              <span className={`num ${toneClass(dayChange)}`}>{pct(dayChange, 2)}</span> · Close {fmtDate(company.last_date)}
            </div>
          </div>
        )}
      </div>

      <CoverageStrip current={currentCoverage} history={historyCoverage} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card
          title={`${company.symbol} since listing vs ${bench?.name ?? "benchmark"}`}
          action={sinceIpo ? <span className="num">Since IPO <span className={toneClass(sinceIpo.s)}>{pct(sinceIpo.s)}</span></span> : null}
        >
          <ReturnChart
            points={series}
            stockLabel={company.symbol ?? company.common_name}
            benchLabel={bench?.name ?? null}
            markers={markers}
            height={300}
            baseCaption={company.ipo_date ? `Rebased to 0% at the first close, ${fmtDate(series[0]?.d)}` : undefined}
          />
        </Card>
        <Card title="Board overview">
          <div className="grid grid-cols-2 gap-x-4 gap-y-5 pt-1">
            <Stat label="Directors" value={current.length} sub={`${former.length} former tracked`} />
            <Stat label={`Avg tenure${anyImprecise ? " (≈)" : ""}`} value={years(avgTenure)} />
            <Stat label={`Median tenure${anyImprecise ? " (≈)" : ""}`} value={years(median(tenures))} />
            <Stat label="Independent" value={`${current.filter((m) => m.is_independent).length} / ${current.length}`}
                  sub="per latest proxy" />
          </div>
          <div className="mt-5 pt-4 border-t border-line space-y-3 text-[13px]">
            <MiniList title="Recent appointments" empty="None in the last two years"
              items={recentJoins.map((m) => ({ key: m.membership_id, href: `/c/${company.slug}/d/${m.person_slug}`, name: m.full_name, date: fmtDate(m.start_date) }))} />
            <MiniList title="Recent departures" empty="None in the last two years"
              items={recentLeaves.map((m) => ({ key: m.membership_id, href: `/c/${company.slug}/d/${m.person_slug}`, name: m.full_name, date: fmtDate(m.end_date, m.end_precision ?? "day") }))} />
          </div>
        </Card>
      </div>

      <Card title={`Current board · ${current.length}`} action={bench ? `Benchmark: ${bench.name}` : undefined} pad={false}>
        <BoardTable rows={current} companySlug={company.slug} mode="current" />
        <div className="px-4 sm:px-5 py-3 border-t border-line"><Disclaimer /></div>
      </Card>

      <Card title="Board timeline" action={`${board.length} seats`}>
        <BoardTimeline rows={timeline} ipoDate={company.ipo_date} asOf={asOf} />
      </Card>

      {former.length > 0 && (
        <Card title={`Former directors · ${former.length}`} pad={false}>
          <BoardTable rows={former} companySlug={company.slug} mode="former" />
        </Card>
      )}

      {events.length > 0 && (
        <Card title="Board changes">
          <ol className="divide-y divide-line">
            {events.slice(0, 20).map((e) => (
              <li key={e.id} className="py-2.5 flex gap-4 text-[13px]">
                <span className="w-28 shrink-0 text-ink-3 num">{fmtDate(e.event_date, e.event_date_precision)}</span>
                <span className="min-w-0">
                  <EventLabel type={e.event_type} />{" "}
                  {e.person_slug ? (
                    <Link className="text-ink hover:underline" href={`/c/${company.slug}/d/${e.person_slug}`}>{e.full_name}</Link>
                  ) : null}
                  {typeof e.details?.summary === "string" && <span className="text-ink-2"> · {e.details.summary}</span>}
                </span>
              </li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  );
}

function BoardTable({ rows, companySlug, mode }: { rows: Membership[]; companySlug: string; mode: "current" | "former" }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px] min-w-[760px]">
        <thead>
          <tr className="text-left text-[12px] text-ink-3 border-b border-line">
            <th className="font-normal px-4 sm:px-5 py-2.5">Director</th>
            <th className="font-normal px-3 py-2.5">{mode === "current" ? "Role" : "Last role"}</th>
            <th className="font-normal px-3 py-2.5">Joined</th>
            {mode === "former" && <th className="font-normal px-3 py-2.5">Left</th>}
            <th className="font-normal px-3 py-2.5">Tenure</th>
            <th className="font-normal px-3 py-2.5 text-right">Stock return</th>
            <th className="font-normal px-3 py-2.5 text-right">Annualized</th>
            <th className="font-normal px-3 py-2.5 text-right">vs SPY</th>
            <th className="font-normal px-4 sm:px-5 py-2.5 text-right">Confidence</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.membership_id} className="border-b border-line last:border-0 hover:bg-surface-2 transition-colors">
              <td className="px-4 sm:px-5 py-2.5">
                <Link href={`/c/${companySlug}/d/${m.person_slug}`} className="font-medium text-ink hover:text-accent-ink">
                  {m.full_name}
                </Link>
              </td>
              <td className="px-3 py-2.5 text-ink-2">{primaryRole(m, mode === "current")}</td>
              <td className="px-3 py-2.5 text-ink-2 num whitespace-nowrap">
                {fmtDate(m.start_date, m.start_precision)}
                {m.perf?.start_anchor_reason === "first_trade" && (
                  <Badge title="Joined before the stock listed; returns are measured from the first trading day.">pre-IPO</Badge>
                )}
              </td>
              {mode === "former" && (
                <td className="px-3 py-2.5 text-ink-2 num whitespace-nowrap" title={m.end_reason ? END_REASON[m.end_reason] : undefined}>
                  {fmtDate(m.end_date, m.end_precision ?? "unknown")}
                </td>
              )}
              <td className="px-3 py-2.5 text-ink-2 num">{tenureLength(m.start_date, m.end_date, m.start_precision)}</td>
              <td className="px-3 py-2.5 text-right"><TenureReturn perf={m.perf} /></td>
              <td className="px-3 py-2.5 text-right"><Annualized perf={m.perf} /></td>
              <td className="px-3 py-2.5 text-right"><Relative perf={m.perf} /></td>
              <td className="px-4 sm:px-5 py-2.5 text-right"><Confidence level={m.confidence} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MiniList({ title, items, empty }: {
  title: string; empty: string; items: { key: number; href: string; name: string; date: string }[];
}) {
  return (
    <div>
      <div className="text-[12px] text-ink-3 mb-1">{title}</div>
      {items.length === 0 ? <div className="text-ink-3">{empty}</div> : (
        <ul className="space-y-1">
          {items.slice(0, 4).map((i) => (
            <li key={i.key} className="flex justify-between gap-3">
              <Link href={i.href} className="truncate hover:text-accent-ink">{i.name}</Link>
              <span className="text-ink-3 num shrink-0">{i.date}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EventLabel({ type }: { type: string }) {
  const map: Record<string, [string, "accent" | "neutral" | "warn"]> = {
    BOARD_JOIN: ["Joined", "accent"],
    BOARD_LEAVE: ["Left", "neutral"],
    ROLE_CHANGE: ["Role change", "neutral"],
    BOARD_SIZE_CHANGE: ["Board size", "neutral"],
    COMMITTEE_CHANGE: ["Committee", "neutral"],
  };
  const [label, tone] = map[type] ?? [type, "neutral"];
  return <Badge tone={tone}>{label}</Badge>;
}

function CoverageStrip({ current, history }: {
  current: { level: string; method: string; assessed_at: string } | undefined;
  history: { level: string; period_start: string; period_end: string; method: string }[];
}) {
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-lg border border-line bg-surface px-4 py-2.5 text-[12px] text-ink-2">
      <span className="inline-flex items-center gap-2">
        <span className={`h-1.5 w-1.5 rounded-full ${current?.level === "complete" ? "bg-pos" : "bg-warn"}`} aria-hidden />
        <span className="text-ink-3">Current board</span>
        {current ? <span title={current.method}>{current.level === "complete" ? "Verified" : "Partial"} · checked {fmtDate(current.assessed_at.slice(0, 10))}</span> : <span>Not yet verified</span>}
      </span>
      {history.map((h) => (
        <span key={h.period_start} className="inline-flex items-center gap-2" title={h.method}>
          <span className={`h-1.5 w-1.5 rounded-full ${h.level === "complete" ? "bg-pos" : "bg-warn"}`} aria-hidden />
          <span className="text-ink-3">History {h.period_start.slice(0, 4)}–{h.period_end.slice(0, 4)}</span>
          <span className="capitalize">{h.level}</span>
        </span>
      ))}
      <Link href="/methodology" className="ml-auto text-ink-3 hover:text-ink-2">How we measure</Link>
    </div>
  );
}
