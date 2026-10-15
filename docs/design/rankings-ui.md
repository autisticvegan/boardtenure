# Boardtape Standings: rankings UI build spec

Status: final build spec, 2026-10-05. Base direction: **League Night**, the unanimous judge winner. It adds grafts from **The Ledger** and **Leaderboard Terminal**, and fixes every problem the judges raised.

Scope: one dark theme for the whole site. The new **Standings** dashboard and table lead the site; company, director and seat pages are re-centred on director returns. This document changes no code. Everything below is for the implementer.

> **Prices are daily closes.** The owner asked to keep daily prices instead of weekly ones, so this spec treats "weekly" as obsolete. `price_daily` already stores daily bars. The refresh job still runs weekly, so moving it to a daily schedule is prerequisite **P0-4**. Until that ships, the UI shows only the as-of close ("Daily closes through Oct 2, 2026"). It never claims a refresh cadence.

---

## 0. Judge scores

Each criterion was scored out of 10 by three judges. The table shows the mean, the total is out of 180, and all three judges picked League.

| Direction | Punchy/fun | Informative | Honest (no causation) | Rankings focus | Buildable | Accessibility | Judge totals (J1 / J2 / J3) | **Total /180** |
|---|---|---|---|---|---|---|---|---|
| **League Night** (base) | 9.0 | 8.0 | 7.0 | **10.0** | **7.7** | **8.3** | 49 / 51 / 50 | **150** |
| The Ledger (editorial) | 6.7 | **9.3** | **8.7** | 7.3 | 6.7 | 8.0 | 47 / 47 / 46 | 140 |
| Leaderboard Terminal | 8.0 | 8.0 | 5.7 | 9.0 | 5.7 | 7.3 | 43 / 44 / 44 | 131 |

**What the final design takes from each**

| From | Idea kept | Why (judge call-out) |
|---|---|---|
| League | Podium vs bottom of the table, equal-height cards, medal discs, SQL `rank()` ties shown as "T-4" | Rankings focus is 10/10 from every judge, and equal-height cards keep the podium from reading as a bar chart |
| League | Two scopes with exec seats one click away (renamed, see §2.2) | Matches the SQL's seat-level `NOT executive_seat` filter exactly |
| League | **The `independent_*` scorecard bug fix** | All three judges confirmed it in `0005_rankings.sql` and `queries.ts` |
| League | No count-ups, WhiteKnuckle drawdown with dates, copy-lint test, stock chart demoted | Honest number rendering, and it's cheap to enforce |
| Ledger | **Where everyone lands** (dot distribution) and **Board by board** (one strip per company) | The most informative views, and the main honesty device: ranks cluster by company (NVDA 15 of 15 seats beat the S&P, LYFT 0 of 15) |
| Ledger | No rank-change arrows; template-generated annotations; separate denominators for directors and seats | Daily moves are noise, not momentum |
| Ledger | Exec seats drawn as hollow rings (shape, not colour) | Doesn't depend on colour |
| Terminal | p98-style bar domain with a capped chevron that keeps the true label | League's ±40 cap clipped 11 directors, including the entire top 3 and bottom 3 |
| Terminal | Rule-based **TenureTags** (Rode the rocket, White-knuckle seat, Rough ride), at most 2 per row | Fun that stays descriptive |
| Terminal | "Warming up · needs 2 scored years (has 1.4)" with a projected date | Friendly and informative |
| Terminal | Causation-safe seat sentence ("While X sat on Y's board, SYM returned…") and batting line per board | The safest sentence form among the three |
| Terminal | Stock chart in a collapsed `<details>` that mounts lazily | Strongest demotion of the share price |

**Judge problems and how this spec fixes them.** These are binding. Each one also maps to an item in §10 "Do not".

| # | Problem raised | Fix in this spec |
|---|---|---|
| 1 | The sports frame (players, W–L, head-to-head, tale of the tape) credits people with returns | Cards are **Director cards**. The record reads "1 of 1 seats beat the S&P". Compare is seat-vs-seat and moves to phase 2. Banned terms are enforced by lint (§9) |
| 2 | Series-3 aqua `#00a88b` collides with gain `#00b06c` (ΔE 5.6) | There is no third categorical series. Seat lines on the director page are replaced by bars and strips (§6.3) |
| 3 | Accent collides with series-1 (League) and with gold (Ledger), and Terminal's accent does three jobs | Accent is violet and appears only in UI chrome, never inside a plot. **The focus ring is ink, not accent.** Validator FAIL recorded in §6.3 |
| 4 | `#c52b30` loss mark is below 3:1 on hover and tooltip surfaces (2.92 / 2.57) | Loss mark is `#d95926`: ≥ 3.70:1 on every surface, including surface-3 |
| 5 | Zero line at 1.77:1 | New `--zero #6b7488` token: 3.79:1 on surface, 3.06:1 on surface-3 |
| 6 | "Exec/Founder" and "Founder · from IPO" labels have no founder data behind them | The UI never says "founder". **Exec seat** comes from `board_role = executive_director`, and its tooltip shows `officer_title`. **From IPO** comes from `start_anchor_reason = first_trade` and is worded "measured from the first trading day", which covers pre-IPO investors too |
| 7 | The Independent/Everyone toggle was mislabelled as excluding people | Labels are **Non-exec seats / All seats**, with the definition "seats left out, people stay in". People with mixed seats move (they are re-scored); they don't vanish |
| 8 | ScoreboardStrip mixed Open-scope stats with the Independent-default table | `getLeaderboardStats(scope)` is scope-aware (P0-2) |
| 9 | ExcessBar ±40 clamp capped 11 directors, including the featured rows | Domain = ±ceil10(max(\|p02\|, \|p98\|)) of the active scope: **±50%/yr today, which caps 2 directors**. Podium cards have no bars |
| 10 | No distribution view, and no caveat that rank mostly reflects the company | Where everyone lands + Board by board + the line "129 of 137 ranked directors have one scored seat" + a Same-boardroom strip on seat pages |
| 11 | RecordPill counted repeat seats on one company as separate boards | Copy says **seats**. "Boards" means `count(DISTINCT company_id)` (new `scored_boards`) |
| 12 | Rank deltas and Movers turn price noise into person news; both need a snapshot table | Dropped. No deltas, no snapshot table |
| 13 | The log-scale switch at +300% gives inconsistent axes | Phase-2 compare chart is **always** log scale and labelled. Phase 1 has no multi-line chart |
| 14 | The mobile row was both a link and a disclosure, and `<tr>` can't be a link | Rows use a stretched link in the name cell. There is no expansion; the details sit on a second line |
| 15 | Radiogroup toggle writing `?league=` re-rendered on every arrow press | The scope control is two links (`aria-current`). Navigation happens only on click or Enter |
| 16 | Hard-coded counts ("Seven people", "19 companies · 300 seats") | Every count is computed. Lint flags digits inside headings (§9) |
| 17 | "Weekly" wording, and the pipeline still runs weekly | P0-4 schedule change. Lint bans "weekly" |
| 18 | Count-ups (Ledger 600ms, Terminal 700ms) show false values | Banned |
| 19 | Terminal tie re-computation diverges from SQL `rank()` | Ranks and ties come only from SQL. Filters never renumber |
| 20 | Subjectless lines ("beat the S&P by 12.4% a year while she served") | Rule: **the stock is the grammatical subject of every return verb** (§9) |
| 21 | The short-record flag only fired under 3 years and only in tooltips | A visible **Short record** chip appears below 5 scored years. Today that's 36 of 137, including #1 and the bottom 3 |
| 22 | 7px dots on mobile miss the 24px target size | On mobile the dots aren't interactive. The equivalent control is the standings table, linked directly under the chart (WCAG 2.5.8 equivalent exception) |
| 23 | Ledger ink-3 on surface-3 was 4.37:1 | `--ink-3 #8a93a6` is 4.66:1 on surface-3 |
| 24 | Too much scope for one week (/vs, ⌘K, j/k, View Transitions, bottom sheets) | Phase 1 has none of these. `StripRow` is reused in 3 places (Board by board, Many hats, Same boardroom). Compare moves to phase 2 |
| 25 | 2-1-3 podium order mismatches DOM order | DOM and visual order are 1, 2, 3 |
| 26 | "Perfect record" and "Longest winning seat" make the person the winner | Replaced by "Longest scored seat" and the seats-beat fraction |

---

## 1. Principles

1. **The seat is the unit, the stock is the subject.** Every number describes what a stock did during a seat, compared with the S&P 500 (SPY total return). People are never the subject of a return verb.
2. **Rankings first, price second.** No page shows a share price, market cap or company stock chart above the fold.
3. **One metric, one scale.** The headline number is always annualized excess ("+12.4%/yr vs the S&P"). Every bar and dot on a page shares one symmetric domain.
4. **Show the luck.** Seat count, scored years, short-record flags, the company clustering view and drawdowns are always visible, not hidden in tooltips.
5. **Fun lives in headings, medals, tags and motion. Data labels, tooltips and tables stay plain.**
6. **Ranks come from SQL.** The web shows exactly what `/api/v1/rankings` returns (`rank()`, ties included). TypeScript never sorts to assign ranks.

---

## 2. Prerequisites (P0, before any UI ships)

### P0-1 Migration `db/migrations/0006_rankings_scoped.sql`

`director_scorecard` computes `scored_seats`, `scored_years`, `beat_seats` and `best/worst_seat_excess` over **all** seats. `getDirectorRankings('independent')` swaps in `independent_score` but passes those columns through unchanged. Today this changes no numbers (the only mixed director, Joseph Gebbia, has no rank-eligible exec seat). It will break as soon as Oracle or Salesforce add exec seats measured from the first trading day.

The migration uses `CREATE OR REPLACE VIEW` and only **appends** columns, because Postgres refuses to reorder or retype existing view columns.

