# T17150: Admin numbers disagree

**Status:** STAGING
**Impact:** 5
**Complexity:** 4
**Created:** 2026-11-17
**Updated:** 2026-11-17

## In plain words

Three numbers on the Admin Panel contradict each other, so the owner cannot trust them for decisions. (1) Turning on the "Paying" filter raises the Users count from 10 to 13 ("10 of 10 on page · 13 users total"); a filter should only ever lower it, and Pack Mix shows only 3 purchases. (2) In the Campaigns table the campaign "abc" shows "UPLOAD TRIES 7 / 3" with "UPLOAD SUCCESS 42.86%": more successes than tries, and the percentage is 3 out of 7 the wrong way round. (3) "Manage Campaigns" says "No campaigns yet." while the Campaigns table lists "abc".

## How we got here

Found by the full QA pass on 2026-11-17 on staging (build 1e4e0998f), as the admin imankh@gmail.com, at desktop 1440x900, with the "Real" filter on.

## Repro steps

1. Sign in as an admin, open the Admin Panel (profile window, "Admin").
2. Open "Users". Read "N users total" (10). Click the "Paying" filter. Read it again.
3. In the Dimension "Campaigns" table, read the "abc" row's UPLOAD SUCCESS and UPLOAD TRIES.
4. Click "Manage Campaigns".

**Expected:** Paying gives 3 or fewer users; tries are at least successes and the percentage is successes over tries; Manage Campaigns lists "abc" (or the table explains where "abc" comes from).
**Actual:** "13 users total" with Paying on; "42.86%" and "7 / 3"; "No campaigns yet."
**Repeats:** Paying 2 of 2 (after reload); the other two always (static numbers).
**Also checked at:** 768 and 390 widths show the same numbers.

## Evidence

- Screenshots: `qa/qa-pass-2026-11-17/bugs/r2-B14-paying-13.png`, `r2-B13-campaign-abc.png`, `r2-B16-manage-campaigns-empty.png` (local, not in git)
- Console, network: no errors.
- Server log: not pulled.

## Solution

Every filter lowers or keeps the counts, every tries/successes pair has successes at most tries with the percentage computed from them, and Manage Campaigns agrees with the Campaigns table.

## Relevant Files

Not investigated.

## Acceptance Criteria

- [ ] C1: With any single filter on, "users total" is never higher than with no filter.
- [ ] C2: In every Dimension table, successes never exceed tries and the percentage equals successes divided by tries.
- [ ] C3: A campaign shown in the Campaigns table is listed in Manage Campaigns, or the table says why it is not.
