// "Worst drop" stat tile for the seat page (docs/design/rankings-ui.md §5.5).
import { Stat } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { Signed } from "./primitives";

export function WhiteKnuckle({ mdd, peak, trough, beat }: {
  mdd: number | null; peak: string | null; trough: string | null; beat: boolean;
}) {
  return (
    <Stat
      label="Worst drop"
      value={<Signed value={mdd} kind="pct" glyph />}
      sub={
        <>
          {peak && trough && <span className="block num">{fmtDate(peak)} → {fmtDate(trough)}</span>}
          {beat && mdd != null && mdd <= -0.3 && <span className="block text-ink-2">Still finished ahead of the S&amp;P.</span>}
        </>
      }
    />
  );
}
