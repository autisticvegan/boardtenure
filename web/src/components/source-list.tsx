import type { EvidenceRow } from "@/lib/queries";
import { fmtDate } from "@/lib/format";
import { Badge } from "./ui";

const FIELD_LABEL: Record<string, string> = {
  start_date: "Join date",
  end_date: "Departure",
  role: "Role",
  "*": "Board seat",
};

const METHOD_LABEL: Record<string, string> = {
  structured_xml: "Structured filing data",
  structured_json: "Structured data",
  deterministic_text: "Parsed from filing text",
  llm: "AI-extracted, quote-verified",
  manual_research: "Researched from filing",
  manual_admin: "Admin correction",
};

export function SourceList({ rows }: { rows: EvidenceRow[] }) {
  if (rows.length === 0) return <p className="text-[13px] text-ink-3">No sources recorded.</p>;
  return (
    <ul className="divide-y divide-line">
      {rows.map((r, i) => (
        <li key={i} className="py-3 first:pt-0 last:pb-0">
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            <Badge>{FIELD_LABEL[r.field] ?? r.field}</Badge>
            {r.stance === "contradicts" && <Badge tone="warn">Conflicts</Badge>}
            <span className="text-ink-2">
              {r.url ? (
                <a href={r.url} target="_blank" rel="noreferrer" className="hover:text-ink underline decoration-line-strong underline-offset-2">
                  {r.doc_type}{r.title ? ` · ${r.title}` : ""}
                </a>
              ) : r.doc_type}
            </span>
            <span className="text-ink-3">filed {fmtDate(r.published_at)}</span>
            <span className="ml-auto text-ink-3 inline-flex items-center gap-1.5">
              {r.quote_verified === true && <span className="text-pos" title="Quote found verbatim in the filing">✓ verified quote</span>}
              {r.quote_verified === false && <span className="text-warn" title="Quote not found verbatim; confidence lowered">unverified quote</span>}
              <span>{METHOD_LABEL[r.extraction_method] ?? r.extraction_method}</span>
            </span>
          </div>
          {r.quote && (
            <blockquote className="mt-2 border-l-2 border-line-strong pl-3 text-[13px] text-ink-2 leading-relaxed">
              {r.quote}
            </blockquote>
          )}
        </li>
      ))}
    </ul>
  );
}
