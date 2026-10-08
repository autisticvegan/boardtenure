"use client";

// Route error state (§8.3). `retry` re-fetches and re-renders the segment (Next 16.3).
import { useEffect } from "react";

export default function RouteError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="py-16 md:py-24" role="alert">
      <div className="mx-auto max-w-[520px] rounded-[14px] border border-line bg-surface shadow-card p-5 text-center">
        <p className="text-[15px] leading-6 text-ink">Couldn&rsquo;t load the standings. Try again in a minute.</p>
        <button
          type="button"
          onClick={() => retry()}
          className="mt-3 min-h-9 px-2 text-[13px] leading-5 font-semibold text-accent-ink hover:underline underline-offset-2"
        >
          Reload
        </button>
      </div>
    </div>
  );
}
