# T8230: Admin People table: split "Exports" into Focus / Overlay / other

**Status:** TODO
**Impact:** 4
**Complexity:** 2
**Created:** 2026-08-31

## Problem

The admin People table's "Exports" column shows a single combined number (bknoto: 3). The user
wants it reported as **Focus exports** separately from **Overlay exports** separately from any
other export type, so an admin can see what kind of work the account is actually doing.

Good news: this data is already tracked per-type and just isn't surfaced. `FLOW_EVENTS`
(`src/backend/app/analytics.py:129`) already has distinct events with their own `daily_col`s:
- `framing_exported` — label "Focus Exported", `daily_col=framing_exports` (L166)
- `overlay_exported` — label "Overlay Exported", `daily_col=overlay_exports` (L167)
- `export_completed` — label "Exported", `daily_col=exports_completed` (L144) — the generic
  combined counter the table currently reads (`admin.py` L243,
  `user_actions.get("export_completed", 0)`)

So this is a surfacing task, not new instrumentation: `admin.py list_users`'s existing
`user_actions` dict (already keyed by every action name per user) already contains
`framing_exported`/`overlay_exported` counts for free — they just aren't read into the response.

## Solution

1. Add `framing_exported_count` and `overlay_exported_count` to the `list_users` per-user dict in
   `admin.py` (same pattern as the existing three `_count` fields, L241-244) —
   `user_actions.get("framing_exported", 0)` / `user_actions.get("overlay_exported", 0)`.
2. Decide with the user whether to REPLACE the single "Exports" column with two columns
   (Focus / Overlay), or keep "Exports" as a combined total and ADD the two as detail (e.g. a
   tooltip, or visible only in the row-expand / User Detail panel). "Any other export" (the
   `before_after`/`multi_clip` export types, if they have their own analytics events — check
   `export_jobs.type` values beyond `framing`/`overlay` seen in this account, e.g. whether
   `custom_project`/`before_after` renders emit their own FLOW_EVENTS or just fold into the
   generic `export_completed`) should be called out explicitly rather than silently dropped from
   the sum.
3. Update `UserTable.jsx` (L46-48 region) with the new column(s).

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/analytics.py` — `FLOW_EVENTS` (L129), confirm which export types emit their own
  event vs only the generic `export_completed`
- `src/backend/app/routers/admin.py` — `list_users` (~L241-244)
- `src/frontend/src/components/admin/UserTable.jsx` — column definitions (L46-48)
- Possibly `src/frontend/src/components/admin/UserDetailPanel.jsx` if the breakdown lands there
  instead of/in addition to the table

### Related Tasks
- [[T8220]] — same table, adjacent "Games" column has a real correctness issue (this task's
  "Exports" ask is a clean surfacing job, not a correctness fix — do not block one on the other)
- T8110 (in flight) — reworks server-side sort for this same table; check whether new sortable
  columns need to be added to its whitelist if this task adds real columns

## Implementation

### Steps
1. [ ] Audit `export_jobs.type` / FLOW_EVENTS for the full set of export types this account (and
       others) actually produce, to confirm "framing" + "overlay" covers "any other export" or
       whether a residual bucket is needed
2. [ ] Add the per-type counts to `list_users`
3. [ ] Surface in `UserTable.jsx` (columns or detail panel, per user decision on layout)
4. [ ] Verify against bknoto: 2 `framing_exported` + 3 `overlay_exported`-shaped totals (confirm
       exact split from live data, don't assume the 3/3 seen in this investigation's raw
       `user_actions` dump is final — re-verify after implementing)

## Acceptance Criteria

- [ ] Admin can see Focus-export count and Overlay-export count separately for any account
- [ ] Any export type outside Focus/Overlay is accounted for, not silently dropped
