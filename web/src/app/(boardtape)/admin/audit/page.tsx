import { Card } from "@/components/ui";
import { requireAdmin } from "@/lib/admin-auth";
import { sql } from "@/lib/db";
import { AuditDiff } from "./diff";

export default async function AuditPage() {
  await requireAdmin();
  const rows = await sql<{ id: number; occurred_at: string; actor: string; reason: string | null; action: string; table_name: string; row_id: number | null; old_row: Record<string, unknown> | null; new_row: Record<string, unknown> | null }[]>`
    SELECT id, occurred_at::text, actor, reason, action, table_name, row_id, old_row, new_row
    FROM audit_log WHERE actor NOT LIKE 'pipeline:%' OR action <> 'INSERT'
    ORDER BY occurred_at DESC LIMIT 100`;
  return (
    <Card title="Audit log" action="manual changes and pipeline updates (inserts by the pipeline hidden)" pad={false}>
      <ul className="divide-y divide-line">
        {rows.map((r) => (
          <li key={r.id} className="px-5 py-3 text-[13px]">
            <div className="flex flex-wrap gap-2">
              <span className="font-medium">{r.actor}</span>
              <span className="text-ink-2">{r.action} {r.table_name} #{r.row_id}</span>
              <span className="ml-auto text-ink-3 num">{r.occurred_at.slice(0, 19)}</span>
            </div>
            {r.reason && <p className="text-ink-2">“{r.reason}”</p>}
            <AuditDiff oldRow={r.old_row} newRow={r.new_row} />
          </li>
        ))}
        {rows.length === 0 && <li className="px-5 py-4 text-ink-3 text-[13px]">No entries.</li>}
      </ul>
    </Card>
  );
}
