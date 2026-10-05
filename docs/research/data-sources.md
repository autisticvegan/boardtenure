# Data sources: board data, EOD prices, benchmarks

Researched **2026-10-04**. Every URL below was read that day unless noted otherwise. Vendor terms are paraphrased, not quoted, so check the linked page before relying on any wording. This is a reading of published terms, not legal advice; get counsel and **written vendor confirmation** before monetizing.

## TL;DR

- **Board data: use SEC EDGAR only for the MVP.** It's free, and SEC says its content may be redistributed without permission. Fair access is 10 req/s with a declared User-Agent.
  - Forms 3/4/5 XML give a stable person ID (owner CIK) and a director flag across every issuer since mid-2003.
  - 8-K Item 5.02 and 5.07 give appointment and departure dates.
  - DEF 14A gives "director since", committees and chair roles.
  - Nothing about directors is XBRL-tagged.
- **Form 3 `periodOfReport` is a good start date only for post-IPO appointments.** It's wrong for:
  - IPO cohorts (every pre-IPO director files at the IPO date);
  - officers who later join the board (no new Form 3);
  - the 2026-03-18 foreign-private-issuer cohort.
- **Prices: no cheap individual plan permits a public site.**
  - The cheapest published display licence is Tiingo "EOD + IEX Redistribution" at **$250/mo** (startups) or $500/mo (enterprise). Its terms explicitly allow publishing derived percentage returns that can't be reverse-engineered.
  - Next: Intrinio Startup ($333 → $666 → $999/mo, display rights), Twelve Data Venture ($499/mo), Massive (ex-Polygon) Business ($2,499/mo).
  - The best coverage is Sharadar via Nasdaq Data Link: from 1998, survivorship-free, permaticker, total-return adjusted close, corporate-actions table. Its display or distribution licence is **quote-only**.
- **A normalized daily performance chart counts as displaying price data under most licences**, because the prices can be recovered from it. A single tenure-return % or excess-return number generally counts as "derived data".
- **Benchmark: SPY total return** (dividend-adjusted close) from the licensed price vendor, labelled as "SPY (S&P 500 ETF)".
  - Index levels (S&P DJI, Nasdaq, FTSE Russell) need paid licences even at end of day.
  - FRED's SP500 series says reproduction needs S&P's permission and only covers 10 years.
- **Unusable for a public or monetized site:**
  - Yahoo/yfinance, Stooq, Norgate, Alpaca, nasdaq.com downloads;
  - CRSP via WRDS (academic only);
  - Sharadar's direct personal plans;
  - the free or individual tiers of every vendor.
  - The local prototype price files already in `data/raw/prices/{nasdaq,stooq,yahoo}` are fine for exploration but must not ship (see `price-data-verification.md`).

---

## 1. SEC EDGAR (primary source for board data)

### 1.1 Endpoints and what each is for

| Endpoint | What it gives | Role in the pipeline |
|---|---|---|
| `data.sec.gov/submissions/CIK##########.json` | Per-filer metadata and filing list: accession, form, filingDate, reportDate, **`items`** (8-K item numbers), primaryDocument, total submission size. The "recent" array holds at least 1 year or 1,000 filings; older pages are in `filings.files[]`. Typical processing delay is under a second. No key, no CORS. [S1] | **Incremental poller for tracked issuers.** `items` finds 8-K Item 5.02 and 5.07 filings without opening them.<br>Also works for **reporting-owner CIKs**: a director's own CIK lists every Form 3/4 they filed. Verified with Ben Minicucci (CIK 1451455), who has Form 3s for Alaska Air (2008, as EVP/COO), PG&E (2018, director) and Lyft (2026, director). This is the hook for cross-board track records. |
| `Archives/edgar/daily-index/bulkdata/submissions.zip` | Every filer's submissions JSON, rebuilt nightly (~3 a.m. ET) [S1]. **1.57 GB** (HEAD on the 2026-10-03 build). | One-time backfill of the filing universe. Switch to incremental polling afterwards. |
| Filing folders: `Archives/edgar/data/{cik}/{acc}/index.json` | Document list per filing. | Locate raw XML and HTML. For Forms 3/4, submissions `primaryDocument` points at the XSL rendering (`xslF345X06/…xml`). Drop that prefix to get the raw XML. |
| `daily-index/` and `full-index/` (form, company and master `.idx`) | Every accepted filing by form type. Daily indexes are built nightly from about 10 p.m. ET and are "usually completed within a few hours". [S2] | **Universe-wide daily detection** of `3`, `3/A`, `4`, `8-K`, `8-K/A`, `DEF 14A`, `DEFA14A` and `DEFR14A`.<br>Ownership forms appear once per associated CIK (issuer and each owner), so dedupe by accession. Each quarter's `form.gz` is about 4–5 MB. |
| Latest-filings Atom feed: `cgi-bin/browse-edgar?action=getcurrent&type=…&output=atom` | Filterable by form, CIK and ownership. [S3] | Optional intraday detection. The daily index is simpler and complete. |
| Full-text search, and its JSON backend `efts.sec.gov/LATEST/search-index` | All filings "since 2001", including exhibits; phrase, boolean and NEAR queries; filters by form, date and CIK. [S4] | Discovery and counting (see §5). Backfill of historical director events.<br>The JSON backend is **undocumented**: hits are per document (not per filing), totals cap at `10000 (gte)`, and `_source.items` carries the 8-K items. Not a production dependency. |
| **Insider Transactions Data Sets** (quarterly zip, about 11 MB) | Flattened, tab-delimited Forms 3/4/5 and amendments, "as filed", from Jan 2006 to Jun 2026 (latest is `2026q2_form345.zip`).<br>Tables: SUBMISSION, REPORTINGOWNER, NONDERIV_TRANS, NONDERIV_HOLDING, DERIV_TRANS, DERIV_HOLDING, FOOTNOTES, OWNER_SIGNATURE. [S5][S6] | **Cheapest historical backfill** of every director relationship since 2006.<br>Lags up to a quarter, so pair it with daily XML parsing. |
| `files/company_tickers.json`, `company_tickers_exchange.json` | Current CIK ↔ ticker ↔ exchange. | Join issuers to vendor tickers for **active** names only. Delisted mappings must come from the price vendor. |

