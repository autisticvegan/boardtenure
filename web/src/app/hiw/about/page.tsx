import type { Metadata } from "next";

export const metadata: Metadata = { title: "How we know" };

export default function About() {
  return (
    <article className="max-w-[720px] space-y-5 text-[15px] leading-7 text-ink-2">
      <h1 className="text-[36px] leading-[40px] font-extrabold tracking-[-0.03em] text-ink">How we know</h1>
      <p>Everything on this site comes from companies&apos; own filings with the SEC. Nothing is estimated from news,
        and nothing is our opinion of anyone&apos;s performance.</p>
      <h2 className="text-[20px] leading-7 font-bold text-ink">Pay and shareholder returns</h2>
      <p>Since the 2022 proxy season, US companies have had to publish a &ldquo;pay versus performance&rdquo; table in their proxy
        statement: the CEO&apos;s reported pay for each recent year, the same pay with stock awards re-valued at year-end
        prices (&ldquo;compensation actually paid&rdquo;), and what $100 invested in the company at the start of the table
        would be worth at the end of each year. Companies tag those figures in machine-readable form; we read every
        company&apos;s figures from the SEC&apos;s XBRL data, then open the proxy behind each case we name and check that every
        figure shown is in that filing.</p>
      <p>&ldquo;Reported pay&rdquo; is the Summary Compensation Table total: salary, bonus, stock and option awards at their
        value when granted, incentive pay and other compensation. A large grant counts in full in the year it&apos;s
        made. Years with two CEOs, and companies that tag the CEO by name, are tagged per person; we read those
        figures from the proxy itself, and where more than one person was CEO in a year, &ldquo;CEO pay&rdquo; combines them.</p>
      <p>Tagged figures can carry the wrong scale: a company that tags dollars as thousands reports every figure
        1,000 times too large. Where every year&apos;s average for the other executives is above $100 million, or every
        CEO figure is under $1,000, the company is held out of the lists and statistics until checked by hand.</p>
      <p>A few companies don&apos;t tag the table in a way the SEC&apos;s data captures, so they&apos;re missing from the
        screen; among the largest are Intel and Tesla, which Boardtape covers by hand from their proxies.</p>
      <h2 className="text-[20px] leading-7 font-bold text-ink">The raise</h2>
      <p>For year-to-year changes we open every screened company&apos;s latest pay-versus-performance proxy and read who
        the CEO was each year from the filing&apos;s own tags. Only back-to-back years with the same CEO for both full
        years count, a new CEO&apos;s first year isn&apos;t used as the starting year, and pay under $100,000 is left out.
        The stock&apos;s return for a year comes from the same table&apos;s $100 figures. Boardtape publishes the full
        test, including standard errors and the same comparison against the year before.</p>
      <h2 className="text-[20px] leading-7 font-bold text-ink">Exit pay and careers</h2>
      <p>Golden parachutes and failing-up cases are researched filing by filing: separation agreements, 8-K
        announcements, the proxy after a departure, each company&apos;s own stock-performance tables. Every number is
        quoted from a filing and the quote is machine-checked against it.</p>
      <h2 className="text-[20px] leading-7 font-bold text-ink">What these numbers don&apos;t say</h2>
      <p>A falling stock has many causes: markets, industries, decisions made before a person arrived. We show what
        shareholders got while a person was paid; we don&apos;t claim that person caused it. Where a company&apos;s own peer
        group fell too, we show that alongside. For the statistics of what boards and executives can be shown to
        affect, see Boardtape.</p>
    </article>
  );
}