```sql
-- seat_ranking: append drawdown dates and the officer title behind the Exec seat chip.
CREATE OR REPLACE VIEW seat_ranking AS
SELECT /* ...every existing column, unchanged and in the same order... */,
       tp.mdd_peak_date, tp.mdd_trough_date,
       (SELECT r.officer_title FROM board_role r
         WHERE r.membership_id = m.id AND r.role = 'executive_director'
         ORDER BY r.start_date DESC NULLS LAST LIMIT 1) AS executive_title
FROM tenure_performance tp JOIN board_membership m ON m.id = tp.membership_id
WHERE tp.benchmark_id = (SELECT id FROM benchmark WHERE is_default) AND m.seat_type = 'director';

-- director_scorecard: append board counts and the non-exec ("independent") versions of every per-scope column.
CREATE OR REPLACE VIEW director_scorecard AS
WITH s AS (SELECT * FROM seat_ranking)
SELECT /* ...every existing column, unchanged and in the same order..., */
  count(DISTINCT s.company_id) FILTER (WHERE s.rank_eligible)::int AS scored_boards,
  count(*) FILTER (WHERE s.rank_eligible AND NOT s.executive_seat)::int AS independent_scored_seats,
  coalesce(sum(s.calendar_days) FILTER (WHERE s.rank_eligible AND NOT s.executive_seat), 0) / 365.25
    AS independent_scored_years,
  count(*) FILTER (WHERE s.rank_eligible AND NOT s.executive_seat AND s.relative_return_pp > 0)::int
    AS independent_beat_seats,
  max(s.annualized_excess) FILTER (WHERE s.rank_eligible AND NOT s.executive_seat) AS independent_best_seat_excess,
  min(s.annualized_excess) FILTER (WHERE s.rank_eligible AND NOT s.executive_seat) AS independent_worst_seat_excess,
  count(DISTINCT s.company_id) FILTER (WHERE s.rank_eligible AND NOT s.executive_seat)::int
    AS independent_scored_boards
FROM person p JOIN s ON s.person_id = p.id
WHERE p.merged_into_person_id IS NULL
GROUP BY p.id;
```

Acceptance: for every person, the `independent_*` columns equal the same aggregates recomputed from `seat_ranking WHERE rank_eligible AND NOT executive_seat`. Add this as a SQL check in `bt check`.

### P0-2 Scope-aware queries (`web/src/lib/queries.ts`)

| Function | Change |
|---|---|
| `getDirectorRankings(scope)` | Select the scope's columns, aliased to the existing names: `scored_seats`, `scored_years`, `beat_seats`, `best_seat_excess`, `worst_seat_excess`, plus new `scored_boards` and `scored_executive_seat`. Keep `ORDER BY s DESC, full_name` and SQL `rank()`. Extend `SeatRef` with `membership_id`, `start_anchor_date`, `end_anchor_date`, `relative_return_pp`, `bench_total_return`, `max_drawdown`, `mdd_peak_date`, `mdd_trough_date`, `executive_title`, `status` (perf status), `start_precision`. |
| `getLeaderboardStats(scope)` *(signature change)* | Add `scope`. Return `{ companies, ranked_directors, scored_seats, beat_seats, directors_beating /* score > 0 */, median_score, median_seat_excess, single_seat_ranked /* scored_seats = 1 */, multi_board_people, unranked_people, data_through }`. Every count is filtered by scope (seat-level `NOT executive_seat` for `independent`). |
| `getSeatRankings(scope)` | Add `mdd_peak_date`, `mdd_trough_date`, `executive_title`, `seat_status`. |
| **new** `getUnranked(scope)` | People not rank-eligible in the scope: `{ slug, full_name, scored_years, scored_seats, seats: SeatRef[] }`. `reason` is computed in TypeScript (§5.4). |
| **new** `getBoardStrips(scope)` | One row per company: `{ slug, symbol, common_name, created_at, scored, beat, median_excess, seats: { membership_id, person_slug, full_name, annualized_excess, executive_seat, start_anchor_date, end_anchor_date, seat_status, total_return, bench_total_return }[] }`. Only rank-eligible seats, scope-filtered. |
| **new** `getRecords(scope)` | The four record tiles in §4.1, one SQL query each (`ORDER BY … LIMIT 3` so TypeScript can deduplicate and detect ties). |
| **new** `getMultiBoard(scope)` | People with scored seats on 2 or more distinct companies, with their seats. |
| `getCompanyLeaderboard(companyId, scope)` | Add `scope` so the seat-rank chip matches the active scope. Add drawdown dates and `executive_title`. |

The web default scope is `independent`; the API default stays `all`. Don't change the API. The web always passes `scope` explicitly.

### P0-3 TypeScript helpers (`web/src/lib/standings.ts`, new)

| Helper | Contract |
|---|---|
| `perYear(x, digits = 1)` | `pct(x, digits) + "/yr"`, so "+12.4%/yr" and "−3.0%/yr". U+2212 minus, as `pct` already does. |
| `rankLabel(rank, tie)` | `"#4"` or `"T-4"`. `srRank` gives "4th place", "Tied for 4th" or "Rank 137 of 137". |
| `withTies(rows)` | Sets `tie = true` where more than one row shares a `rank`. It never changes `rank`. |
| `topPct(rank, of)` | `max(1, ceil(100 * rank / of))`. **Only shown when ≤ 25**, as "top 3%". There is never a "bottom X%". |
| `barDomain(values)` | `clamp(ceil10(max(\|p02\|, \|p98\|)), 20, 100) / 100`, computed over the **whole active scope** (directors or seats), not the filtered rows, so filters never rescale the bars. Today: ±0.50. |
| `tagsFor(seat)` | §5.2 rules, in priority order White-knuckle > Rocket > Rough ride. A row shows at most 2 tags, a mobile row at most 1. |
| `shortRecord(d)` | `scored_years < 5`. |
| `eligibleAround(seats, dataThrough)` | Earliest date when Σ(days of seats with ≥ 365 days) ≥ 730, assuming current `ok` seats continue. Step day by day up to 1,100 days. Returns `null` if there's no current `ok` seat or nothing qualifies within that range. Display as "Mar 2027". |

Thresholds are named constants in `standings.ts`: `ROCKET = 0.25`, `ROUGH = -0.20`, `WHITE_KNUCKLE_MDD = -0.80`, `SHORT_RECORD_YEARS = 5`. The values are calibrated to today's data (§11) and should be re-checked when new companies land.

### P0-4 Daily refresh (pipeline, docs and copy)

* `pipeline/src/bt/jobs/refresh.py` and the scheduler: run after each US trading day's close (weekdays, about 22:30 UTC), instead of weekly. Every stage is already incremental.
* `pipeline/src/bt/config.py`: `FRESHNESS_DAYS = 1`, `STALE_AFTER_DAYS = 4` (a weekend plus one holiday).
* `cli.py`: the `refresh` help text should say "(daily)". Replace "weekly" in `README.md`, `docs/methodology.md` §Prices, `docs/architecture.md` (refresh job, scheduler row) and `docs/adding-a-company.md`.
* Web: replace the five `// Data refreshes weekly…` comments. Use `revalidate = 3600` so pages pick up the nightly run within an hour.
* Copy rule: the as-of stamp ("Daily closes through {date}") is always true. The sentence "Updated after each trading day's close" appears **only** in the methodology, and only after the daily schedule has run for a week.

---

## 3. Site-wide frame

### 3.1 Dark only

* Delete `components/theme-toggle.tsx`, the `themeScript` in `layout.tsx`, the light token block, the `@media (prefers-color-scheme)` block, the `[data-theme]` block and `@custom-variant dark`.
* Tokens live on bare `:root` with `color-scheme: dark` (§6.1). `layout.tsx` exports `viewport = { themeColor: "#0b0d12", colorScheme: "dark" }`. Check `node_modules/next/dist/docs` for the Next 16 `viewport` export before writing it.
* `html` and `body` both get `background: var(--bg)`.

### 3.2 Header (`SiteHeader`)

* Left to right: logo (links to `/`), **Standings** (`/rankings`), search box, then Companies and Methodology.
* Below `md`, Companies and Methodology move to the footer. Standings stays visible as a text link.
* The logo mark's tenure band uses `--accent`.
* Sticky with `top: env(safe-area-inset-top, 0px)`, height 56px.

### 3.3 Footer

* Disclaimer (replaces the current one): "Standings describe how a company's stock did against the S&P 500 while each person held a board seat. Boards act as groups, and markets, sectors and timing drive most of any stock's return. Nothing here says a director caused a return, and nothing here is investment advice."
* Data line: "Daily closes through {data_through} · {companies} companies tracked · Benchmark: S&P 500 (SPY, dividends reinvested)".

### 3.4 Scope

* URL param `scope=independent|all`. The default is `independent`, and the param is omitted from URLs when it's the default.
* **UI labels: "Non-exec seats" and "All seats".** The UI never says "independent", because company pages already show the proxy's independence designation and the two would conflict.
* Every internal link from a ranking surface carries the active scope.

---

## 4. Routes and section order

Section names below are the exact H2 text. Placeholders `{…}` are computed. Example values are today's data (§11).

### 4.1 `/` Standings dashboard (server component)

`<title>`: "Standings: board seats ranked by stock vs the S&P 500 · Boardtape"

| # | Section | Contents | Microcopy |
|---|---|---|---|
| 1 | **Hero** | Eyebrow, H1, sub, `ScopeToggle`, `ScoreboardStrip` | Eyebrow: `STANDINGS · DAILY CLOSES THROUGH {OCT 2, 2026}`. H1: **"Who had the best seat in the house?"** Sub: "Directors ranked by how their company's stock did against the S&P 500, per year, while they held the seat. A stat line about the stock, not a skill rating." |
| 2 | **Top of the table** and **Bottom of the table** | `Podium`: two columns of 3 `DirectorCard`s each | Top sub: "Stocks that beat the S&P 500 by the most per year during the seat." Bottom sub: "Stocks that trailed the S&P 500 by the most per year during the seat." |
| 3 | **Where everyone lands** | `DistributionDots`, full width, height 220 | Sub: "Each dot is one ranked director. Right of the line, the stock beat the S&P 500 per year during their seats." Link under chart: "See it as a table →" (`/rankings`) |
| 4 | **The rest of the top 10** and **The rest of the bottom 10** | `StandingsPreview`: rows with rank 4–10 and the mirror at the bottom. Below `md`, two tabs instead | Mobile tabs: "Top 10" / "Bottom 10". Link: "Full standings →" |
| 5 | **Board by board** | `BoardStrips`: every company, sorted by median seat | Sub: "Board-mates share one stock, so ranks cluster by company. Each dot is one scored seat; the tick marks the board's median." |
| 6 | **Records** | 4 × `RecordTile` | Tile kickers: "Longest scored seat" · "White-knuckle seat" · "Steepest lag, 5+ years" · "Widest spread across boards" |
| 7 | **Many hats** | `ManyHats`, built from `StripRow`s. Hidden when `multi_board_people = 0` | Sub: "{7} people sit on {2–3} tracked boards. Same person, different boards, very different rides." |
| 8 | **How the standings work** | `HowItWorks`: 4 bullets and 2 links | See §8.1 |

Record tile rules. All of them use the active scope, the seat-level metric and rank-eligible seats only. If a seat already appears in an earlier tile, take the next one. On a tie, show the first by name plus "tied with {n} other seat(s)".