**Scale check** from the 2026 Q2 data set, computed locally:
- 56,102 Form 3/4/5 submissions.
- **21,216 distinct owner CIKs flagged Director, across 4,483 issuers.** The active Section-16 director universe is roughly 20–25k people. A cumulative 100k+ since 2003 is plausible but wasn't measured.
- `RPTOWNER_RELATIONSHIP` is **comma-joined** in practice (e.g. `Director,Officer`, `Director,TenPercentOwner`), not a single enum.
- 375 director-flagged CIKs have entity-like names (LLC, LP, Fund, Capital…). These need filtering.

**Coverage gaps:**
- Electronic Forms 3/4/5 were mandated only from **2003-06-30** [S7]. There is no Section 16 XML before that, and the flat data sets start in 2006.
- Pre-2003 tenures need proxy-statement text (EDGAR's electronic filing phase-in finished in 1996) or a commercial source.
- Foreign-private-issuer boards are absent before 2026 (see pitfall 5 below).

### 1.2 Forms 3/4/5: fields that matter

Checked against Lyft filings (schema `X0206` in 2019, `X0607` in 2026) and the data-set readme [S6].

| XML element | Data-set column | Use and notes |
|---|---|---|
| `documentType` | `DOCUMENT_TYPE` | `3` is the initial statement; `4`/`5` are changes; `/A` marks amendments. |
| `periodOfReport` | `PERIOD_OF_REPORT` ("Date of event requiring statement") | For Form 3, the candidate **director start date**. Filer-typed. |
| (header) | `FILING_DATE`, `DATE_OF_ORIG_SUB` | Lateness check: Form 3 is due within 10 days. |
| `issuer/issuerCik`, `issuerTradingSymbol`, new `issuerForeignTradingSymbol` | `ISSUERCIK`, `ISSUERTRADINGSYMBOL` | Join on CIK. The ticker is filer-typed. |
| `reportingOwnerId/rptOwnerCik`, `rptOwnerName` | `RPTOWNERCIK`, `RPTOWNERNAME` | **Person key across boards.** Names are stored "LAST FIRST", e.g. `MINICUCCI BENITO` vs the 8-K's "Ben Minicucci", so name-matching to proxies must be fuzzy. |
| `reportingOwnerRelationship/isDirector`, `isOfficer`, `officerTitle`, `isTenPercentOwner`, `isOther`, `otherText` | `RPTOWNER_RELATIONSHIP`, `RPTOWNER_TITLE`, `RPTOWNER_TXT` | Booleans appear as `1/0` (older filings) or `true/false` (newer), and **absent elements mean false**: PG&E's 2018 XML had only `isDirector`.<br>The readme says the title is required for 'DIRECTOR'; it almost certainly means OFFICER. |
| `noSecuritiesOwned` | `NO_SECURITIES_OWNED` | New independent directors often hold nothing (Minicucci: `1`). The Form 3 is still required. |
| `notSubjectToSection16` (4/5) | `NOT_SUBJECT_SEC16` | Rare. Not a reliable exit signal. |
| `remarks`, `footnotes` | `REMARKS`, FOOTNOTES | "Director by deputization", fund structures, power-of-attorney notes. |

**How reliable Form 3 `periodOfReport` is as a director start date.** Post-IPO appointments line up exactly:
- Deborah Hersman: the 8-K says she was appointed 2026-01-25; her Form 3 `periodOfReport` is 2026-01-25, filed 01-27.
- Ben Minicucci: 8-K 2026-07-23; Form 3 2026-07-23, filed 07-27.

The systematic failure modes:

1. **IPO cohort.** For an issuer registering under §12 for the first time, Form 3 is due no later than the registration statement's effective date [S8]. Lyft has **14 Form 3s dated 2019-03-28**, its IPO.
   - Ann Miura-Ko (an early-stage Lyft director) and Sean Aggarwal (2026 proxy: "Director Since 2016") both show 2019-03-28.
   - Rule: if `periodOfReport` falls within about 10 days of the first registration, treat it as "on or before". Take the real start from the S-1/424B4 or the first DEF 14A. The same applies to de-SPACs and direct listings.
2. **One Form 3 per person per issuer.** An officer or 10% owner who later joins the board files no new Form 3; the change only shows as `isDirector` flipping in later Form 4s.
   - Minicucci was an Alaska Air officer from 2008 and joined its board in 2020 with no new Form 3.
   - Lyft's David Risher went the other way: director in 2021, CEO in 2023.
   - Founders and CEOs are the usual case.
3. **Late or mistyped filings.** The 10-day deadline [S8] is often missed, and `periodOfReport` is free text from the filer. Cross-check against the 8-K 5.02 date.
4. **Funds and 10% owners.** VC/PE entities check Director, Other ("director by deputization") or only 10% Owner, and filer practice varies [S9]. Filter to natural persons before calling a CIK a director.
5. **Foreign private issuers, new in 2026.** The Holding Foreign Insiders Accountable Act put FPI directors and officers under §16(a) from **2026-03-18**. That creates another mass cohort of Form 3s dated around 2026-03-18.
   - There is SEC exemptive relief for insiders of FPIs in qualifying jurisdictions. As of May 2026: Canada, UK, EEA, Switzerland, Korea, Chile, Australia, India and Singapore. [S10][S11]
   - Form 3 was revised to SEC 1473 (03-26) and now names FPI directors [S8].
6. **No exit filing.** Departures are never reported on Forms 3/4/5. End dates must come from 8-K 5.02(b), 8-K 5.07 or the next proxy.
7. **Re-joining** produces a second Form 3, which marks a new tenure.

### 1.3 8-K Item 5.02 and 5.07; DEF 14A

- **Item 5.02** must be filed within four business days. [S12]
  - Under (b), a director who "retires, resigns, is removed, or refuses to stand for re-election" triggers a filing giving the event and its date.
  - Under (d), electing a new director "except by a vote of security holders at an annual meeting" triggers a filing giving name, date and committees.
  - **Directors first elected at an annual meeting get no 5.02.** Their start date is the meeting date, from 5.07 or the proxy.
  - A "won't stand for re-election" 5.02 is filed when notice is given, but the tenure ends at the meeting, so capture both dates.
  - Many 5.02s concern officers or compensation only.
- **Item 5.07** reports per-nominee vote results. It confirms who was elected and on what date, and catches failed elections and holdover directors.
- **DEF 14A.** Lyft's 2026 proxy has a "Class | Age | Position | Director Since | Current Term Expires" table, committee footnotes, chair and lead-independent-director history ("Lead Independent Director from April 2023 to August 2025"), and other public boards in each bio.
  - "Director since" is usually **year-only** and may include pre-IPO or predecessor service. Use it as a lower bound.
- **XBRL tagging of directors: effectively none.**
  - The ECD taxonomy tags Pay-versus-Performance, but `ecd:PeoName` is the CEO only. Lyft's 2026 DEF 14A has 5 PeoName facts and no director facts.
  - It also tags `ecd:InsiderTrdPoliciesProcAdoptedFlag`.
  - Item 408(a) 10b5-1 plan disclosures in 10-K/10-Q use `ecd:TrdArrIndName` / `ecd:TrdArrIndTitle` with members on `ecd:IndividualAxis` [S13]. These name a director only when they adopt or terminate a trading plan.
  - The `dei` cover-page taxonomy has no director data.
  - The director roster, committees, "director since" and the director-compensation table are untagged HTML.

### 1.4 Fair access and usage rights

- **Rate limit:** no more than 10 requests per second in total across all your machines. Unclassified bots are not allowed. IPs over the limit are throttled until they stay under it for 10 minutes. [S14]
- **Headers:** a declared `User-Agent` (company name plus admin email) and `Accept-Encoding: gzip, deflate`. [S2]
- **Our budget:** stay at or below 5 rps. Polling 10k submissions JSONs takes about 35 minutes at that rate, so prefer the daily index plus targeted fetches.
- **Usage rights:** SEC states that information on sec.gov is public and may be copied or redistributed without its permission. It asks for attribution and prohibits use of the SEC seal and logos. [S14]
  - The extracted facts (names, dates, roles) aren't copyrightable.
  - Don't republish filer artwork or photos from proxies.
  - The data sets carry an accuracy disclaimer. [S6]

**SEC sources:**
- [S1] https://www.sec.gov/search-filings/edgar-application-programming-interfaces
- [S2] https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data
- [S3] https://www.sec.gov/about/rss-feeds
- [S4] https://www.sec.gov/edgar/search/efts-faq.html
- [S5] https://www.sec.gov/data-research/sec-markets-data/insider-transactions-data-sets
- [S6] https://www.sec.gov/files/insider_transactions_readme.pdf
- [S7] https://www.sec.gov/rules/final/33-8230.htm
- [S8] Form 3 instructions 2(a)–(b), SEC 1473 (03-26): https://www.sec.gov/files/form3.pdf
- [S9] https://www.paulhastings.com/insights/client-alerts/sec-reporting-obligations-under-section-13-and-section-16-of-the-exchange (filer practice observed in EDGAR Form 4s)
- [S10] https://www.skadden.com/insights/publications/2026/03/sec-insider-reporting-requirements-for-directors-and-officers
- [S11] https://www.gibsondunn.com/to-be-exempt-or-not-to-be-certain-foreign-private-issuer-directors-and-officers-section-16a-reporting-begins-march-18-2026/
- [S12] Form 8-K instructions and Item 5.02, SEC 873 (02-25): https://www.sec.gov/files/form8-k.pdf
- [S13] https://xbrl.sec.gov/ecd/2025/ecdtaxonomyguide-2025-03-17.pdf
- [S14] https://www.sec.gov/privacy

---

## 2. Daily (EOD) stock price providers

### 2.1 Raw prices vs derived metrics

What we'd show is (a) tenure total return % and excess return vs the benchmark, and (b) normalized daily charts (stock and benchmark rebased to 100).

- **(a) is "derived data" under most definitions:**
  - **Tiingo** ToS §1.6(c) permits derived products, explicitly including percentage returns and growth rates, without approval. The product must not substitute for Tiingo data and must not let anyone reverse-engineer it. Charts or tables that display the data, and simple transformations such as adjusting, are excluded.
  - **Twelve Data** §2.2(c) and **Nasdaq Data Link** §1.2 use the same non-reversible test.
  - NDL still bars distributing derived data outside your organization without an Order Form.
- **(b) is very likely "display of the data":** a rebased series is price ÷ constant, so one known price recovers the whole series.
  - Intrinio's licensing guide treats reconstructable output as the original data.
  - Sharadar's terms ban derivatives that allow reverse engineering.
  - Massive says published charts and tables count as redistribution on individual plans.
- **Some vendors restrict derived data outright:**
  - **FMP** ToS §2.6.1 bars giving third parties anything "derived from" FMP data.
  - **Alpha Vantage** treats making data accessible to others, directly or indirectly, as commercial use.
  - **Yahoo** bans derivative works.
- **Design lever:** an MVP that shows only tenure-level statistics is the most defensible on a cheap licence. Charts need a display or redistribution tier. **Get written confirmation of the exact UI from the vendor.**
- **Exchange fees for EOD:** the UTP plan (Nasdaq-listed securities) says end-of-day usage is currently not fee-liable (search snippet of https://www.utpplan.com/DOC/datapolicies.pdf). Twelve Data says EOD needs no extra licensing, and Massive Business advertises no exchange fees. The CTA/NYSE EOD policy was **not verified**.

### 2.2 Comparison table

| Provider | Cheapest dev tier | Public-display tier & price | Derived-data stance | US EOD history | Delisted / permanent ID | Adjustments & corporate actions | Limits / bulk | Verdict |
|---|---|---|---|---|---|---|---|---|
| **Tiingo** | Free: 50 req/h, 1k/day, 500 symbols/mo, no storage. Power $30/mo. Commercial $50/mo ($499/yr), internal only | **"EOD + IEX Redistribution": $250/mo startups, $500/mo enterprise.** Requires the "Data sourced by Tiingo" link | **Explicit carve-out for % returns** (§1.6(c)); charts excluded | 1962; 80k+ tickers | Only if the symbol wasn't reused; no permaticker on EOD; infer delisting from end date in `supported_tickers.zip` | `adjClose` split+dividend (CRSP-style), `divCash`, `splitFactor`; no spin-off or ticker-change feed | Power 10k/h, 100k/day; no all-tickers-by-date endpoint | **Cheapest legal display path.** Weak on old and reused-ticker delisted names. Must delete data on cancel |
| **Massive** (Polygon.io renamed 2025-10-30) | Basic free (2 yrs, 5/min); Starter $29; Developer $79; Advanced $199 (20+ yrs). All "individual use only" | **Stocks Business $2,499/mo** (startups 25%+ off year 1), "no exchange fees" | Business covers price and % changes; on individual plans, charts count as redistribution and testers count as viewers | **2003-09-10** | Yes: `active=false`, `delisted_utc` (reportedly sometimes missing), ticker events | **Split-only**; compute total return from the dividends endpoint | Unlimited on paid plans; grouped daily (all tickers per date); flat files | Too expensive; history too short |
| **EODHD** | Free 20 calls/day; EOD All World $19.99/mo ($199/yr); 100k/day, 1k/min | Internal use $399/mo (no display); Enterprise $2,499/mo or Custom from $399; **display not stated, contact sales** | Not addressed; personal T&C bar repackaged display | 1962 (oldest) | Yes (`delisted=1`, `_old` suffix for reused tickers); **pre-2018 delisted = prices only** | `adjusted_close` split+dividend; splits, dividends, symbol changes | Bulk exchange-day = 100 calls | Good cheap dev data; display price unknown |
| **Financial Modeling Prep** | Free 250/day (5 yrs); Starter $29 ($19 annual); Premium $69 ($49 annual, 30+ yrs); Ultimate $139 ($99 annual, bulk) | **Enterprise only, contact sales**; display agreement required even for free sites | **Restricts "derived from"** (§2.6.1) | 30+ yrs | Delisted list; survivorship endpoint is legacy; gaps | Split default; dividend-adjusted endpoint; symbol changes | 300–3,000/min plus bandwidth caps; `eod-bulk` | **Avoid**: derived clause, deletion agreement, must disclose storage IPs |
| **Alpha Vantage** | Free 25/day; premium $49.99–$249.99/mo (75–1,200 req/min) | **Contact sales**; ToS personal/non-commercial | "Directly or indirectly" wording likely covers derived | 20+ yrs | Delisted list only from 2010; price coverage unconfirmed | `TIME_SERIES_DAILY_ADJUSTED` split+dividend | No EOD bulk | **Avoid** |
| **Twelve Data** | Free 8/min; Grow $79; Pro $229; Ultra $999 (personal) | **Venture $499/mo ($4,990/yr)**, external display (raw feeds and APIs excluded); Enterprise $1,099/mo | §2.2(c) allows derived output if non-reversible | 1980 | Delisted symbols listed; **price history unconfirmed** | `adjust=all\|splits\|dividends\|none` (default splits) | Credits/min by tier | Viable, but §2.3(g) **limits storing/caching** (conflicts with keeping history). Page metadata shows a stale $149 price |
| **Alpaca** | Free 200/min; $99/mo | **None**: no redistribution | n/a | 2016 | Not stated | raw/split/dividend/spin-off | — | **Unusable** |
| **Sharadar** (direct, launched 2026-07-27) | Prices $9/mo (5 yrs), $19 (10 yrs), $39 (full); Bundle $69/mo or $499/yr | **None direct**: Personal Use Licence only | Bans publication and reverse-engineerable derivatives; summary statistics need no credit | Dec 1997 (~21k stocks, ~10k funds) | **~99% survivorship-free; `permaticker`**; reused ticker: the delisted company gets a numeric suffix | **`closeadj` = split + dividend + spin-off**; ACTIONS table (splits, dividends, spinoffs, ticker changes, listings/delistings, acquirers) | 10k rows/call; bulk zip | Best for personal validation only |
| **Sharadar via Nasdaq Data Link** (SEP/SFP/TICKERS/ACTIONS) | Personal licence (price behind login) | **Professional/distribution licence via Order Form: quote only** | Derived OK internally if non-reversible; external distribution needs the Order Form | 1998 | Same as above | Same | 300/10 s, 2,000/10 min, 50k/day (premium 5,000/10 min, 720k/day); bulk export | **Best coverage fit for scale.** Get a quote. New NDL T&C from 2026-11-01 |
| **Databento** | Usage-based ($125 credits); Standard $199/mo | Most historical data can be redistributed after 24 h; **reference data (corporate actions, adjustment factors) cannot be redistributed externally** | Not addressed for EOD | **~May 2018** | Point-in-time since 2018 | **Unadjusted**; adjustments sold separately | "Practically unlimited" | Too shallow |
| **Intrinio** | Individual $150/mo (no display) | **Startup: $333/mo for 6 mo → $666 for 6 mo → $999/mo, "Commercial Use and Display Rights"** (executed Order Form); Enterprise $1,250+/mo | Reconstructable output = original data; such data must be purged within 30 days of termination | 1967+ (active) | **Delisted only from 2007** (old guide, now 404) | Adjusted and unadjusted, split ratios, factors (EDI) | 300/min; no multi-ticker calls; bulk CSV/S3/Snowflake | **Viable mid-tier display path.** Says public (non-login) display costs more |
| **Norgate** | Platinum (1990+, delisted) $630/yr; Diamond (1950+) $787.50/yr | **None**: no business licensing | Derived defined, publishing not granted | 1950/1990 | Yes; `assetid` | Capital and total-return adjustment | Local Windows app | **Unusable** (single individual) |
| **Stooq** | Free | **None**: commercial use prohibited | — | Long | Undocumented (likely survivors only) | Adjusted close only | CAPTCHA, API key, JS bot check | **Unusable** |
| **Yahoo / yfinance** | Free (unofficial) | **None**: ToS bans scraping, commercial reuse and derivative works | Banned | Long (live tickers) | Mostly missing | Adjusted close (splits and dividends) | Unstable | **Unusable** |
| **CRSP** (WRDS; Morningstar owns CRSP since 2026-02-02) | WRDS academic subscription | WRDS: none (academic, non-commercial). **Commercial via Morningstar: quote only**, display terms unknown | Display or derivative works need consent | **1925** (NYSE), 1972 (Nasdaq) | **PERMNO/PERMCO; delisting returns** | Full distributions, RET/RETX | Files | Gold standard; quote needed |

**Sources (read 2026-10-04):**
- **Tiingo:** [pricing](https://www.tiingo.com/about/pricing), [EOD product page](https://www.tiingo.com/products/end-of-day-stock-price-data) (the $250/$500 redistribution tiers), [ToS (updated 2026-08-05)](https://app.tiingo.com/tos/) (§1.4(h), §1.6(b)–(c), §7.3), [symbology docs](https://www.tiingo.com/documentation/appendix/symbology), [EOD docs](https://www.tiingo.com/documentation/end-of-day).
- **Massive:** [rebrand post](https://massive.com/blog/polygon-is-now-massive), [pricing](https://massive.com/pricing), [business plans](https://massive.com/business), [display KB](https://massive.com/knowledge-base/article/which-plan-do-i-need-to-show-massive-data-in-my-app), [history KB](https://massive.com/knowledge-base/article/how-much-historical-stock-data-does-massive-have), [adjustment KB](https://massive.com/knowledge-base/article/is-massives-stock-data-adjusted-for-splits-or-dividends).
- **EODHD:** [pricing](https://eodhd.com/pricing), [commercial pricing](https://eodhd.com/commercial-pricing), [terms](https://eodhd.com/financial-apis/terms-conditions), [delisted data](https://eodhd.com/financial-apis/delisted-stock-companies-data-2), [bulk API](https://eodhd.com/financial-apis/bulk-api-eod-splits-dividends).
- **FMP:** [pricing](https://site.financialmodelingprep.com/pricing-plans), [ToS](https://site.financialmodelingprep.com/terms-of-service), [public-app article](https://site.financialmodelingprep.com/insights/platform/can-you-use-fmp-data-in-a-public-app-website-or-client-dashboard).
- **Alpha Vantage:** [premium](https://www.alphavantage.co/premium/), [ToS](https://www.alphavantage.co/terms_of_service/), [docs](https://www.alphavantage.co/documentation/).
- **Twelve Data:** [pricing](https://twelvedata.com/pricing), [business pricing](https://twelvedata.com/pricing-business), [terms](https://twelvedata.com/terms), [US equities article](https://support.twelvedata.com/en/articles/9935903-us-equities-market-data).
- **Alpaca:** [data page](https://alpaca.markets/data), [redistribution FAQ](https://alpaca.markets/support/redistribute-alpaca-api).
- **Sharadar:** [pricing](https://sharadar.com/pricing), [terms](https://sharadar.com/terms), [tickers docs](https://sharadar.com/docs/tickers), [actions docs](https://sharadar.com/docs/actions), [FAQ](https://sharadar.com/docs/faqs), [blog](https://blog.sharadar.com/).
- **Nasdaq Data Link:** [SEP](https://data.nasdaq.com/databases/SEP), [terms](https://data.nasdaq.com/terms) (JS-rendered; read via search excerpts).
- **Databento:** [pricing](https://databento.com/pricing), [equities](https://databento.com/equities), [adjustment factors](https://databento.com/blog/adjustment-factors).
- **Intrinio:** [pricing](https://intrinio.com/pricing), [terms (updated 2026-09-03)](https://about.intrinio.com/terms), [licensing guide](https://intrinio.com/blog/market-data-licensing-guide-for-fintechs).
- **Norgate:** [packages](https://norgatedata.com/stockmarketpackages.php), [EULA](https://norgatedata.com/subscribe/eula.php), [FAQ](https://norgatedata.com/faq.php).
- **Stooq:** https://stooq.com/db/h/ (per search excerpt; the site blocked automated fetches).
- **Yahoo:** [ToS (2025-05-06)](https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html), [yfinance](https://ranaroussi.github.io/yfinance/).
- **CRSP:** [Morningstar acquisition](https://newsroom.morningstar.com/news/news-details/2026/Morningstar-Completes-Acquisition-of-CRSP-and-Extends-Relationship-with-Vanguard/default.aspx), [CRSP product page](https://indexes.morningstar.com/research-data-products/crsp-us-stock-databases), [WRDS ToU (2026-08-25)](https://wrds-www.wharton.upenn.edu/users/tou/).
- **nasdaq.com** web downloads: Nasdaq's site notices restrict copying to personal, non-commercial use ([datastore copyright](https://datastore.nasdaq.com/copyright.aspx)). The nasdaq.com Terms of Use page itself was not located.

**The delisted-coverage problem is the real constraint.** A director's track record includes boards of companies acquired or delisted long ago. Only Sharadar/NDL (1998+), CRSP (1925+) and Norgate (personal only) document survivorship-free coverage before about 2007–2015, with permanent IDs.
- **Tiingo:** misses reused symbols, and a staff post put delisted coverage at roughly 2015+ (unverified).
- **Intrinio:** delisted from 2007.
- **Massive:** from 2003.
- **EODHD:** prices only before 2018.

Every tenure needs a "price data unavailable" state.

---

## 3. Benchmarks

**Index-level data needs a licence even at end of day:**
- **S&P DJI:** displaying or deriving from its index data requires a licence. S&P DJI licenses EOD, historical and derived data itself; CME licenses real-time and delayed.
  - [S&P DJI data & index licensing](https://www.spglobal.com/spdji/en/about-us/data-index-licensing)
  - [S&P Global terms of use](https://www.spglobal.com/en/terms-of-use) §4.2 (403 to us; read via search snippets)
  - [CME licensing FAQ](https://www.cmegroup.com/education/sp-indices-and-dow-jones-indices-licensing-faq.html) (timed out; snippet only)
  - The only public price point found: Cboe's 2021 notice charged a "Delayed Open Website" fee for EOD index data on unprotected sites. It was $300/mo under 1M views ($750 and $1,200 at higher tiers) plus a $1,900/yr admin fee. [Cboe notice](https://cdn.cboe.com/resources/fee_schedule/2021/CSMI-2021-Fee-Change-Notice-9-30-20.pdf). Current pricing is "contact for quote".
- **Nasdaq (GIDS):** since 2024-08-01, recipients of EOD or historical index data must license directly, and redistribution needs prior approval. [Nasdaq Data News DN2024-5](https://www.nasdaqtrader.com/TraderNews.aspx?id=DN2024-5). Current fees aren't public.
- **FTSE Russell:** sales-only. [LSEG subscribe page](https://www.lseg.com/en/ftse-russell/index-resources/indices-subscribe-data)
- **FRED is not a workaround.**
  - `SP500` carries an S&P DJI copyright notice requiring prior written permission for reproduction, covers only about 10 years (2016-10-03 to 2026-10-02), and is price-only, not total return. [FRED SP500](https://fred.stlouisfed.org/series/SP500)
  - `NASDAQCOM` is copyrighted by Nasdaq and needs pre-approval.
  - Russell series were removed from FRED in 2019. [FRED notice](https://fred.stlouisfed.org/news/2019/09/russell-data-to-be-removed-from-fred)
  - FRED's API terms require the owner's permission for any non-personal use of third-party series. [FRED API terms](https://fred.stlouisfed.org/docs/api/terms_of_use.html)

**ETF proxies.** ETF prices are exchange last-sale data covered by your price-vendor licence, not index data.

| ETF | Tracks | Expense ratio | Inception | Source |
|---|---|---|---|---|
| SPY | S&P 500 | 0.0945% (includes 0.0301% S&P licence fee) | 1993-01-22 (trading 1993-01-29) | [prospectus 2026-01-26](https://fundcompli.rightprospectus.com/documents/SSgA/PRO_SPDRSP500ETF.pdf) |
| IVV | S&P 500 | 0.03% | 2000-05-15 | [iShares](https://www.ishares.com/us/products/239726/ishares-core-sp-500-etf) |
| VOO | S&P 500 | 0.03% | 2010-09-07 | [Vanguard](https://advisors.vanguard.com/investments/products/voo/vanguard-sp-500-etf) (snippet) |
| QQQ | Nasdaq-100 (not the Composite) | 0.18% (converted from a UIT to an open-end fund around 2025-12-22) | 1999-03-10 | [Invesco](https://www.invesco.com/qqq-etf/en/home.html), [etf.com](https://www.etf.com/sections/features/invesco-wins-approval-convert-qqq-standard-etf) |
| ONEQ | Nasdaq Composite | 0.21% (third-party) | 2003-09-25 (third-party) | [stockanalysis](https://stockanalysis.com/etf/oneq/) |
| IWM | Russell 2000 | 0.19% | 2000-05-22 | [iShares](https://www.ishares.com/us/products/239710/ishares-russell-2000-etf) |
| XL* sector SPDRs | S&P sector indexes | 0.08% | Most 1998-12-16; XLRE 2015, XLC 2018 | [SSGA XLK](https://www.ssga.com/us/en/intermediary/etfs/the-technology-select-sector-spdr-fund-xlk) |

**Methodology:**
- **Use total return on both sides:** split- and dividend-adjusted closes for the stock and the ETF. A price-only benchmark understates the S&P 500 by roughly the dividend yield (1.15–2.2%/yr over 2010–2025, per the SPY prospectus).
- **SPY tracking drag:** SPY holds dividends in a non-interest-bearing account until paid out, doesn't reinvest them, and doesn't lend securities. Its 10-year return to 2025-12-31 was 14.66%/yr at NAV vs 14.82% for the index, about 16 bp/yr (prospectus).
- **Adjusted close vs fund-reported total return:** vendor adjusted closes reinvest at the ex-date close, while fund-reported total return reinvests at payment-date NAV. The difference is small, but say which one you use.
- **Spin-offs** are where vendor adjustments disagree most, so spot-check them.

**Recommendation:**
- Default to **SPY total return** for every tenure. It has the longest ETF history (1993), and one consistent series beats splicing SPY, IVV and VOO.
- Mark tenures that start before 1993-01-29 "benchmark n/a", or clip them.
- Offer IVV or VOO as a lower-fee cross-check.
- Secondary benchmarks: IWM, ONEQ (or QQQ, labelled Nasdaq-100) and sector SPDRs. Map companies to sectors with **SEC SIC codes**, because GICS is licensed S&P/MSCI data.
- Ken French market returns are CRSP-derived and carry no published licence, so avoid them.
- Note that Sharadar's fund table (SFP) starts in Dec 1997, so SPY from Sharadar only covers 1997 onward.
- **Label** something like: "Benchmark: SPY (an S&P 500 ETF), total return with dividends reinvested, after the fund's 0.0945% expenses." Add a trademark and no-affiliation notice. Use no index logos, and never call it "the S&P 500 return".

---

## 4. Board and people data beyond SEC

| Source | Coverage | Cost (public info) | Public display / redistribution |
|---|---|---|---|
| **BoardEx** (Altrata) | 1.7M people, 2.2M+ organizations, weekly updates. Strongest cross-board history | Not public. Academic about $18k/yr US-only or $35k/yr all regions ([old forum post](https://www.econjobrumors.com/topic/boardex-academic-subscription-price)); "$25k+" for small firms per a competitor ([Talentis](https://www.talentis.global/recruitment-software/beyond-linkedin-and-boardex-finding-senior-executives/)) | Bespoke; unlikely for a small public site ([FAQ](https://www.boardex.com/faqs/)) |
| **Equilar BoardEdge** | 2.5M+ profiles | About $10k/yr SMB to $80–86k/yr enterprise, across all Equilar products ([SpendHound](https://www.spendhound.com/marketplace/equilar-pricing)) | Not published |
| **ISS STOXX Director Data** | About 150 fields per director; WRDS legacy data covers the S&P 1500 from 1996 | On request | No redistribution without written permission ([ISS](https://www.issgovernance.com/esg/raw-data/director-data/)) |
| **MSCI** (ESG Governance) | Historical GMI director set covered about 3k US companies, 2001–2018, and is discontinued ([Stanford](https://gsb-research-help.stanford.edu/library/faq/301064)) | Not public | Not published |
| **S&P Capital IQ Professionals** | 30.5M profiles, from 1992 ([marketplace](https://marketplace.spglobal.com/en/datasets/professionals-(23))) | About $57k/yr median across all S&P Global contracts ([Vendr](https://www.vendr.com/marketplace/sandp-global), snippet) | Bespoke |
| **FactSet People** | About 4M people (around 2018 figure) ([FactSet](https://insight.factset.com/resources/at-a-glance-factset-people-datafeed)) | Not public | Bespoke |
| **LSEG Officers & Directors** | 2.9M people; US from 1998 ([LSEG](https://www.lseg.com/en/data-catalogue/company-data/officers-directors/officers-directors)) | Not public | Bespoke |
| **Wikidata** | **CC0** ([licensing](https://www.wikidata.org/wiki/Wikidata:Licensing)). Live check on 2026-10-04: only about 4% (170 of 4,161) of NYSE/Nasdaq-listed items have any P3320 board-member statement. Lyft has none, and its CEO (P169) is stale. Mega-caps are partly covered but stale (Apple still lists directors who retired in 2024) | Free | Allowed (CC0). Use for ID linking only, not as truth |
| **LittleSis** | Sparse (Lyft: 1 board relationship) | Free | **CC BY-SA 4.0**: share-alike would attach to our database. Avoid |
| **OpenCorporates** | State-registry officers, not public-company boards | £2,250–£12,000/yr API ([pricing](https://opencorporates.com/pricing/)) | ODbL (share-alike) unless paid. Not useful here |
| **OpenSecrets** / **Crunchbase** | — | — | CC BY-NC-SA, API discontinued 2025-04-15 ([Bellingcat](https://bellingcat.gitbook.io/toolkit/more/all-tools/opensecrets)) / display banned unless the order form allows it ([Crunchbase terms](https://data.crunchbase.com/docs/terms)) |
| **Company IR pages** | Current board only | Free | Facts aren't copyrightable, but check site terms before scraping |

**Recommendation: SEC-only for the MVP, and probably at scale.** Commercial vendors are $10k–$85k+/yr, and public-display rights are a separate negotiation that is unlikely to succeed for a small product. Revisit BoardEx only if pre-2003 history or non-SEC boards become core features.

---

## 5. Document sizes and filing volumes (for LLM-extraction estimates)

Measured locally. Visible text was extracted with an HTML parser that drops `<script>`, `<style>`, `ix:header` and `display:none` content, collapses whitespace, and flattens tables with " | ". Tokens are estimated as chars ÷ 4.

| Document | Raw HTML chars | Visible-text chars | Words | ≈ tokens (text) | ≈ tokens (raw HTML) |
|---|---|---|---|---|---|
| **Lyft DEF 14A**, filed 2026-04-10 (`0001628280-26-024680`, `lyft-20260410.htm`) | 1,100,029 | **295,648** | 47,476 | **~73.9k** | ~275k |
| ↳ "Board of Directors and Corporate Governance" section only | — | 39,576 | — | ~9.9k | — |
| ↳ same, plus Director Compensation | — | 51,987 | — | ~13.0k | — |
| ↳ director table plus nominee bios | — | 15,397 | — | ~3.8k | — |
| **Lyft 8-K, Item 5.02 only** (2026-07-27, Minicucci appointment, `lyft-20260723.htm`) | 26,435 | **5,797** | 911 | **~1.4k** | ~6.6k |
| Lyft 8-K, Item 5.02 only (2026-01-27, Hersman appointment) | 25,600 | 5,330 | 847 | ~1.3k | ~6.4k |
| Lyft 8-K, Items 5.02, 7.01 and 9.01 (2026-09-09) | 42,872 | 15,891 | 2,491 | ~4.0k | ~10.7k |

**Notes on the sizes:**
- About 78% of an 8-K's raw HTML is markup, mostly inline CSS and tags; the `ix:header` itself is only about 2%. Always convert to text before sending it to an LLM.
- Slicing the board section out of a proxy cuts input about 6×.
- The submissions-JSON `size` (6.6 MB for this DEF 14A) is the whole submission including images and XBRL, so don't use it for estimates.
- The 2026 proxy is Lyft's latest. Its 2025 proxy was a contested `DEFC14A`. Mega-cap proxies may be larger; that wasn't measured.

**Annual volumes across all SEC registrants.** Calendar 2025 counts come from the four quarterly `full-index/2025/QTR*/form.gz` files, deduplicated by accession. Item counts come from EDGAR full-text search with the 8-K form-family filter.

| Form / event | 2025 | 2024 | Note |
|---|---|---|---|
| DEF 14A | **5,215** filings (5,052 distinct filers) | 5,389 (EFTS) | EFTS and form.idx agree exactly for 2025. Includes funds, BDCs and SPACs |
| DEFA14A / PRE 14A / DEFR14A / DEFC14A | 6,373 / 1,552 / 213 / 91 | — | |
| 8-K / 8-K/A (all items) | 66,110 / 1,453 | — | |
| 8-K docs containing "Item 5.02" | **~11,470** | ~11,580 | About 17% of 8-Ks. Hits are per document, but 98–100% of first-page hits had unique accessions. Includes 8-K/A and officer-only or compensation-only 5.02s |
| ↳ also containing "appointed" and "board of directors" | ~4,460 | — | Rough proxy for appointment-type 5.02s (still includes officer appointments) |
| 8-K docs containing "Item 5.07" | 5,426 | — | About one per annual meeting |
| Form 3 / Form 4 / Form 5 | 12,255 / 169,532 / 1,237 | — | Distinct accessions |

---

## 6. Recommendation

**(a) Local prototype / dev**
- **Board data:** SEC EDGAR (free): submissions JSON, raw Form 3/4 XML, 8-K and DEF 14A HTML, plus the quarterly insider data sets for backfill. Use a UA header and stay at or below 5 rps.
- **Prices:** **Tiingo Commercial at $50/mo** ($499/yr), which allows internal commercial use, or Power at $30/mo if you're strictly an individual. Avoid the free tier, which can't store data. This keeps dev on the same vendor and schema as the launch tier.
- **Personal-use sources** (Sharadar $39/mo, Norgate, Stooq, Yahoo, nasdaq.com) are acceptable only for one person's validation. Developing a commercial product is arguably outside "personal use", and none of their data can ship.

**(b) Public MVP (20 companies)**
- **Board data:** SEC only.
- **Prices:** **Tiingo "EOD + IEX Redistribution", startup tier, $250/mo.** Include the required "Data sourced by Tiingo" link. Benchmark is SPY total return from the same feed.
- **Before launch, get written confirmation from Tiingo** that (1) normalized charts and tenure returns on a public, non-login site are covered, (2) we qualify for startup pricing, and (3) what the 80,000 / 1,200,000 limits mean.
- **Fallback:** Intrinio Startup ($333/mo for 6 months, then $666, then $999/mo; executed Order Form) or Twelve Data Venture ($499/mo, but check the caching clause).
- **Coverage:** expect gaps in directors' older delisted boards. Show "price data unavailable" rather than substituting.

**(c) Scale to 10k companies**
- **Board data:** SEC only, with an LLM pass over sliced 8-K 5.02 and proxy sections.
- **Prices:** you need a survivorship-free, permanent-ID, total-return source with distribution rights. Request quotes in parallel from:
  - **Sharadar via Nasdaq Data Link** (distribution Order Form; first choice on coverage and cost);
  - **CRSP/Morningstar** (deepest history; display terms unknown);
  - Intrinio Enterprise ($1,250+/mo).
- **Published-price ceiling:** Massive Business at $2,499/mo, which is split-only and starts in 2003.

**Estimated monthly data-licence cost.** Excludes hosting and LLM. SEC is $0 at every scale.

| Companies tracked | Price source (display-licensed) | Est. $/month | Main risk |
|---|---|---|---|
| 20 | Tiingo Redistribution (startup) | **$250** | Delisted gaps; startup eligibility |
| 100 | Tiingo Redistribution (startup → enterprise) | **$250–500** | Same |
| 1,000 | Tiingo enterprise $500, or Intrinio Startup ($333 → $999) | **$500–1,000** | Delisted-history gaps become visible; start NDL/Sharadar talks |
| 5,000 | Sharadar/NDL distribution (quote), or Intrinio $999–1,250+, or Massive Business $2,499 | **~$1,000–2,500** (quote-dependent) | Licence negotiation; Massive starts in 2003 |
| 10,000 | Same as 5,000; CRSP/Morningstar if pre-1998 accuracy matters; optional BoardEx (≥ $25k/yr ≈ $2k+/mo, display unlikely) | **~$1,250–2,500+** (quote-dependent) | Public display may be priced by traffic (Intrinio says public display costs more) |

**Price-licence cost scales with display rights and audience, not company count.** Even the 20-company MVP needs full-market, delisted history for the cross-board track-record feature: 20 boards × ~11 directors × several other boards touches hundreds of issuers.

**Do not use these for the public site:**
- Yahoo/yfinance (ToS bans scraping, commercial reuse and derivatives).
- Stooq (no commercial use; bot-gated).
- Norgate (single individual).
- Alpaca (no redistribution).
- CRSP via WRDS (academic only).
- Sharadar direct (personal licence).
- The free or individual tier of any vendor; Massive counts even testers as viewers.
- FMP ("derived from" clause, deletion agreement).
- FRED SP500 or any index levels without an S&P DJI, Nasdaq or FTSE licence.
- LittleSis (CC BY-SA) and OpenCorporates (ODbL), because share-alike would attach to our database.

Watch Twelve Data's no-caching clause and every vendor's delete-on-termination clause (Tiingo, Intrinio, Sharadar, FMP). Store our own computed returns separately from vendor raw data, and confirm with each vendor which derived artifacts we may keep.

## Not verified

- **Tiingo:** row labels of the redistribution tier (JS-rendered), startup eligibility, the start year of delisted coverage, and whether the §1.6(c) derived carve-out applies to public display on non-redistribution plans.
- **Prices behind login or sales:** Nasdaq Data Link SEP/SFP (all licence types), EODHD display, FMP Enterprise, Alpha Vantage commercial, CRSP/Morningstar.
- **Delisted price coverage:** Twelve Data and Alpha Vantage; whether Intrinio's delisted coverage still starts in 2007.
- **NDL terms:** read from search excerpts only (the page is JS-rendered); new terms take effect 2026-11-01.
- **Index and exchange licensing:** S&P DJI terms and the CME FAQ (403 and timeout; snippets only), current Cboe, Nasdaq GIDS and FTSE Russell website fees, and the CTA/NYSE EOD fee policy.
- **ETFs:** ONEQ expense ratio and inception (third-party source only); VOO page (snippet).
- **Commercial board-data prices** (all are estimates or aggregates), and nasdaq.com's own Terms of Use page.
- **Proxy and director scale:** mega-cap DEF 14A sizes; the cumulative distinct-director count since 2003.
