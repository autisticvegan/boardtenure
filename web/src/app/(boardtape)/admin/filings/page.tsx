import { Badge, Card } from "@/components/ui";
import { requireAdmin } from "@/lib/admin-auth";
import { sql } from "@/lib/db";
import { fmtDate } from "@/lib/format";
import { markFilingReviewed } from "../actions";

type Filing = {
  accession_number: string; form_type: string; filing_date: string; items: string[]; processing_status: string;
  error: string | null; company: string; cik: string; primary_document: string | null;
};

export default async function FilingsPage() {
  await requireAdmin();
  const filings = await sql<Filing[]>`
    SELECT f.accession_number, f.form_type, f.filing_date, f.items, f.processing_status, f.error,
           c.common_name AS company, f.cik, f.primary_document
    FROM sec_filing f JOIN company c ON c.id = f.company_id
    WHERE f.processing_status IN ('needs_review', 'failed', 'pending')
    ORDER BY f.filing_date DESC LIMIT 200`;
  return (
    <Card title={`Filings awaiting review · ${filings.length}`} pad={false}>
      <ul className="divide-y divide-line">
        {filings.map((f) => {
          const url = `https://www.sec.gov/Archives/edgar/data/${Number(f.cik)}/${f.accession_number.replace(/-/g, "")}/${f.primary_document ?? ""}`;
          return (
            <li key={f.accession_number} className="px-5 py-3 text-[13px]">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={f.processing_status === "failed" ? "warn" : "accent"}>{f.processing_status}</Badge>
                <span className="font-medium">{f.company}</span>
                <span>{f.form_type}{f.items.length ? ` · Items ${f.items.join(", ")}` : ""}</span>
                <span className="text-ink-3">filed {fmtDate(f.filing_date)}</span>
                <a className="ml-auto text-accent-ink hover:underline" href={url} target="_blank" rel="noreferrer">Open on EDGAR ↗</a>
              </div>
              {f.error && <p className="mt-1 text-ink-3 text-[12px]">{f.error}</p>}
              <form action={markFilingReviewed} className="mt-2 flex gap-2">
                <input type="hidden" name="accession" value={f.accession_number} />
                <input name="note" required placeholder="What did you verify or change?" className="h-8 flex-1 rounded-md border border-line bg-surface px-2 text-[12px]" />
                <button className="h-8 px-3 rounded-md border border-line text-[12px] hover:bg-surface-2">Mark reviewed</button>
              </form>
            </li>
          );
        })}
        {filings.length === 0 && <li className="px-5 py-4 text-ink-3 text-[13px]">No filings need review.</li>}
      </ul>
    </Card>
  );
}