1. **Longest scored seat**: max `calendar_days`. Value "29.4 yrs". Detail: "{Name} · {SYM} · {+19.1%/yr} vs S&P over the seat".
2. **White-knuckle seat**: min `max_drawdown` among seats with `relative_return_pp > 0`. Value "−89.7%" with ▼ and the label "worst drop". Detail: "{SYM}, {Jan 3 → Oct 9, 2002}, and still beat the S&P by {26.1}%/yr". Today the top result (AMZN) is deduplicated against tile 1, so the tile shows NVDA, tied with 1 other seat.
3. **Steepest lag, 5+ years**: min `annualized_excess` with `calendar_days ≥ 1826`. Value "−30.5%/yr". Detail: "{SYM} · {7.5} yrs · tied with 1 other seat".
4. **Widest spread across boards**: among multi-board people, max(best − worst seat excess). Value "20.0 pts/yr". Detail: "{Ann Mather}: NFLX +9.4%/yr · ABNB −10.6%/yr".

Dashboard empty state, when nobody is ranked: H1 stays. Replace sections 2–7 with a card: "The standings fill in once directors have 2 scored years. A seat is scored after a year of exact dates." Link: "Browse companies →".

### 4.2 `/rankings` Standings table

`<title>`: "Full standings · Boardtape". The page is dynamic (it reads `searchParams`, which is a Promise in Next 16; `await` it).

* **H1:** "Standings"
* **Sub:** "Ranked by how the stock did against the S&P 500 per year during each seat. Ranks stay out of everyone ranked, even when you filter."

Order:

1. **`FilterBar`** (§5.4), sticky below the header on `md` and up.
2. **Result line:**
   * No filters: "{137} ranked directors · {Non-exec seats}"
   * Filtered: "Showing {12} of {137} ranked directors. Ranks are out of all {137}."
3. **`DirectorsTable`** (`tab=directors`, the default) or **`SeatsTable`** (`tab=seats`).
4. **`ChipKey`:** a `<details>` disclosure, "What the chips mean".
5. **`UnrankedList`:**
   * Directors tab: a collapsed `<details>` titled "Not ranked yet ({61})", grouped by reason.
   * Seats tab: "Not scored ({n})".

URL params:

| Param | Values | Notes |
|---|---|---|
| `tab` | `directors` (default), `seats` | |
| `scope` | `independent` (default), `all` | |
| `co` | comma-separated company slugs, e.g. `nvda,lyft` | |
| `status` | `all` (default), `current`, `former` | Directors tab: whether the person has any current scored seat. Seats tab: the seat's own status. |
| `min` | `2` (default), `5`, `10` | Minimum scored years. Directors tab only. |
| `multi` | `1` | Only people on 2 or more tracked boards. Directors tab only. |
| `q` | text | Name contains (case- and diacritic-insensitive via `bt_normalize`). |
| `sort` | `score` (default), `years`, `seats`, `best`, `worst`, `name` | Seats tab adds `drop`. |
| `dir` | `desc` (default for numbers), `asc` | |

The table renders about 200 rows on the server, with no pagination and no client-side sorting. The Rank column always shows the SQL rank.

Empty state when no rows match the filters:

* "No directors match these filters." (Seats tab: "No seats match these filters.")
* Link: "Clear filters" (goes to `/rankings` with only `tab` and `scope`).

### 4.3 `/c/[slug]` Company page, re-centred on its board

`<title>`: "{Company} ({SYM}) board standings: stock vs the S&P 500 by director seat · Boardtape"

| # | Section | Contents and microcopy |
|---|---|---|
| 1 | Header | Breadcrumb "Companies / {SYM}", H1 company name and exchange chip, legal name and SEC filings link. The right column holds only `Daily closes through {date}`; **market cap moves into section 7**. |
| 2 | Coverage strip | Unchanged (existing `CoverageStrip`). |
| 3 | `BoardRecordDek` | "**{15} of {15}** scored seats beat the S&P 500 while held. Median seat **{+30.7%/yr}**." The second line, in ink-3: "Board-mates share one stock, so their numbers move together." If no seat is scored: "No scored seats yet. A seat is scored after a year of exact dates." |
| 4 | **Board standings** | `BoardStandings` table: every seat, eligible seats first by `annualized_excess`, then a "Not scored ({n})" group. Status links `All · Current · Former` (`?status=`). It **replaces** the separate current and former tables. |
| 5 | **Best seat** / **Toughest seat** | Two `SeatCallout` cards. If every scored seat beat the S&P, the second card is titled "Smallest beat". With only one scored seat, a single card titled "Only scored seat". |
| 6 | **Who sat when** | `BoardTimeline`, sign-tinted, with end labels (§5.6). |
| 7 | **The stock itself** | A `<details>` that starts closed. Summary: "The stock itself: {SYM} vs S&P 500 since {listing}". Inside: the caption "Context only. Standings use each director's own window.", market cap, and `ReturnChart` at height 220, mounted on first open. |
| 8 | **Board overview** | The existing Stat card (directors, average and median tenure, independent per latest proxy, recent appointments and departures). |
| 9 | **Board changes** | Unchanged. |

### 4.4 `/d/[person]` Director page

`<title>`: "{Name}: board seats and stock vs the S&P 500 · Boardtape"

| # | Section | Contents and microcopy |
|---|---|---|
| 1 | `RankHero` | §5.5. |
| 2 | **Seat by seat** | `SeatBars` (the `RelativeBars` component rebased to annualized excess). Sub: "Per year vs the S&P 500 during each seat. One scale for all seats." Unscored seats sit below the bars as outlined rows with a reason chip. |
| 3 | **Where {first name} lands** | `DistributionDots` with `highlight={slug}`, height 160. Hidden when the person isn't ranked in the active scope. |
| 4 | **Board seats** | The existing career table, with a new "Per yr vs S&P" column after "vs SPY". |
| 5 | **Other public boards named in proxy biographies** | Unchanged. |
| 6 | **Reading these numbers** | The existing card, with bullets: "Each figure is what the company's stock did while this person held the seat. Boards act as groups." · "Seats held at the same time share market conditions." · "Coverage is only as complete as the companies we track." |

### 4.5 `/c/[slug]/d/[person]` Seat page

| # | Section | Contents and microcopy |
|---|---|---|
| 1 | Header | The existing breadcrumb and H1. |
| 2 | `SeatRankChips` | "Seat #{8} of {159} · top {5}% · {Non-exec seats}". If the seat isn't scored, one chip with the reason, e.g. "Not scored · under 1 year (8 months so far)". |
| 3 | `SeatSummary` | "While **{Ann Mather}** sat on **{Netflix}**'s board ({Jul 2010} – {present}, {16.2} yrs), **{NFLX}** returned **{+X%}** vs **{+Y%}** for the S&P 500: {ahead by 9.4% a year \| behind by 9.4% a year \| level with it}." |
| 4 | Stat tiles | Hero tile **"Per year vs S&P 500"** `{+9.4%/yr ▲}`, then: "{SYM} total return" · "S&P 500 total return" · "Difference" (pp) · "{SYM} per year" · `WhiteKnuckle` tile "Worst drop" with the sub-line "{Jan 3, 2022} → {Dec 28, 2022}". The existing "Price at start → end" tile moves into "How this was measured". |
| 5 | `TenureTags` | Up to 2 tags, with rule tooltips. |
| 6 | **Stock performance during tenure** | The existing `ReturnChart` with the tenure band. |
| 7 | **Same boardroom** | One `StripRow` of every scored seat on this company, this seat ringed. Sub: "Board-mates' seats on the same scale. Overlapping years land close together." |
| 8 | **{First name}'s other seats** | `SeatChips` linking to the other seat pages. Hidden if there are none. |
| 9 | Existing sections | Sources · How this was measured · Roles & committees. |

### 4.6 `/methodology`

Add a new first section, **How the standings work**. Its text is in §8.1, plus the formulas already in `docs/methodology.md` "Rankings". Rename the "independent directors only" view to **Non-exec seats** in the doc.

### 4.7 `/companies`

* Add two columns, "Seats beat S&P" ("15 of 15") and "Median seat" ("+30.7%/yr"), sorted by median seat descending.
* Add a "New" chip for 30 days after `company.created_at`. Its tooltip: "Added {Oct 5, 2026}."

### 4.8 `/random` (nice-to-have, phase 1)

A route handler that redirects (307) to a random ranked director in `?scope`. It's linked from **How the standings work** as "Pick a random ranked director →". Set `dynamic = "force-dynamic"`.

### 4.9 Phase 2 (not in this build)

* **`/compare?a={membership_id}&b={membership_id}`** compares two **seats**, not two people.
  * H1: "{SYM_A} during {Name A}'s seat vs {SYM_B} during {Name B}'s seat"
  * Sub: "Comparing the stocks during the seats, not the people."
  * Race chart: x is years into the seat; y is the ratio (1+R)/(1+R_spy) on an **always-log** axis labelled "Log scale", with ticks shown as "−50%", "Matched the S&P", "+100%", "+300%", "+900%". A is `--series-1`, B is `--series-2`, both 2px solid, with a legend and direct end labels. **No gain/loss marks on this chart** (§6.3).
  * Stat comparison: two columns in ink, with the higher value marked "▲ higher".
* **Career small multiples**: one single-series relative line per seat, on a shared y.
* **Not planned in any phase:** rank deltas, Movers, snapshot tables.

---

## 5. Component inventory

`(S)` marks a server component and `(C)` a client component. All components take tokens, not hex values.

### 5.1 Shared primitives

**`Signed` (S)**: `{ value: number | null; kind: "perYear" | "pct" | "pp"; glyph?: boolean; size?: "table" | "hero" }`

* Text is `--gain-ink` when the value is ≥ +0.05%, `--loss-ink` when it's ≤ −0.05%, and `--ink-2` otherwise.
* The value always carries its sign.
* With `glyph`, an aria-hidden ▲ or ▼ is prepended at 0.6em with a 0.15em gap. Use it on hero, podium and record figures.
* `null` renders as "—" in `--ink-3`.

**`RankBadge` (S)**: `{ rank: number; tie: boolean; of: number; medal?: boolean; size?: "sm" | "md" | "lg" }`

* **Medal** (only when `medal && rank ≤ 3`):
  * Disc sizes: 24px (sm), 28px (md), 36px (lg).
  * Fill `--gold`, `--silver` or `--bronze`, with the numeral in `--ink-on-mark`, 700, tabular.
  * A tie shows "T-2" in a pill-shaped disc.
* **Plain:** a `--surface-3` pill, min-width 40px, numeral `--ink-2` 15/700 tabular, text "#137" or "T-135".
* Always carries sr-only text from `srRank`.

