"use client";

// "Since you opened this page": what the best-paid CEOs on file earned, and what one median worker
// earned, if a year's reported pay arrived evenly every second of the year.
import { useEffect, useState } from "react";

const SECONDS_PER_YEAR = 365 * 24 * 3600;

export function GreedMeter({ ceoPayTotal, ceos, medianWorker }: { ceoPayTotal: number; ceos: number; medianWorker: number }) {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const t0 = performance.now();
    const id = window.setInterval(() => setSecs((performance.now() - t0) / 1000), 50);
    return () => window.clearInterval(id);
  }, []);
  const ceo = (ceoPayTotal / SECONDS_PER_YEAR) * secs;
  const worker = (medianWorker / SECONDS_PER_YEAR) * secs;
  return (
    <div className="mt-5 inline-flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-[14px] border border-accent/40 bg-accent-wash px-4 py-3" aria-live="off">
      <span className="text-[12px] leading-4 text-ink-2">Since you opened this page, the {ceos} best-paid CEOs here made</span>
      <span className="text-[26px] leading-[30px] font-black text-accent-ink num">
        ${ceo.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
      <span className="text-[12px] leading-4 text-ink-2">
        A median worker: <span className="num font-semibold text-ink">${worker.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}</span>
      </span>
    </div>
  );
}
