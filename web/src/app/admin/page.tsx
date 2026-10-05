import Link from "next/link";
import { Card, Confidence, Stat } from "@/components/ui";
import { requireAdmin } from "@/lib/admin-auth";
import { sql } from "@/lib/db";
import { fmtDate } from "@/lib/format";

export default async function AdminHome() {
  await requireAdmin();
  const [[counts], jobs, lowConf, recentFilings] = await Promise.all([
    sql<{ p1: number; p2: number; p3: number; filings: number; facts: number; failed: number }[]>`
      SELECT
        count(*) FILTER (WHERE priority = 1 AND status IN ('open','acknowledged'))::int AS p1,
        count(*) FILTER (WHERE priority = 2 AND status IN ('open','acknowledged'))::int AS p2,
        count(*) FILTER (WHERE priority = 3 AND status IN ('open','acknowledged'))::int AS p3,
        (SELECT count(*) FROM sec_filing WHERE processing_status = 'needs_review')::int AS filings,
        (SELECT count(*) FROM extracted_fact WHERE status = 'needs_review')::int AS facts,
        (SELECT count(*) FROM sec_filing WHERE processing_status = 'failed')::int AS failed
      FROM data_issue`,
    sql<{ id: number; job_name: string; status: string; started_at: string; finished_at: string | null }[]>`
      SELECT id, job_name, status, started_at::text, finished_at::text FROM job_run ORDER BY started_at DESC LIMIT 5`,
    sql<{ id: number; full_name: string; company: string; status: string; confidence: "low" | "medium" | "high" }[]>`
      SELECT m.id, p.full_name, c.common_name AS company, m.status, m.confidence
      FROM board_membership m JOIN person p ON p.id = m.person_id JOIN company c ON c.id = m.company_id
      WHERE m.confidence <> 'high' OR m.start_precision = 'unknown'
      ORDER BY m.status = 'current' DESC, m.confidence LIMIT 20`,
    sql<{ accession_number: string; form_type: string; filing_date: string; items: string[]; processing_status: string; company: string }[]>`
      SELECT f.accession_number, f.form_type, f.filing_date, f.items, f.processing_status, c.common_name AS company
      FROM sec_filing f JOIN company c ON c.id = f.company_id
      WHERE f.processing_status <> 'skipped' ORDER BY f.discovered_at DESC, f.filing_date DESC LIMIT 10`,
  ]);
  return (
    <div className="space-y-6">
      <Card>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-6">
          <Stat label="Issues · current board" value={counts.p1} valueClass={counts.p1 ? "text-neg" : ""} />
          <Stat label="Issues · recent former" value={counts.p2} />
          <Stat label="Issues · historical" value={counts.p3} />
          <Stat label="Filings to review" value={counts.filings} valueClass={counts.filings ? "text-warn" : ""} />
          <Stat label="Facts to review" value={counts.facts} />
          <Stat label="Failed filings" value={counts.failed} valueClass={counts.failed ? "text-neg" : ""} />
        </div>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Recent pipeline runs" action={<Link href="/admin/jobs">All runs →</Link>}>
          <ul className="divide-y divide-line text-[13px]">
            {jobs.map((j) => (
              <li key={j.id} className="py-2 flex justify-between gap-3">
                <span>{j.job_name} <span className={j.status === "succeeded" ? "text-pos" : j.status === "running" ? "text-ink-3" : "text-neg"}>{j.status}</span></span>
                <span className="text-ink-3 num">{j.started_at.slice(0, 16)} UTC</span>
              </li>
            ))}
            {jobs.length === 0 && <li className="py-2 text-ink-3">No runs yet.</li>}
          </ul>
        </Card>
        <Card title="Recently discovered filings" action={<Link href="/admin/filings">Review →</Link>}>
          <ul className="divide-y divide-line text-[13px]">
            {recentFilings.map((f) => (
              <li key={f.accession_number} className="py-2 flex justify-between gap-3">
                <span>{f.company} · {f.form_type}{f.items.length ? ` (${f.items.join(", ")})` : ""}</span>
                <span className="text-ink-3">{fmtDate(f.filing_date)} · {f.processing_status}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <Card title="Low-confidence or undated seats" pad={false}>
        <table className="w-full text-[13px]">
          <tbody>
            {lowConf.map((m) => (
              <tr key={m.id} className="border-t border-line first:border-0">
                <td className="px-5 py-2"><Link className="hover:text-accent-ink" href={`/admin/memberships/${m.id}`}>{m.full_name}</Link></td>
                <td className="px-3 py-2 text-ink-2">{m.company}</td>
                <td className="px-3 py-2 text-ink-2">{m.status}</td>
                <td className="px-5 py-2 text-right"><Confidence level={m.confidence} /></td>
              </tr>
            ))}
            {lowConf.length === 0 && <tr><td className="px-5 py-3 text-ink-3">None.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