**`Chip` (S)**: `{ kind: "short" | "exec" | "ipo" | "current" | "new" | "warming" | "reason" | "tag"; label: string; hint?: string; interactive?: boolean }`

* Pill shape, 11/14, weight 600, padding 2px 8px.
* Colours: background `--surface-3`, text `--ink-2`, 1px border `--line-strong`.
* `reason` and `warming` chips use a dashed border and a leading "≈" or "·".
* `tag` chips use `--accent-wash` with `--accent-ink` text.
* With `interactive`, the chip is a `<button type="button">` whose `hint` appears in a `Tooltip` on hover or focus.
* Inside table rows chips are plain spans, so links never nest inside links, and `ChipKey` defines them.

**`Tooltip` (C)**

* `role="tooltip"`, wired with `aria-describedby`. Opens on hover or focus, closes on Esc and on blur, and stays open while the pointer is over it (WCAG 1.4.13).
* Styling: `--surface-3` background, 1px `--line-strong` border, radius 8, padding 8/12, text 12/16 `--ink`, secondary lines `--ink-2`.
* Fades in over 120ms and closes instantly.

**`ExcessBar` (S)**: `{ value: number; domain: number; size: "sm" | "md"; width?: number }`

* A diverging bar from a centre zero tick. sm is 10px tall (tables), md is 14px (cards and preview).
* The data end has 4px rounded corners; the zero end is square.
* Fill `--gain` or `--loss`.
* A value beyond ±domain runs to the edge and ends in a 6px chevron notch instead of the rounded end. The adjacent text still shows the true value.
* The zero tick is 1px `--zero`, spanning the row height.
* Default width 120px; on mobile, 100% of the row's second line.
* `aria-hidden`: the number sits next to it as text.

**`ScopeToggle` (S)**: `{ scope: RankScope; hrefFor: (s: RankScope) => string; note?: boolean }`

* A visible label, "Seats counted", followed by a two-segment control of `<Link>`s:
  * The active segment gets `aria-current="true"`, a `--surface-3` fill, `--ink` text and a 2px `--accent` underline.
  * The inactive segment gets `--ink-2` text.
* Segments are at least 36px tall (44px on mobile).
* With `note`, one line of microcopy (§8.2) follows for the active scope.
* No client JS: switching is plain navigation.
* On mobile it spans the full width and sticks under the header at `top: calc(env(safe-area-inset-top, 0px) + 56px)`.

**`AsOf` (S)**: `{ date: string }` renders "Daily closes through {Oct 2, 2026}" in 12/16 `--ink-3`, or 11/14 uppercase when used in the eyebrow.

**`StripRow` (C)**: the one-row dot strip reused by `BoardStrips`, `ManyHats` and Same boardroom (seat page).

* Props: `{ label: ReactNode; href?: string; dots: { key; href; x: number; hollow?: boolean; ring?: boolean; caption?: string; tip: TipContent }[]; domain; median?: number | null; right?: ReactNode; srSummary: string }`
* **Layout:** 200px label column, the strip, then a 96px right column. The row is 36px tall.
* **Dots:** r=4. A dot within 8px of an earlier one moves to the next of 3 lanes (centre, −9px, +9px).
* **Colour and shape:** fill `--gain` or `--loss` by sign. Hollow dots are a 2px stroke with no fill. A ring (highlight) is a 2px `--ink` circle at r=7.
* **Lines:** median tick 2px `--ink`, 16px tall; zero line 1px `--zero`.
* **Captions:** tickers above the dots in ManyHats, 10/12 `--ink-3`, which drop on collision.
* **Interaction:** hovering a dot shows a `Tooltip`; clicking it opens the seat page. Dots are `aria-hidden` and `tabIndex=-1`. The row label is the tab stop, and `srSummary` is sr-only text, e.g. "NVIDIA: 15 of 15 scored seats beat the S&P; median +30.7% a year." The same data is reachable by keyboard on the company page.

### 5.2 Ranking content

**Data shape** used by every director surface (scope-resolved in P0-2):

```ts
type ScopedDirector = {
  person_id: number; slug: string; full_name: string;
  rank: number; of: number; tie: boolean;            // tie set by withTies(), rank from SQL
  score: number;                                     // annualized excess, time-weighted, this scope
  scored_seats: number; scored_years: number; beat_seats: number; scored_boards: number;
  best_seat_excess: number | null; worst_seat_excess: number | null;
  seats: number; current_seats: number;
  scored_executive_seat: boolean;                    // meaningful only when scope = "all"
  companies: SeatRef[];                              // scope-filtered, best first
};
```

**TenureTags** (seat-level rules, priority order; tooltips state the rule):

| Tag | Rule | Tooltip | Count today (159 non-exec scored seats) |
|---|---|---|---|
| **White-knuckle seat** | `max_drawdown ≤ −80%` and `relative_return_pp > 0` | "The stock fell 80% or more from a peak during this seat and still beat the S&P 500 overall." | 10 |
| **Rode the rocket** | `annualized_excess ≥ +25%` | "The stock beat the S&P 500 by 25% or more a year during this seat." | 17 |
| **Rough ride** | `annualized_excess ≤ −20%` | "The stock trailed the S&P 500 by 20% or more a year during this seat." | 11 |

**Fact chips:**

| Chip | Condition | Hint |
|---|---|---|
| **Short record** | director `scored_years < 5` | "Under 5 scored years. Short windows swing further from the S&P in both directions." |
| **Exec seat** | `executive_seat` | "Held while an employee ({officer_title}). Left out of Non-exec seats scores." |
| **From IPO** | `start_anchor_reason = 'first_trade'` | "Joined before the stock listed. Measured from the first trading day ({date}), not the join date." |
| **Current** | `seat_status = 'current'` | "Seat is ongoing. The figure moves with daily closes." |
| **New** | company added less than 30 days ago | "Added {date}." |
| **Warming up** | not ranked, `scored_years < 2` | "Needs 2 scored years (has {1.4}).{ Could be ranked around {Mar 2027} if the seat continues.}" |

**`ScoreboardStrip` (S)**: `{ stats: LeaderboardStats }`

* Five tiles. Values are 24/30 weight 700 with proportional figures; labels are 12/16 `--ink-3`.
* Tiles, in order:
  1. `{137}` "directors ranked"
  2. `{159}` "scored seats"
  3. `{81} of {137}` "had stocks that beat the S&P"
  4. `{+3.8%/yr}` "median score" (rendered with `Signed`)
  5. `{13}` "companies tracked"
* No tooltips; the definitions are in How the standings work.
* Desktop: 5 columns with 1px `--line` dividers. Mobile: a 2-column grid, with tile 5 spanning both.

**`DirectorCard` (S)**: `{ d: ScopedDirector; variant: "top" | "bottom"; scope; glow?: boolean }`

* Equal height: 136px desktop, auto on mobile with a 120px minimum. The whole card is one `<Link>` to `/d/{slug}?scope=`.
* **Grid:** RankBadge (lg, medal only in the top variant), then the body, then the figure.
* **Body:**
  * Name: 17/24, weight 650, `--ink`, 2-line clamp.
  * Line 2: 13/20 `--ink-2`, "{TSLA} · {3.6} scored yrs · {1 of 1} seats beat the S&P". With several boards, line 2 lists up to 3 tickers ("NFLX, GOOGL, ABNB").
  * Line 3: chips (Short record, From IPO, and Exec seat in the All scope) plus at most 1 tag.
* **Figure** (right-aligned):
  * `Signed` hero at 40/44 weight 800, letter-spacing −0.03em, proportional digits, with the glyph.
  * Caption 12/16 `--ink-3`: "vs S&P 500, per year while seated".
  * Below it, `--ink-3` text "of {137}" on the bottom variant, or "top {1}%" on the top variant.
* **Bottom variant:** a plain RankBadge "#137". No medal, no red fill and no emoji. Only the figure carries colour.
* **#1 top card** (`glow`): `box-shadow: 0 0 0 1px rgba(245,197,66,.40), 0 12px 32px -16px rgba(245,197,66,.35)`.
* **Hover/focus:** translateY(−2px) and the border moves to `--line-strong`. Focus adds a 2px `--focus` ring with a 2px offset.

**`Podium` (S)**: `{ top: ScopedDirector[]; bottom: ScopedDirector[] }`

* **Top:** every row with `rank ≤ 3`. Ties can produce 4 or more cards; the cap is 5, then a "+{n} more tied" link to `/rankings`.
* **Bottom:** rows whose score is ≤ the third-lowest score, ordered worst first. Their ranks render as-is ("T-135").
* **Layout:** `lg` and up, two columns (Top | Bottom) with the 3 cards stacked in each; below `lg`, Top then Bottom, one column. DOM order is 1, 2, 3.
* **Empty:** with fewer than 3 ranked directors, show only the cards that exist. With 0, use the empty state in §4.1.

**`DistributionDots` (C)**

```ts
{
  points: { slug; name; score; rank; tie; scored_seats; scored_years; tickers: string[]; hollow: boolean }[];
  domain: number;
  median: number;
  highlight?: string;
  height?: number;      // default 220
  interactive?: boolean; // forced false below md
  ofLabel: string;      // "directors"
}
```

* **Scale and bins:** x is linear over [−domain, +domain]. Bins are 2.5pp (`md` and up) or 5pp (mobile), built with d3-array `bin`. Dots are r=4 (r=3 on mobile), stacked upward with 1px gaps and ordered by score within each bin.
* **Fill:** `--gain` for score > 0, `--loss` for < 0, `--ink-3` when |score| < 0.05%. `hollow` dots (All scope, score includes a scored exec seat) are drawn as a 2px stroke ring.
* **Overflow:** values beyond ±domain stack in the edge bin, topped by a "›" or "‹" glyph and the label "{2} beyond +50%".
* **Chrome:**
  * Zero line: 1px `--zero`, full height, labelled "S&P 500 pace" (12/16 `--ink-2`, at the top).
  * Median: 2px `--ink` tick under the baseline, labelled "Median {+3.8%/yr}" in `--ink-3`.
  * X ticks every 10pp: "−50%" … "+50%". The axis title, 11/14 `--ink-3`, reads "Stock vs S&P 500, % per year during the seat(s)".
