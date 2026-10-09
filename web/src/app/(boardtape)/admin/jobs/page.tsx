import { Card } from "@/components/ui";
import { requireAdmin } from "@/lib/admin-auth";
import { sql } from "@/lib/db";

export default async function JobsPage() {
  await requireAdmin();
  const runs = await sql<{ id: number; job_name: string; status: string; started_at: string; finished_at: string | null; stats: unknown }[]>`
    SELECT id, job_name, status, started_at::text, finished_at::text, stats FROM job_run ORDER BY started_at DESC LIMIT 50`;
  return (
    <Card title="Pipeline runs" pad={false}>
      <ul className="divide-y divide-line">
        {runs.map((r) => (
          <li key={r.id} className="px-5 py-3 text-[13px]">
            <details>
              <summary className="cursor-pointer flex flex-wrap gap-3">
                <span className="font-medium">{r.job_name}</span>
                <span className={r.status === "succeeded" ? "text-pos" : r.status === "running" ? "text-ink-3" : "text-neg"}>{r.status}</span>
                <span className="text-ink-3 num ml-auto">{r.started_at.slice(0, 19)} → {r.finished_at?.slice(11, 19) ?? "…"}</span>
              </summary>
              <pre className="mt-2 text-[11px] font-mono text-ink-2 whitespace-pre-wrap max-h-96 overflow-auto">{JSON.stringify(r.stats, null, 1)}</pre>
            </details>
          </li>
        ))}
        {runs.length === 0 && <li className="px-5 py-4 text-ink-3 text-[13px]">No runs yet.</li>}
      </ul>
    </Card>
  );
}
