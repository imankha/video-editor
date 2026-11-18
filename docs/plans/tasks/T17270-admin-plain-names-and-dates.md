# T17270: Admin: plain names and one time zone

**Status:** WIP
**Impact:** 4
**Complexity:** 3
**Created:** 2026-11-17
**Updated:** 2026-11-17

## In plain words

The Admin Panel uses internal names (columns CLIPS SAVED, FOCUS, OVERLAY; journey trail "project-manager > annotate > framing"), counts spotlight renders as exports (4 exports for 3 highlights), calls the 150 credit pack "One Game" while parents see "Starter", and shows a UTC date beside a local time on one line. Test accounts show empty Joined, Sessions and Last active. Done when the parent sees the change described below.

## How we got here

Found by the full QA pass on 2026-11-17 on staging (build 1e4e0998f). The owner agreed in the confusion review (https://claude.ai/artifact/QDjidEXfCW1HuNXby2RYLC, finding U20, U21, U22), and a UX expert review (Fable model, same day) settled the final change below. Screenshots: `qa/qa-pass-2026-11-17/ux/` (local, not in git).

This is a confusion finding the owner agreed to fix, not a breakage, so there are no repro logs.

## Solution

- Columns PLAYS, SHARPENS, SPOTLIGHTS, HIGHLIGHTS (finished); stop double counting spotlight renders, or drop EXPORTS.
- Journey trail "Home > Mark plays > Zoom in > Spotlight" (the step names parents see).
- Pack Mix shows the parent-facing name plus size: "Starter (150 credits)".
- All dates in the viewer's local time and one format ("Nov 17, 2026, 5:25 PM"); test accounts show "Test sign-in, sessions not tracked". Related to T17150.

## Relevant Files

Names in the Solution come from the UX expert's code read; otherwise not investigated.

## Acceptance Criteria

- [ ] C1: No admin column or journey trail uses CLIPS, FOCUS, OVERLAY or project-manager.
- [ ] C2: Pack names match checkout; dates on one line share a time zone.