* **Legend** above the plot, left-aligned: "● ▲ Beat the S&P" · "● ▼ Trailed the S&P". In the All scope, add "○ Score includes an exec seat".
* **Annotations** come from templates and are desktop only. Two labels with 1px `--ink-2` leader lines: "#1 {Short name} {+79.8%/yr}" and "#{137} {Short name} {−45.0%/yr}". If the boxes collide, the bottom label moves below the axis. `highlight` replaces both with a ring and "{Full name}".
* **Interaction:**
  * The container is a single tab stop: `tabIndex=0`, `role="group"`, `aria-roledescription="dot plot"`, `aria-label="{137} ranked {directors} by score. Use the left and right arrow keys to step through them."`
  * Keys: ←/→ step in rank order, Home and End jump, Enter opens the director, Esc clears.
  * The pointer snaps to the nearest dot within 12px.
  * Each step announces through an `aria-live="polite"` sr region.
* **Tooltip** (and live-region text):
  * "#{14} of {137} · {Jane Doe}"
  * "{+12.4%/yr} vs S&P 500"
  * "{1} scored seat · {7.5} yrs · {NVDA}"
  * In the All scope with `hollow`, add: "Includes an exec seat"
* **Table view:** the "See it as a table →" link to `/rankings?scope=`.
* **Mobile:** not interactive, no annotations, height 180.

**`StandingsPreview` (S, plus a client tab switcher)**: `{ top: ScopedDirector[]; bottom: ScopedDirector[]; domain }`

* Desktop: two columns. Rows are 48px: RankBadge sm, then name over a 12px `--ink-3` line ("{TSLA} · {3.6} yrs"), then `ExcessBar` md at 140px, then `Signed`.
* Below `md`: `role="tablist"` with "Top 10" and "Bottom 10" tabs (←/→ between tabs). Each row becomes RankBadge, name plus line, and `Signed`, with the bar dropped.

**`BoardStrips` (C)**: `{ rows: BoardStripRow[]; domain; scope }`

* One `StripRow` per company. The label is "{NVDA}" (mono 12) "{NVIDIA}" (13 `--ink`), with a second line "{15} of {15} seats beat the S&P" (12 `--ink-3`). The right column shows the median as `Signed`.
* Sorted by median, descending. Companies with no scored seats go last, with a dashed `--line-strong` line and the text "No scored seats yet".
* A shared x-axis (ticks every 10pp) sits under the last row, and a "S&P 500 pace" label sits above the first.
* Dot tooltip:
  * "{Name} · {Jul 2010 – present}"
  * "{+9.4%/yr} vs S&P 500"
  * "Stock {+X%} · S&P 500 {+Y%}"
  * Add "Exec seat" when it applies.
* Mobile: the label sits above the strip, the strip is full width, dots are r=3, there are no tooltips, and tapping the label opens the company.

**`RecordTile` (S)**: `{ kicker; title: ReactNode; value: ReactNode; valueLabel?: string; detail: ReactNode; href: string }`

* Card padding 20. Kicker 11/14 uppercase `--ink-3`. Value 32/36 weight 800 (`Signed` with glyph, or a plain number). Title 15/20 weight 650. Detail 13/20 `--ink-2`.
* The whole tile links to the seat or director.
* Grid: 4 columns at `lg`, 2 at `sm`, 1 on mobile.

**`ManyHats` (S, using `StripRow` C)**: one row per multi-board person, sorted by spread descending.

* Label: name, plus the line "{3} boards · {20.0} pts/yr spread".
* Dots carry ticker captions.
* The right column shows the person's score (`Signed`), or "Not ranked" in `--ink-3`.

**`HowItWorks` (S)**: the 4 bullets and 2 links in §8.1, on a `--surface` card with a 680px max line length.

### 5.3 Tables

Shared rules:

* Text 13/20 with `tabular-nums`. Column heads 11/14 uppercase, weight 600, +0.08em tracking, `--ink-3`.
* Rows are 44px with a 1px `--line` divider. Hover gets a `--surface-2` wash; marks stay ≥ 3:1 on it (§6.1).
* The header sticks at the header offset.
* Each `<table>` has an sr-only `<caption>`, e.g. "Standings: {137} directors ranked by stock vs S&P 500 per year, Non-exec seats".
* Sortable heads are `<th aria-sort>` wrapping a `<Link>` to the sorted URL. The Rank column is never re-numbered.
* **Row link:** the name cell's `<Link>` gets `after:absolute after:inset-0`, with the `<tr>` set to `relative`. Nothing else in the row is interactive.

**`DirectorsTable` (S)**: `{ rows: ScopedDirector[]; domain; scope; sort; dir }`

| Column | Content |
|---|---|
| Rank | `RankBadge` sm (medals for ranks 1–3 only when sorted by score descending) |
| Director | Name (14, weight 600, `--ink`) |
| Per yr vs S&P | `Signed` plus `ExcessBar` sm |
| Seats beat S&P | "{1} of {1}" |
| Scored yrs | "{3.6}" |
| Boards | Tickers, mono 12 `--ink-2`, comma-separated |
| Best seat / Worst seat | `Signed` for each. Shown as "—" when there's only one scored seat, since it would repeat the score |
| Notes | Chips (Short record, Exec seat, From IPO, Current) plus up to 2 tags |

**`SeatsTable` (S)**: `{ rows: SeatRank[]; domain; scope; sort; dir }`

| Column | Content |
|---|---|
| Rank | Seat rank (`RankBadge`) |
| Director | Name |
| Company | Ticker (mono) and company name |
| Window | "Jul 2010 – present" |
| Yrs | Tenure in years |
| Per yr vs S&P | `Signed` plus `ExcessBar` sm |
| Stock | `Signed` pct, grouped digits, 0 decimals at 1000% and above |
| S&P 500 | `Signed` pct |
| Difference | `Signed` pp |
| Worst drop | `Signed` pct |
| Notes | Chips plus tags |

**Mobile (both tables, below `md`):** each row becomes a 2-line block with a 48px minimum height.

* Directors tab:
  * Line 1: RankBadge, name, `Signed`.
  * Line 2: ticker list · "{1 of 1} beat" · "{3.6} yrs", then a full-width `ExcessBar`, then at most 1 chip.
* Seats tab:
  * Line 1: RankBadge, name, `Signed`.
  * Line 2: "{SYM} · {window}", then the bar.
* Sorting uses a native `<select>` labelled "Sort by". There is no horizontal scrolling and no expansion.

**`ChipKey` (S)**: a `<details>` titled "What the chips mean" holding a definition list of every chip and tag, with the exact hints from §5.2.

**`UnrankedList` (S)**: `{ people: Unranked[]; scope }`

* Groups are in this order: "Needs 2 scored years ({n})", then "Only unscored seats ({n})".
* Each row: name link, a reason chip, and the seats as reason chips.
* Reason chips:
  * "Under 1 year"
  * "≈ Dates known to the year" (or "to the month"), shown with the existing return range "+40% to +65%"
  * "Dates unknown"
  * "Price history gap"
  * "Before listing"
  * "Exec seat · counted under All seats"
* A Warming-up chip appears when `eligibleAround` returns a date.
* On the Seats tab, the group is "Not scored ({n})", grouped by the same seat reasons.

**`FilterBar` (C)**

* **Row 1:**
  * Tabs as links: "Directors" | "Seats".
  * `ScopeToggle`.
  * A Companies disclosure button: "Companies: All" or "Companies: 2". It opens a panel of native checkboxes, one per company ("NVDA NVIDIA"), sorted by ticker, with a "Clear" button at the bottom. Checkboxes apply immediately.
* **Row 2:**
  * Status links: "All · Current · Former".
  * Minimum years select, labelled "Scored years": "2+ (everyone ranked)" / "5+" / "10+".
  * Checkbox "On 2+ tracked boards".
  * Search input with the placeholder "Filter by name", debounced 250ms.
  * A "Clear filters" link, shown only when filters are active.
* Updates call `router.replace(url, { scroll: false })` inside `startTransition`. While `isPending`, the table gets `aria-busy="true"` and 0.6 opacity (no spinner).
* **Mobile:** row 1 stays as is. Row 2 collapses behind a "Filters ({n})" disclosure button that opens inline, with no sheet and no focus trap.
* Controls are at least 36px tall (44px on mobile).

### 5.4 Unranked reasons (TypeScript, `standings.ts`)

* **Director:**
  * `scored_years > 0` and `< 2`: "Needs 2 scored years · has {1.4}".
  * `scored_years = 0`: "Only unscored seats".
* **Seat** (from `Perf.status` and the rules):
  * `too_short`, or `ok` with `calendar_days < 365`: "Under 1 year"
  * `approximate`: "≈ Dates known to the {year | month}"
  * `unknown_dates`: "Dates unknown"
  * `history_gap`: "Price history gap"
  * `no_price_history`: "Before listing"
  * In the Non-exec scope, `executive_seat`: "Exec seat · counted under All seats"

### 5.5 Director and seat page components

**`RankHero` (S)**: `{ person; ranked: ScopedDirector | null; other: ScopedDirector | null; scope }`

* **Header:** eyebrow "DIRECTOR", then H1 with the name. Below them, a `ScopeToggle` (sm, without the note).
* **Ranked:**
  * Line: "{#4} of {137} ranked directors · top {3}% · {Non-exec seats}".
  * Second line, when the other scope's rank differs: "#{5} of {158} with All seats". If unranked in the other scope: "Not ranked with {All seats}".
  * Hero figure: `Signed` with glyph at 56/60 (40/44 on mobile), weight 800.
  * Caption: "{NVDA} beat the S&P 500 by this much per year during the seat." With several seats: "Stocks beat the S&P 500 by this much per year, time-weighted across {2} scored seats." When the score is negative, "beat … by" becomes "trailed … by", and the figure keeps its sign.
  * Facts row: "{1 of 1} seats beat the S&P · {7.5} scored yrs · {1} board". Chips: Short record, From IPO, Exec seat.
* **Not ranked:** "Not ranked yet" (H2 size), a Warming-up chip, and the reason line from §5.4. The score shows as "—". `DistributionDots` is hidden.
* **No seats measurable at all:** "None of {name}'s seats can be measured yet." followed by the reason chips.

**`SeatBars` (C)**, adapted from `RelativeBars`: `{ rows: { key; href; label; sub; excess; total; bench; days; mdd; mddPeak; mddTrough; exec; ipo }[]; domain }`

* Bars are 20px tall (≤ 24), filled `--gain` or `--loss`, with 4px rounded data ends and a centre zero line of 1px `--zero`.
* The label sits outside the bar tip in `--ink` (`perYear`). If the bar runs past 38% of the width, the label moves inside the end in `--ink-on-mark` (5.71:1 on gain, 5.00:1 on loss).
* The side labels "Trailed the S&P" and "Beat the S&P" sit under the axis in `--ink-3`.
* Hover or focus on a row shows the tooltip:
  * "{SYM} · {Jul 2010 – present} · {16.2} yrs"
  * "Stock {+1,234.5%} · S&P 500 {+456.7%}"
  * "Per year vs S&P {+9.4%}"
  * "Worst drop {−54.1%} ({Jan 3 → Dec 28, 2022})"
  * plus "Exec seat" or "From IPO" when they apply.
