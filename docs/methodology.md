# Methodology

Version `2026.10.2` (`METHODOLOGY_VERSION` in `pipeline/src/bt/analytics/returns.py`).
Every number on the site can be reproduced from the stored daily bars, corporate actions
and board-membership dates using the rules below. If a rule changes, the version changes,
and every stored result records the version that produced it.

## What the numbers mean (and don't)

Tenure performance is **descriptive**. "LYFT returned −30.2% during Jane Doe's tenure"
states what the stock did while that person held a board seat. It does not say the
director caused it. A board is a group. Directors overlap, and the market, the sector
and company events drive most of any stock's return. The product never credits a director
with a return.

## Tenure dates

A membership has a start date and, if it has ended, an end date. Each date has a **precision**:

| precision | meaning | example basis |
|---|---|---|
| `day` | exact date stated in a primary source | 8-K: "appointed … effective March 15, 2021" |
| `month` | month known, day not | "joined in March 2021" |
| `year` | year known | proxy: "Director since 2015" |
| `unknown` | not established | — |

A date is stored as the first day of its window plus its precision. We never round a
`year` into a `day`. Where a source only supports a year, the UI says "2015" and returns
are published as a range (see below).

The start of a tenure is the date the person became a director (the effective date of the
appointment or election), not the date it was announced. The end is the effective date of
the resignation or retirement, or the date of the annual meeting at which the term ended
for directors who did not stand for re-election.

## Prices

* Daily closes come from the primary listing (`security.is_primary`).
* Returns use a **total-return index**: splits are neutralized and cash dividends are
  reinvested at the ex-date close. For one share held from the previous close, today's value
  is `split_ratio × (close + dividend)`; the index compounds that ratio day by day from the
  first close. A **price-return index** (splits only) is kept alongside it.
* We build these indexes ourselves from raw closes and corporate actions instead of relying
  on a vendor's back-adjusted close. They stay reproducible and vendor-independent, and
  they're append-only: a new dividend never rewrites history. Where a vendor publishes its own
  adjusted close, validation compares the implied returns and flags disagreements.
* An action dated on a non-trading day applies to the next session.

## Anchor days

Markets are closed on weekends and holidays, so each tenure date maps to an **anchor**
trading day:

* **As-of rule.** A date's anchor is the last trading day *on or before* that date. A director
  who joined on Saturday is measured from Friday's close. The anchor's close is the
  "price at start".
* **Joined before the stock listed** (e.g., pre-IPO directors). The start anchor is the
  first trading day's close (`start_anchor_reason = first_trade`). We do not use the IPO
  offer price, since public investors could not trade at it. The actual join date is still
  displayed.
* **Left before the stock listed.** There is no measurable tenure (`no_price_history`).
* **Current directors.** The end anchor is the latest stored close (`latest_close`), shown with
  its date ("through Oct 2, 2026"). The site reports history, not live quotes.
* **Left after the stock stopped trading** (acquisition, delisting). The end anchor is the
  last trading day (`last_trade`). Acquisition consideration is not yet modeled.

Consequence of the as-of rule: if a director joins on a trading day, that day's own move
is *not* counted. The tenure starts at that day's close. Appointment-day reactions belong
to the event-window analysis, a future feature.

## Return statistics

For start anchor `s` and end anchor `e` with total-return index `TR`:

| statistic | formula |
|---|---|
| Total return | `TR(e) / TR(s) − 1` |
| Price return | `PR(e) / PR(s) − 1` |
| Annualized return | `(1 + total)^(365.25 / calendar_days) − 1`, **only when the window is ≥ 365 calendar days**; shorter windows show "—" because annualizing them exaggerates |
| Benchmark return | the same as-of rule and formula applied to the benchmark over the same anchor days |
| Relative return | `total − benchmark`, in **percentage points** ("LYFT trailed the S&P 500 by 18.4 pp") |
| Excess (geometric) | `(1 + total) / (1 + benchmark) − 1`, shown in detail views |
| Max drawdown | the largest peak-to-trough decline of `TR` between the anchors, with its peak and trough dates |

A tenure whose start and end map to the same anchor day (`too_short`) has no return.

### Imprecise dates → ranges, not points

If a tenure date that falls inside the stock's trading history is only known to a month or
year, every anchor in that window is possible. We publish the **minimum and maximum** total
return over all consistent start/end anchors (`status = approximate`, `return_low` /
`return_high`) and leave the point estimate empty. Imprecision doesn't matter when the
whole window precedes listing: a pre-IPO "director since 2012" is anchored at the first
trade either way.

## Benchmarks

The default benchmark is the **S&P 500, represented by the SPDR S&P 500 ETF (SPY) total
return**. An ETF proxy avoids index-data licensing and reflects a return an investor could
actually earn. The proxy trails the index by its expense ratio (0.0945% a year for SPY), which
is small at tenure horizons. The UI labels it "S&P 500 (SPY)", never as the index itself. Additional benchmarks
(Nasdaq Composite, Russell 2000, sector ETFs) use the same mechanism through the `benchmark`
table.

## Aggregates (director track records in the API)

The API's director track record (`/api/v1/directors/{id}/performance`) aggregates a person's
tenures across companies. The site's standings use the per-director score under "Rankings"
below instead. To avoid misleading summaries:

