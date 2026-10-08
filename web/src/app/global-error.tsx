"use client";

// Root-layout errors (the layout's footer query, for one) land here, outside app/error.tsx.
// This replaces the root layout, so it brings its own document, dark colours and stylesheet.
import { useEffect } from "react";
import "./globals.css";

export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en" style={{ colorScheme: "dark", background: "#0b0d12" }}>
      <body className="min-h-dvh text-[14px] leading-[22px]" style={{ margin: 0, background: "#0b0d12", color: "#f5f7fa" }}>
        <title>BoardTenure</title>
        <main className="w-full max-w-[1240px] mx-auto px-4 sm:px-6 py-16 md:py-24" role="alert">
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
        </main>
      </body>
    </html>
  );
}
