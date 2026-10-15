// A golden parachute as a receipt: line items, a total, and what shareholders got meanwhile.
import { Logo } from "@/components/logo";
import { compactMoney } from "@/lib/format";
import { hundred } from "./hundred";

export type ReceiptItem = { label: string; value: number | null };

export function Receipt({ title = "Exit receipt", estimatedNote = "estimated in the filing, before the exit", cik, company, person, role, left, items, total, totalStated, basis, value100, comparison,
                          comparison100, perMonth, sources, stamp }: {
  title?: string; estimatedNote?: string; cik?: number | null; company: string; person: string; role: string; left: string; items: ReceiptItem[]; total: number | null;
  totalStated: boolean; basis: "actual" | "estimated"; value100: number | null; comparison: string | null;
  comparison100: number | null; perMonth: number | null; sources: string[]; stamp: string;
}) {
  const listed = items.filter((i) => i.value != null && i.value !== 0);
  // A stated total can include parts the filing doesn't break out; show the difference as its own line.
  const parts = listed.reduce((a, i) => a + (i.value ?? 0), 0);
  const rest = total != null && total - parts > Math.max(1, total * 0.01) ? total - parts : null;
  const shown = rest != null
    ? [...listed, { label: totalStated ? "Not itemized in the filing" : "Other disclosed parts", value: rest }]
    : listed;
  return (
    <article className="hiw-receipt relative px-5 pt-5 pb-7 text-[12.5px] leading-5 shadow-card">
      <div className="text-center">
        {cik != null && <div className="mb-2 flex justify-center"><Logo cik={cik} size={34} /></div>}
        <div className="text-[11px] tracking-[0.2em] uppercase opacity-70">{title}</div>
        <div className="mt-1 text-[16px] leading-6 font-bold">{company}</div>
        <div className="text-[11px] opacity-70">{left}</div>
      </div>
      <hr />
      <div className="font-bold">{person}</div>
      <div className="opacity-75">{role}</div>
      <hr />
      <div className="space-y-1">
        {shown.length === 0 && <div className="opacity-70">No exit pay disclosed</div>}
        {shown.map((i, n) => (
          <div key={`${n}-${i.label}`} className="leader"><span>{i.label}</span><span className="tabular-nums">{compactMoney(i.value)}</span></div>
        ))}
      </div>
      <hr />
      <div className="leader text-[15px] font-black"><span>TOTAL</span><span className="tabular-nums">{compactMoney(total)}</span></div>
      {!totalStated && shown.length > 1 && <div className="text-[10.5px] opacity-60">sum of the disclosed parts</div>}
      {basis === "estimated" && <div className="text-[10.5px] opacity-60">{estimatedNote}</div>}
      {perMonth != null && <div className="mt-1 text-[11.5px] opacity-80">≈ {compactMoney(perMonth)} per month in the job</div>}
      {value100 != null && (
        <>
          <hr />
          <div className="text-[11px] uppercase tracking-[0.12em] opacity-70">Meanwhile, shareholders</div>
          <div className="leader"><span>$100 invested became</span><span className="tabular-nums font-bold">{hundred(value100)}</span></div>
          {comparison100 != null && (
            <div className="leader opacity-75"><span>{comparison ?? "Index"}</span><span className="tabular-nums">{hundred(comparison100)}</span></div>
          )}
        </>
      )}
      <hr />
      <div className="flex items-center justify-between gap-3 text-[11px]">
        <span className="opacity-70">
          {sources.slice(0, 3).map((u, i) => (
            <a key={u} href={u} target="_blank" rel="noreferrer" className="underline underline-offset-2 mr-2">source {i + 1}</a>
          ))}
        </span>
        <span className={`hiw-stamp text-[11px] ${value100 != null && value100 < 100 ? "text-[#b3261e]" : "text-[#7a5a00]"}`}>{stamp}</span>
      </div>
    </article>
  );
}
