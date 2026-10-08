// Company page dek (rankings-ui.md §4.3, row 3): the board's batting line in the active scope.
import { Signed } from "./primitives";

export function BoardRecordDek({ scored, beat, median }: { scored: number; beat: number; median: number | null }) {
  if (scored === 0) {
    return (
      <p className="text-[16px] leading-6 text-ink-2 max-w-[60ch]">
        No scored seats yet. A seat is scored after a year of exact dates.
      </p>
    );
  }
  return (
    <div className="max-w-[60ch]">
      <p className="text-[16px] leading-6 sm:text-[18px] sm:leading-7 text-ink-2">
        <strong className="font-bold text-ink num">{beat} of {scored}</strong> scored seats beat the S&amp;P 500 while
        held. Median seat <Signed value={median} kind="perYear" className="font-bold" />.
      </p>
      <p className="mt-1 text-[13px] leading-5 text-ink-3">Board-mates share one stock, so their numbers move together.</p>
    </div>
  );
}
