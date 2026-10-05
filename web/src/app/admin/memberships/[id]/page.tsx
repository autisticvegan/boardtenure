import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui";
import { requireAdmin } from "@/lib/admin-auth";
import { sql } from "@/lib/db";
import { updateMembership } from "../../actions";
import { AuditDiff } from "../../audit/diff";

type Row = {
  id: number; full_name: string; person_slug: string; company: string; company_slug: string; status: string;
  start_date: string | null; start_precision: string; start_basis: string | null; end_date: string | null;
  end_precision: string | null; end_reason: string | null; confidence: string; notes: string | null; is_locked: boolean;
};

const input = "h-9 w-full rounded-md border border-line bg-surface px-2 text-[13px]";

export default async function MembershipEdit({ params, searchParams }: PageProps<"/admin/memberships/[id]">) {
  await requireAdmin();
  const id = Number((await params).id);
  const saved = (await searchParams).saved === "1";
  const [m] = await sql<Row[]>`
    SELECT m.id, p.full_name, p.slug AS person_slug, c.common_name AS company, c.slug AS company_slug, m.status,
           m.start_date, m.start_precision, m.start_basis, m.end_date, m.end_precision, m.end_reason, m.confidence,
           m.notes, m.is_locked
    FROM board_membership m JOIN person p ON p.id = m.person_id JOIN company c ON c.id = m.company_id
    WHERE m.id = ${id}`;
  if (!m) notFound();
  const history = await sql<{ id: number; occurred_at: string; actor: string; reason: string | null; old_row: Record<string, unknown> | null; new_row: Record<string, unknown> | null }[]>`
    SELECT id, occurred_at::text, actor, reason, old_row, new_row FROM audit_log
    WHERE table_name = 'board_membership' AND row_id = ${id} ORDER BY occurred_at DESC LIMIT 50`;
  const sel = (name: string, value: string | null, options: string[]) => (
    <select name={name} defaultValue={value ?? ""} className={input}>
      {options.map((o) => <option key={o} value={o}>{o || "—"}</option>)}
    </select>
  );
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">{m.full_name} · {m.company}</h1>
        <p className="text-[13px] text-ink-3">
          <Link className="hover:text-ink-2" href={`/c/${m.company_slug}/d/${m.person_slug}`}>View public page</Link>
        </p>
      </div>
      {saved && <p className="rounded-md bg-accent-wash text-accent-ink px-3 py-2 text-[13px]">Saved and audited.</p>}
      <Card title="Correct this board seat">
        <form action={updateMembership} className="grid gap-4 sm:grid-cols-2 text-[13px]">
          <input type="hidden" name="id" value={m.id} />
          <label className="space-y-1"><span className="text-ink-3">Status</span>{sel("status", m.status, ["current", "former"])}</label>
          <label className="space-y-1"><span className="text-ink-3">Confidence</span>{sel("confidence", m.confidence, ["high", "medium", "low"])}</label>
          <label className="space-y-1"><span className="text-ink-3">Start (YYYY, YYYY-MM or YYYY-MM-DD)</span>
            <input name="start_date" defaultValue={m.start_date ?? ""} className={input} /></label>
          <label className="space-y-1"><span className="text-ink-3">Start precision</span>{sel("start_precision", m.start_precision, ["day", "month", "year", "unknown"])}</label>
          <label className="space-y-1 sm:col-span-2"><span className="text-ink-3">Start basis</span>
            <input name="start_basis" defaultValue={m.start_basis ?? ""} className={input} /></label>
          <label className="space-y-1"><span className="text-ink-3">End</span>
            <input name="end_date" defaultValue={m.end_date ?? ""} className={input} /></label>
          <label className="space-y-1"><span className="text-ink-3">End precision</span>{sel("end_precision", m.end_precision, ["", "day", "month", "year", "unknown"])}</label>
          <label className="space-y-1"><span className="text-ink-3">End reason</span>
            {sel("end_reason", m.end_reason, ["", "resigned", "did_not_stand", "not_reelected", "retired", "died", "removed", "term_expired", "company_acquired", "company_delisted", "other"])}</label>
          <label className="flex items-center gap-2 pt-6"><input type="checkbox" name="is_locked" defaultChecked={m.is_locked} />
            Lock (pipeline may propose changes but never overwrite)</label>
          <label className="space-y-1 sm:col-span-2"><span className="text-ink-3">Notes</span>
            <textarea name="notes" defaultValue={m.notes ?? ""} rows={2} className={`${input} h-auto py-2`} /></label>
          <label className="space-y-1 sm:col-span-2"><span className="text-ink-3">Reason for this correction (required, recorded in the audit log)</span>
            <input name="reason" required className={input} placeholder="e.g. 8-K filed 2026-07-27 gives effective date" /></label>
          <div className="sm:col-span-2"><button className="h-9 px-4 rounded-md bg-ink text-bg text-[13px] font-medium">Save correction</button></div>
        </form>
      </Card>
      <Card title="Change history" pad={false}>
        <ul className="divide-y divide-line">
          {history.map((h) => (
            <li key={h.id} className="px-5 py-3 text-[13px]">
              <div className="flex gap-2"><span className="font-medium">{h.actor}</span><span className="ml-auto text-ink-3 num">{h.occurred_at.slice(0, 19)}</span></div>
              {h.reason && <p className="text-ink-2">“{h.reason}”</p>}
              <AuditDiff oldRow={h.old_row} newRow={h.new_row} />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
