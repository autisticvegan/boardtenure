import { Badge, Card } from "@/components/ui";
import { requireAdmin } from "@/lib/admin-auth";
import { sql } from "@/lib/db";
import { setIssueStatus } from "../actions";

type Issue = {
  id: number; check_code: string; severity: string; priority: number; status: string; message: string;
  details: Record<string, unknown>; company: string | null; last_seen_at: string; resolution_note: string | null;
};

export default async function IssuesPage({ searchParams }: PageProps<"/admin/issues">) {
  await requireAdmin();
  const sp = await searchParams;
  const status = sp.status === "all" ? null : (typeof sp.status === "string" ? sp.status : "open");
  const issues = await sql<Issue[]>`
    SELECT i.id, i.check_code, i.severity, i.priority, i.status, i.message, i.details, c.common_name AS company,
           i.last_seen_at::text, i.resolution_note
    FROM data_issue i LEFT JOIN company c ON c.id = i.company_id
    WHERE ${status}::text IS NULL OR i.status = ${status} OR (${status} = 'open' AND i.status = 'acknowledged')
    ORDER BY i.priority, i.severity = 'error' DESC, i.last_seen_at DESC LIMIT 200`;
  return (
    <Card title={`Data issues · ${issues.length}`} action={
      <span className="flex gap-3">
        {["open", "resolved", "wont_fix", "all"].map((s) => <a key={s} href={`?status=${s}`} className={s === (status ?? "all") ? "text-ink" : ""}>{s}</a>)}
      </span>} pad={false}>
      <ul className="divide-y divide-line">
        {issues.map((i) => (
          <li key={i.id} className="px-5 py-3 text-[13px]">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={i.severity === "error" ? "warn" : "neutral"}>P{i.priority} · {i.severity}</Badge>
              <span className="font-mono text-[11px] text-ink-3">{i.check_code}</span>
              {i.company && <span className="text-ink-3">{i.company}</span>}
              <span className="ml-auto text-[11px] text-ink-3">{i.status} · seen {i.last_seen_at.slice(0, 16)}</span>
            </div>
            <p className="mt-1 text-ink">{i.message}</p>
            {i.resolution_note && <p className="text-ink-3 text-[12px]">Note: {i.resolution_note}</p>}
            {(i.status === "open" || i.status === "acknowledged") && (
              <form action={setIssueStatus} className="mt-2 flex flex-wrap gap-2 items-center">
                <input type="hidden" name="id" value={i.id} />
                <input name="note" placeholder="Note (required to resolve)" className="h-8 flex-1 min-w-48 rounded-md border border-line bg-surface px-2 text-[12px]" />
                <button name="status" value="acknowledged" className="h-8 px-3 rounded-md border border-line text-[12px] hover:bg-surface-2">Acknowledge</button>
                <button name="status" value="resolved" className="h-8 px-3 rounded-md border border-line text-[12px] hover:bg-surface-2">Resolve</button>
                <button name="status" value="wont_fix" className="h-8 px-3 rounded-md border border-line text-[12px] hover:bg-surface-2">Won&rsquo;t fix</button>
              </form>
            )}
          </li>
        ))}
        {issues.length === 0 && <li className="px-5 py-4 text-ink-3 text-[13px]">Nothing here.</li>}
      </ul>
    </Card>
  );
}