* Point statistics (mean/median total return, % positive) use only tenures with
  `status = ok`. Approximate tenures are counted and shown separately, never averaged in.
* Annualized aggregates use only tenures of at least one year.
* **Medians lead.** Means are returned with them because a single outlier dominates the mean
  for most directors.
* Concurrent seats overlap in time and share market conditions. They are not independent
  observations, and the UI never presents a track record as statistically significant.
* "Company-years served" sums tenure lengths across seats, so two concurrent seats held
  for a year count as two company-years.

## Rankings

Rankings order **stock performance during board tenure**: a stat line about the stock,
not a skill rating. A higher rank means the company's stock beat the S&P 500 by more per year while
that person held the seat.

**Per seat.** The ranking metric is annualized excess return against SPY total return:

`annualized excess = ((1 + total) / (1 + benchmark))^(365.25 / calendar_days) − 1`

It is geometric, so a 10-year seat and a 2-year seat are on the same per-year footing. A seat is
**rank-eligible** only if it has an exact return (`status = ok`: no imprecise or unknown dates, no
price-history gap) and lasted **at least 365 days**. Shorter seats appear on the site but are never
ranked, so a director who joined last month can't top the table on one good quarter.

**Per director.** The score is the **time-weighted geometric mean** of annualized excess across the
person's eligible seats:

`score = exp( Σ days_i · ln(1 + excess_i) / Σ days_i ) − 1`

A director is ranked only with **at least two scored years** in total. Each row also shows the
number of scored seats and how many of them beat SPY.

**Executive seats.** CEOs and other employee-directors are flagged (`executive_seat`). The
**Non-exec seats** view recomputes the score from non-executive seats alone, because exec seats
measured from the first trading day otherwise dominate.

**Caveats shown in the UI.** Seats held at the same time share market conditions. Pre-IPO
directors' seats are measured from the first trading day. Coverage is limited to the
companies we track.

## Executive pay

Executive pay pages set what a company reported paying its named executive officers against how
its stock did over the same period. Like everything else here, the numbers are descriptive: an
executive works with a board, other executives and a market, and the stock's path during their
tenure doesn't show what they caused.

**Pay.** The Summary Compensation Table total from the proxy statement (and, for years before
listing, the IPO prospectus): salary, bonus, the grant-date fair value of stock and option awards,
non-equity incentive pay, the change in pension value and deferred-compensation earnings, and all
other compensation. Equity is valued when granted, not at what it was later worth. A fiscal year
appears in up to three proxies; every appearance is stored, the newest filing's figures are used,
and a quality check flags any year whose figures changed between filings. Only named executive
officers are covered, since proxies don't disclose other officers' pay.

**Tenure.** The span from the effective date a person became an executive officer to the date
they stopped being one (a move to an advisory or non-officer role ends it). Consecutive titles
(say, CFO then president) merge into one span. Dates follow the precision rules above.

**Pay window.** The stock is measured with the board-tenure rules from the start of the officer
tenure (the first trading day if the tenure began before listing) to the end of the tenure or the
end of the last fiscal year with reported pay, whichever comes first. Pay counts every fiscal year
with reported pay that overlaps that window, so pay and the stock cover the same years. Years
before listing are shown but not counted.

| statistic | formula |
|---|---|
| Pay per year | window pay ÷ fiscal years counted |
| Stock vs S&P per year | annualized excess, as for board seats |
| Starting market value | cover-page shares outstanding (all classes, from the 10-K/10-Q nearest on or before the window start, else the first within 120 days after) × the start anchor's close |
| Shareholders vs S&P | `starting market value × (total − benchmark)`: what a holder of the whole company at the start ended with, minus the same money in SPY |
| Per $1 of pay | `shareholders vs S&P ÷ window pay` |

**Share counts** come from 10-K/10-Q covers (inline XBRL, plain-text covers before that, and
XBRL company facts for older single-class filers). A count dated before a stock split is restated
into the split-adjusted units of the close it's multiplied by. A person who left and later returned
is measured from the stint that overlaps their paid years, not across the gap.

**Fiscal years** use each company's own year ends (NVIDIA's end in late January, Intel's on the
last Saturday of December); a year starts at the previous year's end.

**Across companies.** "Per $1 of pay" grows with company size, so it compares executives only
within a company. Cross-company views use pay per year against the stock vs the S&P 500 per year,
only for pay windows of at least a year, and lead with medians because single awards can be orders
of magnitude larger than the rest (a CEO performance grant counts in full in the year it is reported).
The rank correlation shown is Spearman's, over those windows; executives at the same company share
one stock, so they aren't independent observations.

**Compensation actually paid.** For CEOs the page also shows the proxy's pay-versus-performance
table (Item 402(v)), whose "compensation actually paid" marks equity awards to year-end value. A
quality check compares the table's cumulative shareholder return with our total-return index over
the same dates.

## Confidence

| level | rule |
|---|---|
| high | stated explicitly in an SEC filing, with a machine-verified verbatim quote |
| medium | company website or annual report; or inferred from SEC filings (e.g. a year from "director since") |
| low | secondary source, or any quote that failed verification |

Low-confidence facts are labeled as such in the UI and never silently promoted.
