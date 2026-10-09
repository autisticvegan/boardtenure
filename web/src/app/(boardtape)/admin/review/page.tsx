import { Badge, Card } from "@/components/ui";
import { requireAdmin } from "@/lib/admin-auth";
import { sql } from "@/lib/db";
import { reviewFact } from "../actions";

type Fact = {
  id: number; fact_type: string; person_name: string | null; person_cik: string | null; payload: Record<string, unknown>;
  company: string | null; quote: string | null; quote_verified: boolean | null; url: string | null; doc_type: string;
};

const LABEL: Record<string, string> = {
  insider_relationship: "Form 3/4 director without a seat",
  other_board_disclosed: "Other board named in a proxy bio",
  director_appointed: "Appointment",
  director_departed: "Departure",
};

export default async function ReviewPage() {
  await requireAdmin();
  const facts = await sql<Fact[]>`
    SELECT x.id, x.fact_type, x.person_name, x.person_cik, x.payload, c.common_name AS company,
           e.quote, e.quote_verified, d.url, d.doc_type
    FROM extracted_fact x JOIN evidence e ON e.id = x.evidence_id JOIN source_document d ON d.id = e.source_document_id
    LEFT JOIN company c ON c.id = x.company_id
    WHERE x.status = 'needs_review'
    ORDER BY x.fact_type = 'insider_relationship' DESC, x.created_at DESC LIMIT 200`;
  return (
    <Card title={`Review queue · ${facts.length}`} pad={false}>
      <ul className="divide-y divide-line">
        {facts.map((f) => (
          <li key={f.id} className="px-5 py-3 text-[13px]">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={f.fact_type === "insider_relationship" ? "warn" : "neutral"}>{LABEL[f.fact_type] ?? f.fact_type}</Badge>
              <span className="font-medium">{f.person_name}</span>
              {f.company && <span className="text-ink-3">via {f.company}</span>}
              {f.url && <a className="ml-auto text-accent-ink hover:underline" href={f.url} target="_blank" rel="noreferrer">{f.doc_type} ↗</a>}
            </div>
            <pre className="mt-1 text-[11px] text-ink-2 whitespace-pre-wrap font-mono">{JSON.stringify(f.payload)}</pre>
            {f.quote && <blockquote className="mt-1 border-l-2 border-line-strong pl-2 text-ink-2">{f.quote} {f.quote_verified ? <span className="text-pos">✓</span> : null}</blockquote>}
            <form action={reviewFact} className="mt-2 flex flex-wrap gap-2">
              <input type="hidden" name="id" value={f.id} />
              <input name="note" placeholder="Note" className="h-8 flex-1 min-w-48 rounded-md border border-line bg-surface px-2 text-[12px]" />
              <button name="decision" value="applied" className="h-8 px-3 rounded-md border border-line text-[12px] hover:bg-surface-2">Applied</button>
              <button name="decision" value="corroborating" className="h-8 px-3 rounded-md border border-line text-[12px] hover:bg-surface-2">Corroborates existing</button>
              <button name="decision" value="rejected" className="h-8 px-3 rounded-md border border-line text-[12px] hover:bg-surface-2">Reject</button>
            </form>
          </li>
        ))}
        {facts.length === 0 && <li className="px-5 py-4 text-ink-3 text-[13px]">Queue is empty.</li>}
      </ul>
    </Card>
  );
}
