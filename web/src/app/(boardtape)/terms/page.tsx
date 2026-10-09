import type { Metadata } from "next";

export const metadata: Metadata = { title: "Terms of use" };

export default function TermsPage() {
  return (
    <article className="doc max-w-3xl">
      <h1>Terms of use</h1>
      <p><em>Draft. To be reviewed before public launch.</em></p>
      <h2>Informational use only</h2>
      <p>
        Boardtape presents historical stock performance during directors&rsquo; board tenures. It is not investment
        advice, and tenure returns do not imply that any director caused a company&rsquo;s performance.
      </p>
      <h2>Automated access</h2>
      <p>
        You may browse the site and use the public API within its published rate limits. Bulk downloading,
        systematic scraping, or reproducing a substantial part of the compiled dataset requires written permission.
        Requests that exceed rate limits are throttled.
      </p>
      <h2>Accuracy</h2>
      <p>
        We cite a source for every board date and flag uncertainty instead of guessing, but errors are possible.
        Check the linked filing before relying on any fact.
      </p>
    </article>
  );
}
