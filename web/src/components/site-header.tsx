import Link from "next/link";
import { SearchBox } from "./search-box";

export function SiteHeader() {
  return (
    <header
      className="sticky z-30 border-b border-line bg-bg/85 backdrop-blur supports-[backdrop-filter]:bg-bg/70"
      style={{ top: "env(safe-area-inset-top, 0px)" }}
    >
      <div className="max-w-[1240px] mx-auto px-4 sm:px-6 h-14 flex items-center gap-3 sm:gap-5">
        <Link href="/" className="flex items-center justify-center gap-2 shrink-0 max-md:min-h-11 max-md:min-w-11" aria-label="Boardtape standings home">
          <Logo />
          <span className="hidden sm:inline font-bold tracking-tight text-[15px]">Boardtape</span>
        </Link>
        <Link href="/rankings" className="inline-flex items-center max-md:min-h-11 shrink-0 text-[13px] font-semibold text-ink hover:text-accent-ink">
          Standings
        </Link>
        <Link href="/pay" className="inline-flex items-center max-md:min-h-11 shrink-0 text-[13px] font-semibold text-ink hover:text-accent-ink">
          Pay
        </Link>
        <div className="flex-1 min-w-0 max-w-[460px]">
          <SearchBox />
        </div>
        <nav className="hidden md:flex items-center gap-5 text-[13px] text-ink-2 ml-auto">
          <Link className="hover:text-ink transition-colors" href="/companies">Companies</Link>
          <Link className="hover:text-ink transition-colors" href="/methodology">Methodology</Link>
        </nav>
      </div>
    </header>
  );
}

/** Mark: a tenure band on an axis. */
function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden className="shrink-0">
      <rect x="0.5" y="0.5" width="21" height="21" rx="5.5" fill="var(--surface-3)" stroke="var(--line-strong)" />
      <rect x="7" y="5" width="8" height="12" rx="1.5" fill="var(--accent)" opacity="0.9" />
      <path d="M4 14.5 L8 12 L11 13 L14.5 8.5 L18 7" fill="none" stroke="var(--ink)" strokeWidth="1.6"
            strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
