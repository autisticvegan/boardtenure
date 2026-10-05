# Apple Inc. board of directors, as of 2026-10-04

- **Company:** Apple Inc. (CIK 0000320193, confirmed from the EDGAR submissions JSON). Ticker AAPL on The Nasdaq Stock Market LLC. California corporation, incorporated 1977-01-03 as Apple Computer, Inc.
- **Listing:** no SEC filing gives the IPO date. The 1980-12-12 first trade predates EDGAR, so the seed uses `listed_since_year: 1980` (per the brief, also unverified in filings).
- **Board structure:** not classified. Every director is elected annually.
- **Sources:** the newest filing reviewed is from 2026-10-02. The seed is `data/seed/aapl_board_research.json` (109 evidence items, every quote verified, `bt seed verify` reports 0 problems). Raw files are cached under `data/raw/sec/320193/`.

## Current board (9 directors)

| Director | Role | Joined | Basis for join date | Confidence |
|---|---|---|---|---|
| Tim Cook | Executive Chair since 2026-09-01. CEO and director 2011-08-24 to 2026-09-01. Not independent | 2011-08-24 | 8-K 5.02: appointed to the board the day he became CEO | high |
| John Ternus | CEO and director since 2026-09-01. Not independent (he is CEO; no formal determination yet) | 2026-09-01 | 8-K 5.02: board acted 2026-04-17, effective 2026-09-01; Form 3 matches | high |
| Art Levinson | Lead Independent Director since 2026-09-01. Chair 2011-11-15 to 2026-09-01. Co-lead Director 2005 to 2011-11-15 (medium). Member of People and Compensation | 2000 (year) | Every proxy and the FY2000 10-K say "Director Since 2000". He joined after the 2000-04-20 annual meeting | high (year) |
| Wanda Austin | Independent. Audit | 2024-02-28 | Elected at the 2024 annual meeting (proxy nomination plus 8-K 5.07); Form 3 matches | high |
| Alex Gorsky | Independent. People and Compensation; Nominating | 2021-11-09 | 8-K 5.02; Form 3 matches | high |
| Andrea Jung | Independent. People and Compensation chair; Nominating | 2008-01-04 | 8-K 5.02; Form 3 matches | high |
| Monica Lozano | Independent. Audit | 2021-01-04 | 8-K 5.02: board acted 2020-12-29, effective 2021-01-04; Form 3 matches | high |
| Ron Sugar | Independent. Audit chair | 2010-11-16 | 8-K 5.02; Form 3 matches | high |
| Sue Wagner | Independent. Nominating chair; Audit | 2014-07-15 | 8-K 5.02; Form 3 matches | high |

Committee assignments come from the 2026 proxy (filed 2026-01-08). No filing reports committee changes made at or after the 2026-09-01 transition. The 2026 proxy found every director except Cook independent.

**Reporting-owner CIKs:**

| Director | CIK |
|---|---|
| Cook | 0001214156 |
| Ternus | 0002148403 |
| Levinson | 0001214128 |
| Austin | 0001690882 |
| Gorsky | 0001453149 |
| Jung | 0001051401 |
| Lozano | 0001179864 |
| Sugar | 0001216519 |
| Wagner | 0001059235 |

**Authorized board size:** the bylaws have fixed it at nine since 2021-11-09 (8 → 9). The 2024-08-20 restatement still says nine. Eight directors were elected on 2026-02-24, and Ternus filled the ninth seat.

## Departures since 2020-01-01

| Director | Joined | Left | Reason | CIK |
|---|---|---|---|---|
| James Bell | 2015-10-01 (8-K 5.02) | 2024-02-28 | Retired: did not stand for re-election under the age-75 guideline. His term ended at the 2024 annual meeting | 0001182047 |
| Al Gore | 2003-03-19 (press release, 8-K Ex. 99.1) | 2024-02-28 | Retired: did not stand for re-election under the age-75 guideline. His term ended at the 2024 annual meeting | 0001224944 |

These were the only departures in the period. Bob Iger resigned on 2019-09-10, which is outside the scope.

## Conflicts

- The 2026 proxy says "over the past four years" the board added three members. The 8-Ks date those additions to 2021-01-04 (Lozano), 2021-11-09 (Gorsky) and 2024-02-28 (Austin), so Lozano joined about five years before that proxy. This is a wording issue only; the dates come from the 8-Ks.
- Levinson's Lead Independent Director role rests on the April 2026 8-K's "will become ... on the Transition Date". The 8-K/A, Cook's Form 4 ("Executive Chair") and Ternus's Form 3 ("CEO") confirm that the transition happened. No later filing restates Levinson's own title.

## Open questions

- **Levinson's exact 2000 start date.** No filing states it. His automatic 10,000-share director options are dated August 14 in every year from 2004 to 2009. The plan grants these options on the 4th and later anniversaries of a director's initial election, which points to 2000-08-14. That is an inference, so the seed keeps year precision.
- **When Levinson's co-lead title started and ended.** Filings place the start in 2005 (between the 2005-03-15 proxy and the 2005-12-01 10-K). The end is set to his appointment as Chair (medium confidence).
- **Andrea Jung's co-lead period.** She was a Co-lead Director from 2009. No filing says when that ended: the title had gone by the 2012-01-09 proxy, and it may have ended on 2011-11-15. The role is left out of the seed.
- **Ternus's committees and other boards.** No filing gives his committees, a formal independence determination, or a biography that would list other public boards. The next proxy (around January 2027) should settle these.
- **IPO date and exchange tier.** No SEC filing reviewed states either.