* Each row is a focusable link, and focusing it shows the tooltip.
* In the Non-exec scope, exec-seat rows are drawn hollow (2px stroke, no fill), carry the chip "Exec seat · not in this score", and keep their label.

**`SeatCallout` (S)**: a card with kicker ("Best seat", "Toughest seat", "Smallest beat" or "Only scored seat"), name, window, `Signed` 32/36 with glyph, the line "Stock {+X%} vs S&P {+Y%}", and up to 1 tag. The whole card is a link.

**`WhiteKnuckle` (S)**: a Stat tile labelled "Worst drop". The value is `Signed` pct with ▼, the sub-line is "{Jan 3, 2022} → {Dec 28, 2022}", built from `max_drawdown`, `mdd_peak_date` and `mdd_trough_date`. When the seat beat the S&P and mdd ≤ −30%, add the line "Still finished ahead of the S&P."

**`SeatChips` (S)**: one link-chip per other seat: "{SYM} {+9.4%/yr}" (`Signed` text), outlined when unscored ("{SYM} · under 1 yr").

### 5.6 Modified existing components

| Component | Change |
|---|---|
| `ReturnChart` | Stock line uses `var(--series-1)`. The SPY line uses `--bench`, 2px, `strokeDasharray="6 4"`, and its legend swatch is dashed. The 0% gridline uses `--zero`. The focus ring becomes `focus-visible:outline-2 outline-[--focus] outline-offset-2`. A new `height` default stays 320; the company page passes 220. |
| `BoardTimeline` | Scored seats are filled `--gain` or `--loss` at 0.85 opacity; unscored seats are `--ink-3` at 0.55. The imprecise-start fade keeps its gradient, now running from transparent to the fill colour. End labels sit right of the bar: `perYear` in `--gain-ink`/`--loss-ink` text, or "not scored" in `--ink-3`. The current vs former distinction moves from colour to an open end at the as-of line plus a "now" label. Legend: "▲ Beat the S&P · ▼ Trailed · Grey: not scored · Fade: start known only to month or year". |
| `RelativeBars` | Becomes `SeatBars` (above). The old `bg-accent` and `text-white` go away. |
| `Stat` | Adds `size="hero"` (40/44, weight 800) and `valueClass` stays. The label keeps 12/16 `--ink-3`. |
| `Badge` | Tone `accent` maps to `--accent-wash`/`--accent-ink`, and `warn` stays for data quality only (low confidence), always with a "!" icon and text. |
| `Card` | Radius 14. Title 15/20 weight 650. |
| `Disclaimer` | Uses the footer disclaimer text (§3.3). |
| `SiteHeader` | §3.2. Remove `ThemeToggle`. |

---

## 6. Visual system (dark only)

### 6.1 Tokens

Paste this into `globals.css`, replacing all three current token blocks:

```css
:root {
  color-scheme: dark;
  /* surfaces */
  --bg: #0b0d12;          /* page */
  --surface: #141821;     /* cards, chart surface (validator surface) */
  --surface-2: #1b202b;   /* hover wash, inputs */
  --surface-3: #242a37;   /* tooltips, chips, popovers, plain rank pills */
  --line: #262c3a;        /* hairlines, gridlines (decorative) */
  --line-strong: #3a4256; /* card hover border, chip border, axis domain */
  --zero: #6b7488;        /* zero / "S&P 500 pace" line: meaningful, >= 3:1 */
  /* text */
  --ink: #f5f7fa;
  --ink-2: #c2c8d4;
  --ink-3: #8a93a6;
  --ink-on-mark: #0b0d12; /* text on gain/loss fills and medal discs */
  --focus: #f5f7fa;       /* focus ring: ink, never accent */
  /* UI accent: chrome only, never inside a plot area */
  --accent: #9085e9;
  --accent-ink: #b2a8ff;
  --accent-wash: rgba(144, 133, 233, 0.16);
  /* data */
  --gain: #199e70;        /* mark: beat the S&P */
  --loss: #d95926;        /* mark: trailed the S&P */
  --gain-ink: #3fcf98;    /* text */
  --loss-ink: #ff8462;    /* text */
  --series-1: #3987e5;    /* stock line (ReturnChart); compare seat A (phase 2) */
  --series-2: #c98500;    /* compare seat B only (phase 2); never with loss marks */
  --bench: #8a93a6;       /* SPY: 2px dashed 6 4 */
  --band: rgba(57, 135, 229, 0.12); /* tenure band on ReturnChart */
  /* medals: RankBadge only, never in charts */
  --gold: #f5c542;
  --silver: #c4ccd8;
  --bronze: #d58c55;
  /* data-quality warning: always icon + text */
  --warn: #fab219;
  --warn-wash: rgba(250, 178, 25, 0.12);
  /* legacy aliases so toneClass() keeps working */
  --pos: var(--gain-ink);
  --neg: var(--loss-ink);
  --ring: rgba(255, 255, 255, 0.10);
  --shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04), 0 12px 32px -16px rgba(0, 0, 0, 0.7);
}
```

In `@theme inline`, add `--color-{zero,ink-on-mark,focus,gain,loss,gain-ink,loss-ink,series-1,series-2,bench,gold,silver,bronze}` next to the existing mappings.

WCAG contrast, computed with the validator's exported `contrast()`:

