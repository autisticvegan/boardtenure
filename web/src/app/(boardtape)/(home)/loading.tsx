// Dashboard skeleton while "/" streams in (§8.3). Shimmer is the only looping motion and stops
// under reduced motion (globals.css). It lives in this route group, not at the app root, so routes
// that call notFound() (/c/[slug], /d/[person]) aren't wrapped in a boundary that would stream a
// 200 before the 404 is known.
export default function Loading() {
  return (
    <div className="space-y-8 md:space-y-12" aria-busy="true">
      <span className="sr-only" role="status">Loading the standings…</span>
      <div className="space-y-5 pt-2 md:pt-4" aria-hidden>
        <div className="space-y-3">
          <div className="skeleton h-3.5 w-64" />
          <div className="skeleton h-8 md:h-[38px] w-full max-w-[520px]" />
          <div className="skeleton h-5 w-full max-w-[620px]" />
          <div className="skeleton h-5 w-2/3 max-w-[420px]" />
        </div>
        <div className="skeleton h-11 md:h-9 w-full md:w-72" />
        <div className="grid grid-cols-2 md:grid-cols-5 gap-px overflow-hidden rounded-[14px] border border-line bg-line">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className={`bg-surface px-4 py-3 md:px-5 md:py-4 space-y-2 ${i === 4 ? "max-md:col-span-2" : ""}`}>
              <div className="skeleton h-6 w-16" />
              <div className="skeleton h-3 w-24" />
            </div>
          ))}
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-2" aria-hidden>
        {[0, 1].map((col) => (
          <div key={col} className="space-y-3">
            <div className="skeleton h-6 w-48" />
            <div className="skeleton h-4 w-full max-w-[420px]" />
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex gap-4 rounded-[14px] border border-line bg-surface p-4 md:p-5 min-h-[120px] md:min-h-[136px]">
                <div className="skeleton h-9 w-9 shrink-0 rounded-full" />
                <div className="flex-1 space-y-2">
                  <div className="skeleton h-5 w-2/3" />
                  <div className="skeleton h-4 w-full max-w-[260px]" />
                </div>
                <div className="skeleton h-10 w-32 shrink-0 max-sm:hidden" />
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="skeleton h-[220px] w-full rounded-[14px]" aria-hidden />
    </div>
  );
}
