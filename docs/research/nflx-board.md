# Netflix, Inc. board of directors, as of 2026-10-04

- **Company:** Netflix, Inc. (CIK 0001065280, Nasdaq: NFLX). Incorporated in Delaware in August 1997 as NetFlix.com, Inc. The IPO prospectus is dated 2002-05-22 and the stock first traded on 2002-05-23.
- **Newest filing reviewed:** 2026-10-02 (Forms 4).
- **Machine-readable seed:** `data/seed/nflx_board_research.json`. It has 133 evidence items with verbatim quotes, and `bt seed verify` reports 0 problems.
- **Board structure:** The board was classified at the IPO. Declassification was approved on 2022-06-02. Terms became one year from the 2023 meeting, and the whole board has been elected annually since 2025, so current directors have no class.
- **Stock split:** a 10-for-1 split took effect on 2025-11-14. Adjust the stock-return series for it.

## Current board (11 directors)

| Director | Role | Joined | Basis for join date | Confidence |
|---|---|---|---|---|
| Jay C. Hoag | Independent Chairman since 2026-06-04. Lead Independent Director from 2012 to 2026-06-04. Chairs Nominating & Governance | 1999-06 (month) | IPO prospectus: "since June 1999" | high |
| Richard N. Barton | Independent; Audit | 2002-05 (month) | Prospectus: "since May 2002". The S-1/A table as of 2002-05-02 already lists him | high |
| Ann Mather | Independent; Audit chair | 2010-07-01 | 8-K 5.02 effective date (appointed 2010-06-10); Form 3 matches | high |
| Leslie J. Kilgore | Independent since 2015 (year only); Compensation chair since 2025-06-22. Former CMO, and an employee-director from 2012-01-20 to 2012-02-02 | 2012-01-20 | 8-K 5.02 effective date (appointed 2012-01-19) | high |
| Brad Smith | Independent; Nominating & Governance | 2015-03-30 | 8-K 5.02 effective date (appointed 2015-03-26); Form 3 matches | high |
| Mathias Döpfner | Independent; Compensation | 2018-09-18 | 8-K 5.02 effective date (appointed 2018-09-12); Form 3 matches | high |
| Ted Sarandos | co-CEO and director (CEO-director) | 2020-07-14 | 8-K 5.02 effective date (appointed 2020-07-13) | high |
| Strive Masiyiwa | Independent; Nominating & Governance | 2020-12-16 | 8-K 5.02 "effective immediately" and press release. The Form 3 says 2020-12-24 (see conflicts) | high |
| Greg Peters | co-CEO and director (CEO-director) | 2023-01-13 | 8-K 5.02 | high |
| Ambassador Susan Rice | Independent; Nominating & Governance. This is her second stint | 2023-09-06 | 8-K 5.02; Form 3 matches | high |
| Elinor Mertz | Independent; Audit | 2025-06-22 | 8-K 5.02; Form 3 matches | high |

- **Committee rosters** come from the 2026 proxy (filed 2026-04-16):
  - Audit: Mather (chair), Barton, Mertz.
  - Compensation: Kilgore (chair), Döpfner, and Sweeney (resigned since).
  - Nominating & Governance: Hoag (chair), Smith, Masiyiwa, Rice.
- **Independence:** the 2026 proxy finds every director independent except Hastings, Peters and Sarandos.
- **Evidence of continued service:**
  - All nine non-employee directors received the monthly director option grant on 2026-10-01 (Forms 4).
  - The co-CEOs filed Forms 4 as directors in August 2026.
  - All 11 were elected on 2026-06-04 for terms to 2027.
- **Reporting-owner CIKs:**

| Director | CIK |
|---|---|
| Hoag | 0001082906 |
| Barton | 0001184230 |
| Mather | 0001244892 |
| Kilgore | 0001218352 |
| Smith | 0001193119 |
| Döpfner | 0001370931 |
| Sarandos | 0001393838 |
| Masiyiwa | 0001837857 |
| Peters | 0001583109 |
| Rice | 0001735710 |
| Mertz | 0001938411 |

## Departures since 2020-01-01

| Director | Joined | Left | Reason | Notes |
|---|---|---|---|---|
| Ambassador Susan Rice (first stint) | 2018-03-26 | 2021-01-20 | resigned | Notified the company 2020-12-09. Class II. Rejoined 2023-09-06. |
| Rodolphe Belmer | 2018-01-23 | 2022-10-27 | resigned | Notified the company 2022-10-19. Class I. Served on Compensation. |
| Timothy M. Haley | 1998-06 (month) | 2025-06-05 | did not stand | Left at the 2025 annual meeting. Compensation chair. CIK 0001201583. |
| Reed Hastings | 1997 (year) | 2026-06-04 | did not stand | Co-founder. His roles are listed below the table. CIK 0001033331. |
| Anne Sweeney | 2015-03-30 | 2026-07-26 | resigned | Re-elected on 2026-06-04, then resigned with no disagreement. CIK 0001638276. |

- Rice's CIK is 0001735710 for both stints, and Belmer's is 0001729146.
- **Hastings' roles:**
  - Chairman from 1997.
  - CEO from 1998-09 per the prospectus (see conflicts), co-CEO with Sarandos from 2020-07-14.
  - Executive Chairman from 2023-01-13 to 2025-04-17.
  - Non-executive Chairman from 2025-04-17 until the 2026-06-04 meeting.
- **Hoag's 2025 vote:** at the 2025-06-05 meeting Hoag did not receive a majority. The board rejected his resignation on 2025-06-22, so his service is recorded as continuous.

## Conflicts

1. **Masiyiwa's start day.** The 8-K and press release give 2020-12-16, with the appointment "effective immediately". His Form 3 gives 2020-12-24. I recorded the 8-K date.
2. **Start of Hastings' CEO role.** The 2002 prospectus says "Chief Executive Officer since September 1998". The 2026 proxy says "Chief Executive Officer, President (1999-January 2023)". I used 1998-09, at medium confidence.

## Open questions

- **Board size.** Eleven is implied: the 2026 proxy lists 13, minus Hastings and Sweeney. No filing states the authorized number, and no size change was ever disclosed in an 8-K, so there are no `BOARD_SIZE_CHANGE` events.
- **Sweeney's Compensation Committee seat.** No filing names a replacement. Committees have not been re-disclosed since the 2026 proxy, except that Hoag still chairs Nominating & Governance.
- **Join dates without a day:**
  - Hastings: year only (1997). The prospectus says "Chairman of the Board since inception", and inception was 1997-08-29.
  - Haley 1998-06, Hoag 1999-06, Barton 2002-05: month only.
  - Hoag's lead-independent-director start: 2012 only. The 2012 proxy says none had been appointed, and the 2013 proxy says the position was "recently created".
  - Kilgore's independence: 2015 only.
- **Hastings, 1997 to 1998-09.** No filing reviewed says whether he was an employee before he became CEO.
- **Other boards not recorded as public.** These lists come from Netflix bios only. Belmer's 2022 bio names CEO-and-director roles at Atos SE and Eutelsat, but its "Other Public Company Boards" field reads "None". Hastings' 2026 bio names Bloomberg LP and Anthropic PBC. Neither set is recorded as public-company boards.
- **Directors who left before 2020** are out of scope. Example: A. George (Skip) Battle retired 2018-12-15.