| Token | Hex | on bg | on surface | on surface-2 | on surface-3 | Requirement |
|---|---|---|---|---|---|---|
| ink | `#f5f7fa` | 18.11 | 16.55 | 15.19 | 13.39 | text ≥ 4.5 ✓ |
| ink-2 | `#c2c8d4` | 11.57 | 10.58 | 9.71 | 8.56 | ✓ |
| ink-3 | `#8a93a6` | 6.30 | 5.76 | 5.28 | **4.66** | ✓ (11–12px captions included) |
| accent-ink | `#b2a8ff` | 9.20 | 8.41 | 7.72 | 6.80 | ✓ |
| gain-ink | `#3fcf98` | 9.80 | 8.96 | 8.22 | 7.25 | ✓ |
| loss-ink | `#ff8462` | 8.08 | 7.38 | 6.78 | 5.97 | ✓ |
| gain (mark) | `#199e70` | 5.71 | 5.22 | 4.79 | 4.22 | marks ≥ 3 ✓ |
| loss (mark) | `#d95926` | 5.00 | 4.57 | 4.20 | **3.70** | ✓ (fixes League's 2.57) |
| series-1 | `#3987e5` | 5.34 | 4.88 | 4.48 | 3.95 | ✓ |
| series-2 | `#c98500` | 6.33 | 5.78 | 5.31 | 4.68 | ✓ |
| bench | `#8a93a6` | 6.30 | 5.76 | 5.28 | 4.66 | ✓ |
| accent | `#9085e9` | 6.22 | 5.68 | 5.22 | 4.60 | UI ≥ 3 ✓ |
| zero | `#6b7488` | 4.15 | 3.79 | 3.48 | 3.06 | ≥ 3 ✓ (was 1.77) |
| line-strong | `#3a4256` | 1.94 | 1.77 | 1.63 | 1.43 | decorative only |
| ink-on-mark on gain / loss | `#0b0d12` | — | — | — | — | 5.71 / 5.00 ✓ |
| ink-on-mark on gold / silver / bronze | `#0b0d12` | — | — | — | — | 11.98 / 12.01 / 7.14 ✓ |

### 6.2 Colour roles and rules

* **Gain and loss are the only data hues on ranking surfaces.** Teal-green and vermilion keep the finance convention of "green up, red down". They are the documented palette's dark aqua and orange slots, so no hex values are eyeballed. Every value they mark also carries a sign. Hero, podium and record figures add ▲ or ▼.
* **Position carries the meaning first.** Bars and dots sit right or left of a labelled zero line; colour is redundant.
* **Text never wears mark hexes.** Use the `-ink` tokens for text and `--ink-on-mark` for text on fills.
* **Accent violet is chrome only:** the logo band, the selected scope or tab underline, tag chips and link hover. It never appears inside a plot area, as a dot ring or as a focus ring. The validator shows why (§6.3: violet vs blue fails).
* **Medal colours** appear only on `RankBadge` and the #1 card's glow.
* **Warn yellow** marks data quality only (low confidence badges), always with "!" and text. Approximate-date chips are neutral with "≈", so they never sit near the gold medal hue.
* **SPY** is neutral grey, told apart by its dash and not by hue.
* **Only one categorical series appears in phase 1** (series-1 on `ReturnChart`). Phase 2 adds series-2, only on the compare chart, which carries no gain or loss marks.

### 6.3 Validator results (recorded output)

Command (the dataviz skill's palette validator): `node validate_palette.js "<hexes>" --mode dark --surface "<surface>" --pairs <all|adjacent>`

**A. Gain/loss marks**, `"#199e70,#d95926" --surface "#141821" --pairs all`: **ALL CHECKS PASS**

```
[PASS] Lightness band         all 2 inside L 0.48–0.67
[PASS] Chroma floor           all 2 >= 0.1
[PASS] CVD separation         worst all-pairs #d95926↔#199e70 ΔE 9.4 (deutan) · tritan 32.4
[PASS] Normal-vision floor    worst all-pairs #d95926↔#199e70 ΔE 26.5 (normal)
[PASS] Contrast vs surface    all 2 >= 3:1
→ ALL CHECKS PASS
```

The same pair re-run with `--pairs adjacent` gives identical results. Re-run on the tooltip surface (`--surface "#242a37"`), it is also **ALL CHECKS PASS**, contrast ≥ 3:1 included.

**B. All phase-1 chart hues together**, gain + loss + series-1: `"#199e70,#d95926,#3987e5" --surface "#141821" --pairs all`: **ALL CHECKS PASS**

```
[PASS] CVD separation         worst all-pairs #d95926↔#199e70 ΔE 9.4 (deutan) · tritan 4.0
[PASS] Normal-vision floor    worst all-pairs #3987e5↔#199e70 ΔE 20.9 (normal)
[PASS] Contrast vs surface    all 3 >= 3:1
→ ALL CHECKS PASS
```

The same run on `--surface "#242a37"` also gives **ALL CHECKS PASS**.

**C. Accent next to gain and loss**, `"#199e70,#d95926,#9085e9" --pairs all`: **ALL CHECKS PASS** (CVD 9.4 deutan; normal-vision 24.6, violet↔aqua). Accent chrome can sit beside bars.

**D. Rejected: accent inside plots**, `"#199e70,#d95926,#3987e5,#9085e9" --pairs all`: **FAILED**

```
[FAIL] CVD separation         worst all-pairs #9085e9↔#3987e5 ΔE 1.9 (protan) · tritan 4.0
[FAIL] Normal-vision floor    worst all-pairs #9085e9↔#3987e5 ΔE 9.8 (normal)
```

This is why the accent never appears in a plot and the focus ring is ink.

**E. Phase-2 compare series**, `"#3987e5,#c98500" --pairs all`: **ALL CHECKS PASS** (CVD 27.4 protan, normal-vision 30.7).

**F. Rejected: series-2 next to loss**, `"#c98500,#d95926" --pairs all`: **FAILED** (CVD 4.8 deutan, normal-vision 10.6). The compare chart never shows loss marks.

**G. Rejected: League's loss mark on the tooltip surface**, `"#00b06c,#c52b30" --surface "#242a37" --pairs all`: **WARN**, contrast below 3:1 (`#c52b30` 2.57). Replaced.

**H. Rejected: League's series-3 vs gain**, `"#00a88b,#00b06c" --pairs all`: **FAILED** (CVD 5.1 deutan, normal-vision 5.6). Third series dropped.

**I. Rejected: documented status pair as bar fills**, `"#0ca30c,#d03b3b" --pairs all`: **FAILED** CVD (ΔE 4.1 deutan). For reference, today's `--pos`/`--neg` pair `"#0ca30c,#e66767"` sits in the WARN band (CVD 7.1).

Medal, warn and neutral colours are UI chrome and fall outside the categorical validator's scope. They are checked as WCAG contrast in §6.1.

### 6.4 Typography

The font is Inter (existing `next/font`, variable weights). JetBrains Mono (existing) is used for tickers only. There is no display or serif face.

| Role | Size / line height | Weight and tracking | Figures | Used in |
|---|---|---|---|---|
| Display XL | 56/60 (mobile 40/44) | 800, −0.03em | proportional | RankHero score, seat hero tile |
| Display L | 40/44 (mobile 32/36) | 800, −0.03em | proportional | Podium figure |
| Display M | 32/36 | 800, −0.02em | proportional | Record tiles, callouts |
| H1 | 32/38 (mobile 26/32) | 700, −0.02em | — | Page titles |
| H2 | 20/26 | 700, −0.01em | — | Section heads |
| H3 / card title | 15/20 | 650 | — | Card titles, record titles |
| Lead | 16/24 | 400, `--ink-2` | — | Hero sub |
| Body | 14/22 | 400 | — | Prose |
| Small | 13/20 | 400 | tabular in tables | Tables, card lines |
| Caption | 12/16 | 400–500, `--ink-3` | tabular on axes | Captions, axis titles |
| Micro / eyebrow / column head | 11/14 | 600, uppercase, +0.08em | — | Eyebrows, column heads, chips |
| Rank numeral | 15/20 | 700 | tabular | RankBadge |
| Ticker | 12/16 mono | 500 | — | Tickers |

Number format:

* Every signed value shows "+" or "−" (U+2212).
* Percentages carry 1 decimal. At 1000% and above use grouped digits with 0 decimals ("+623,398%").
* The per-year suffix is "%/yr". In table cells the column head carries "Per yr vs S&P" and cells show "+12.4%".
* "pts/yr" means percentage points per year (spread between seats).
* Dates follow `fmtDate`: "Oct 2, 2026"; windows read "Jul 2010 – present".

### 6.5 Space, shape, elevation

* **Grid:** a 4px base, with steps 4, 8, 12, 16, 20, 24, 32, 48, 64.
* **Page:** max width 1240px. Side gutter 16px (mobile) or 24px (`sm` and up), set once on `main`. Vertical padding uses `padding-block`.
* **Section gaps:** 48px desktop, 32px mobile. Card padding: 20px desktop, 16px mobile.
* **Radius:** cards and tiles 14; tooltips and controls 8; rank pills 6; chips fully rounded; bar data ends 4.
* **Elevation:** depth comes from the surface tier, 1px `--line` borders and the inset top highlight in `--shadow`. The only glow is the #1 card's gold glow.
* **Breakpoints** (Tailwind defaults): `sm` 640, `md` 768, `lg` 1024.
* **Dashboard grid:**
  * Podium: 2 columns at `lg`.
  * Distribution and strips: full width.
  * Preview: 2 columns at `md`.
  * Records: 4 / 2 / 1 columns.
* **Touch:** targets are ≥ 24px everywhere and ≥ 44px for mobile controls and row blocks. No element has a `min-width` wider than the viewport. Only `BoardTimeline` may scroll sideways, inside its own `overflow-x: auto` container.

### 6.6 Marks

* Lines are 2px; SPY is 2px dashed `6 4`.
* Bars: 10/14px (`ExcessBar`), 20px (`SeatBars`), and the existing timeline height. All are ≤ 24px with 4px rounded data ends.
* Dots are r=4 (r=3 on mobile). Hover rings are r=7 at 2px.
* Gridlines are 1px `--line`; the zero line is 1px `--zero`.
* Charts use one y-axis, have no 3D, and put no gradients on data marks. The only exception is the existing imprecise-start fade.
* Legends appear wherever 2 or more series or encodings exist.
* Direct labels are selective: extremes, highlights and line ends.

---

## 7. Interaction, accessibility, mobile

* **Keyboard:**
  * Tab order runs through the page's links and controls.
  * The dot plot is a single tab stop with arrow-key stepping.
  * Tab lists (mobile preview) use ←/→.
  * There are no single-key shortcuts and no command palette.
  * Every interactive element has a visible 2px `--focus` outline with a 2px offset.
* **Tooltips:** hover and focus, dismissable with Esc, hoverable. They never hold the only copy of essential information: chips have `ChipKey` and charts have tables or equivalent pages.
* **Tables as chart alternatives:**
  * DistributionDots → `/rankings`
  * BoardStrips → company Board standings
  * SeatBars → the career table on the same page
  * ReturnChart → its existing "View data table".
* **Screen readers:**
  * RankBadge reads "Tied for 4th".
  * `Signed` glyphs are aria-hidden (the sign is in the text).
  * Every chart has a `role="img"` or `group` label stating n, the metric and the scale.
* **Reduced motion:** see §8.4.
* **Mobile (below `md`), by page:**
  * **Dashboard:**
    * Hero H1 26/32, then the scope toggle (sticky), then the 2-column ScoreboardStrip.
    * Podium: Top cards, then Bottom cards, in one column.
    * Distribution: non-interactive, 5pp bins, with "See it as a table →" right under it.
    * Preview as tabs. BoardStrips with the label above each strip.
    * Records in 1 column, then Many hats, then How it works.
  * **/rankings:** row 1 filters, a "Filters ({n})" disclosure, the 2-line row blocks, and a sort `<select>`.
  * **Company:** dek, Board standings as 2-line blocks, callouts stacked, the timeline in its own scroller, Stock itself collapsed.
  * **Director:** hero figure 40/44, the facts row wraps, SeatBars label column 8rem.
  * **Seat:** a 2-column stat grid with the hero tile spanning both.

---

## 8. Microcopy, motion and states

### 8.1 How the standings work (dashboard section 8 and the methodology's first section)

1. "**Per seat:** how much the stock beat or trailed the S&P 500 (SPY, dividends reinvested) per year, from the join date to the leave date or the latest close."
2. "**Per director:** a time-weighted average of their scored seats. A seat is scored after 1 year with exact dates; a director is ranked with at least 2 scored years."
3. "**{129} of {137}** ranked directors have one scored seat, so their rank is that seat's rank: mostly which company, and which years."
4. "**Descriptive only.** A board acts as a group, and markets, sectors and timing drive most of any stock's return. A stat line about the stock, not a skill rating."

Links: "Full methodology →" · "Pick a random ranked director →"

If `single_seat_ranked / ranked_directors < 0.5`, bullet 3 becomes: "{n} of {N} ranked directors have more than one scored seat; seats held at the same time share market conditions."

### 8.2 Scope notes (ScopeToggle `note`)

* **Non-exec seats:** "Leaves out seats held while a CEO, president or other officer. People stay in, scored on their other seats."
* **All seats:** "Includes exec seats; some are measured from the stock's first trading day."

### 8.3 Empty, loading and error states

| Where | State | Copy |
|---|---|---|
| Dashboard | nobody ranked | "The standings fill in once directors have 2 scored years. A seat is scored after a year of exact dates." · "Browse companies →" |
| Podium | fewer than 3 ranked | Show only the cards that exist. No placeholder cards. |
| Bottom of the table | fewer than 6 ranked | Hide the Bottom column, so no one sits in both Top and Bottom. |
| Many hats | 0 multi-board people | Hide the section. |
| Records tile | no qualifying seat | Hide the tile; with fewer than 2 tiles, hide the section. |
| /rankings | filters match nothing | "No directors match these filters." / "No seats match these filters." · "Clear filters" |
| /rankings | Not ranked yet group empty | Hide the group. |
| Company | no scored seats | "No scored seats yet. A seat is scored after a year of exact dates." Board standings still lists every seat under "Not scored". |
| Company | stock chart has no data | Inside the details: "No price history stored for {SYM} yet." |
| Director | not ranked | "Not ranked yet" + Warming-up chip + reason. |
| Director | no measurable seats | "None of {name}'s seats can be measured yet." + reason chips |
| Seat | not scored | Chip: "Not scored · {reason}" (e.g. "under 1 year (8 months so far)"). Tiles show what's measurable; an approximate return renders as a range with "≈". |
| Any page | loading (`loading.tsx`) | The existing skeleton blocks. Shimmer is the only looping motion allowed, and it's off under reduced motion. |
| Any page | query error | "Couldn't load the standings. Try again in a minute." + "Reload" link (route `error.tsx`). |

### 8.4 Motion

| Element | Motion | Timing |
|---|---|---|
| Podium cards | fade, then rise 12px; reveal order 3rd → 2nd → 1st | 240ms `cubic-bezier(.2,.7,.2,1)`, delays 0 / 80 / 160ms |
| ExcessBar and SeatBars | grow from the zero line (`scaleX`, origin at zero) on first paint, first 10 rows only | 360ms ease-out, 15ms stagger |
| Distribution dots | fade, then rise 6px | 300ms, delay `min(i × 2ms, 150ms)` (≤ 450ms total) |
| Card hover | translateY(−2px), border colour | 120ms |
| Tooltip | fade in | 120ms in, 0ms out |
| Scope or filter change | main region fades in (keyed by scope) | 160ms |

* Numbers never count up, rows never reorder with animation, nothing loops (except the loading shimmer), and nothing scroll-jacks. No View Transitions.
* Reduced motion: extend the existing rule to `* { transition-duration: 0ms !important; animation-duration: 0ms !important; animation-delay: 0ms !important; }`. The delay reset is required: with `animation-fill-mode: both`, delayed elements would otherwise sit invisible.

---

## 9. Copy guardrails

**The subject rule.** The stock is the grammatical subject of every return verb ("beat", "trailed", "returned", "fell"). People appear only as the holders of a seat, as in "while {Name} held the seat" or "during {Name}'s seat".

**Ship (approved strings):**

1. "**Rode the rocket**: {SYM} beat the S&P 500 by {x}% a year during this seat."
2. "**White-knuckle seat**: {SYM} fell {mdd}% from a peak during this seat, and still beat the S&P 500."
3. "**Rough ride**: {SYM} trailed the S&P 500 by {x}% a year during this seat."
4. "**Top of the table**" / "**Bottom of the table**"
5. "{w} of {n} seats beat the S&P"
6. "**Same boardroom**: board-mates' seats on the same scale. Overlapping years land close together."
7. "**Many hats**: same person, different boards, very different rides."
8. "**A stat line about the stock, not a skill rating.**"
9. "Warming up: needs 2 scored years (has {1.4})."
10. "Who had the best seat in the house?"

**Forbidden.** The test `web/tests/copy-lint.test.mjs` uses `node:test` and needs no new dependency. Add `"test:copy": "node --test \"tests/**/*.test.mjs\""` to `package.json` (Node 22 rejects a bare directory). It reads every `src/**/*.{ts,tsx}` file except `src/app/admin/**` (via `fs.readdirSync(dir, { recursive: true })`) and fails on:

| Pattern (case-insensitive) | Reason / use instead |
|---|---|
| `\b(best\|worst\|top\|bottom)[- ](performing[- ])?directors?\b` | "best/worst seats by stock vs the S&P", "top/bottom of the table" |
| `\b(drove\|drives\|delivered\|generated\|created\|added\|destroyed\|produced)\b.{0,40}\b(returns?\|value\|gains?\|growth)\b` | The stock is the subject |
| `\bon (his\|her\|their\|[A-Z]\w+'s) watch\b` | causation |
| `\b(MVP\|clutch\|golden touch\|midas\|value destroyer\|tanked\|sank\|relegat\w*\|carried the board\|perfect record)\b` | causation and shaming |
| `\b(players?\|win[- ]loss\|W[–-]L\|head[- ]to[- ]head\|tale of the tape)\b` | Sports framing of people |
| `\b(follow\|copy\|avoid\|bet on\|pick) (these\|this\|the) (directors?\|boards?)\b` | Investment framing |
| `\bfounders?\b` | No founder data. Use "Exec seat" or "From IPO" |
| `\bweekly\b` | Prices are daily closes |
| `\bmoved (up\|down)\b\|\brank change\b` | No rank deltas |
| `\bindependent (seats\|directors\|league\|only)\b` | The scope label is "Non-exec seats" |
| `\bskill\b(?! rating)` | Only "not a skill rating" is allowed |
| `>\s*[^<{]*\b\d+ (people\|companies\|directors\|seats)\b` | Counts in JSX text must be computed (`{n}`), never literal |

---

## 10. Do not

1. Don't show rank deltas, ▲n/▼n movement, "Movers", "since yesterday", or build a rank-snapshot table.
2. Don't count numbers up. Render final values.
3. Don't build stepped podium blocks or a 2-1-3 order.
4. Don't give the bottom of the table red backgrounds, emoji or shaming copy, and don't show a "bottom X%".
5. Don't say "founder" anywhere. Use "Exec seat" and "From IPO".
6. Don't use players, W–L records, MVP, clutch, head-to-head of people, tale of the tape, relegated, or perfect record.
7. Don't make a person the subject of a return verb.
8. Don't assign or re-number ranks in TypeScript, break ties, or recompute ties at display precision. SQL `rank()` only.
9. Don't let filters renumber ranks or rescale bars.
10. Don't let colour carry meaning alone. Use a sign everywhere, and ▲/▼ on hero, podium and record figures.
11. Don't put medal colours in charts. Don't put accent violet inside a plot or use it as the focus ring.
12. Don't add a third categorical series. Don't put series-2 on a chart with loss marks.
13. Don't add light mode, a theme toggle or a theme script.
14. Don't switch axis scale based on the data. The phase-2 compare chart is always log.
15. Don't put share price, market cap or the company stock chart above the fold on any page.
16. Don't put raw "since IPO" totals in ranking columns. Raw totals belong in seat-page tiles and tooltips only.
17. Don't write "weekly", and don't claim "updated daily" before P0-4 has run for a week. Always show the as-of close.
18. Don't use buy/sell/follow/avoid framing.
19. Don't hard-code counts in copy (7 people, 13 companies, 137 ranked…).
20. Don't build bars taller than 24px, dual axes, 3D, or gradients on data marks (except the existing imprecise-start fade).
21. Don't add single-key shortcuts, ⌘K, View Transitions, bottom sheets or focus traps in phase 1.
22. Don't nest links. Cards and rows are one link; chips inside them are spans.
23. Don't use `title`-only explanations for anything essential.
24. Don't use "independent" for the ranking scope.
25. Don't ship the Non-exec seats default before the P0-1 migration and P0-2 queries.

---

## 11. Today's data (calibration only; every UI number is computed)

These come from read-only queries on `boardtenure_dev`, 2026-10-05, with data through Oct 2, 2026.

| Fact | Non-exec seats | All seats |
|---|---|---|
| Ranked directors | 137 | 158 |
| Scored seats | 159 | 180 |
| Seats that beat the S&P | 89 | 102 |
| Directors with score > 0 | 81 | 94 |
| Median director score | +3.8%/yr | +4.4%/yr |
| p02 / p98 director score → bar domain | −37.5 / +47.2 → **±50%/yr** | −35.3 / +45.8 → ±50%/yr |
| Directors capped at ±50 | 2 (Ellison +79.8, McCaffery +58.6) | — |
| Ranked with one scored seat | 129 | — |
| Short record (< 5 scored yrs) | 36, including #1 (3.6 yrs) and the bottom 3 | — |
| Not ranked yet | 61 | 40 |

Other facts:

* 13 companies, 209 seats and 198 people.
* 7 people are on more than one tracked board; 3 have repeat seats on the same company.
* 29 exec seats; 52 seats are measured from the first trade.
* Top 3 (Non-exec seats): Lawrence J. Ellison TSLA +79.8%/yr (1 seat, 3.6 yrs) · Michael G. McCaffery +58.6 · Persis S. Drell +49.8.
* Bottom: R. Ann Miura-Ko −45.0 · Mary Agnes (Maggie) Wilderotter −42.3 and Valerie B. Jarrett −42.3 (tied).
* Company effect, seats that beat the S&P:

  | Company | Seats beat / scored | Median seat |
  |---|---|---|
  | NVDA | 15 of 15 | +30.7%/yr |
  | JPM | 16 of 17 | +3.5%/yr |
  | KO | 0 of 16 | −3.4%/yr |
  | UBER | 0 of 14 | −7.8%/yr |
  | ABNB | 0 of 8 | −11.5%/yr |
  | LYFT | 0 of 15 | −33.5%/yr |

* Records:
  * Longest scored seat: Patricia Q. Stonesifer, AMZN, 29.4 yrs, +19.1%/yr.
  * Deepest drawdown that still beat the S&P: the same AMZN seat, −94.4% (Dec 10, 1999 → Sep 28, 2001). After deduplication the tile shows NVDA −89.7%, a tie between A. Brooke Seawell and Harvey C. Jones.
  * Steepest 5+ year lag: LYFT −30.5%/yr, a tie between David Lawee and Prashant (Sean) Aggarwal.
  * Widest spread: Ann Mather, NFLX +9.4 / GOOGL +5.3 / ABNB −10.6 = 20.0 pts/yr.
* With the 6 companies that are coming (WMT, COST, CRM, V, INTC, ORCL): ORCL and CRM add exec seats measured from the first trade. Under All seats, Ellison's score will combine TSLA with ORCL; under Non-exec seats it stays TSLA only. P0-1 is what makes the cards correct in that case.

---

## 12. Build order and acceptance

| Step | Work | Done when |
|---|---|---|
| P0 (≈1 day) | 0006 migration; scope-aware queries and stats; new queries; `standings.ts`; daily refresh (P0-4) | The SQL check passes. `/api/v1/rankings` ranks equal web ranks in both scopes. `bt check` is green on the daily schedule |
| P1a | Dark tokens, delete ThemeToggle, primitives (`Signed`, `RankBadge`, `Chip`, `Tooltip`, `ExcessBar`, `ScopeToggle`, `StripRow`), modified ReturnChart/BoardTimeline/RelativeBars | Validator runs A–C in §6.3 pass. No light styles remain |
| P1b | `/` dashboard, then `/rankings` | Matches §4.1–4.2 at 1240, 768 and 390px; no horizontal page scroll at 390px |
| P1c | Company, director and seat pages; `/companies`; methodology section; `/random` | §4.3–4.8 |
| P1d | Copy lint and checks | `npm run test:copy` passes. A keyboard-only pass reaches every podium card, dot, table row and filter. axe reports 0 violations. Reduced motion shows final states instantly. Tooltips dismiss with Esc |
| P2 | `/compare` (seat vs seat, always-log, series-1/2), career small multiples | Validator run E passes. No loss marks on the compare chart |

## 13. Amendments after the build (2026-10-07)

* **Verbatim filing quotes are exempt from §9.** Machine-verified SEC quotes in Sources render exactly as filed, even if
  they say "founder". Our own notes (`start_basis`, board-event summaries) are cleaned at render time by `plainNote()`.
* **P0-4 not adopted.** Prices are daily closes; the refresh job stays weekly. Copy says only "Daily closes through {date}".
* **New labels:** "Only exec seats" (reason and unranked group), "Under 1 year after listing" (reason), "Smallest lag"
  (company callout when every seat trailed), and the Current chip hint "Seat is ongoing; measured through the latest daily close."
* **Years are floored** everywhere, so "1.9 yrs" never reads as 2.0 next to the 2-year threshold.
* **Layout:** wide table columns appear from 1200px, not `lg`; table chips may wrap; unscored timeline bars use 0.7 opacity
  for contrast.
* **Copy lint** also scans `docs/methodology.md` prose (code and the literal-count rule are skipped there).
