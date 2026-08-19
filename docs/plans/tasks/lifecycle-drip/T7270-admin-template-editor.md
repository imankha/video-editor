# T7270: Admin Panel — Drip Template Editor + Send Log

**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Created:** 2026-08-19
**Updated:** 2026-08-19

Epic task 5/5 — see [EPIC.md](EPIC.md) §3 (templates are data) and the rollout sequence.
Depends on T7230 (tables), T7260 (`GET /api/admin/drip/sends`, `POST /api/admin/drip/run`).

## Problem

"Easy to update" is only true if the founder can edit copy without a deploy or SQL. The
admin panel needs: the 4×7 template grid, an editor with test-send, the send log, and the
dry-run plan view — the operational surface for the whole drip system.

## Solution

### Backend (small, CRUD only)
- `GET /api/admin/drip/templates` — all rows, ordered (drip_day, stage)
- `PUT /api/admin/drip/templates/{id}` — `{subject, body, enabled}`; validate with the SAME
  caps as bulk email (`BULK_SUBJECT_MAX`/`BULK_BODY_MAX`); stamp `updated_at`
- `POST /api/admin/drip/templates/{id}/test` — renders with SAMPLE context (`game_name:
  "Aloha Summer Sizzle"`, `clip_count: 13`) and sends to the calling admin's own address
  via `send_drip_email` — mirrors `admin_bulk_email`'s `test=true` behavior exactly,
  including the unsubscribe footer (admin sees the real thing; their click on it is
  harmless — they're suppressed by `is_admin` anyway)

### Frontend
New admin section "Drip Emails" alongside the existing admin components
(`src/frontend/src/components/admin/`), three views:

1. **Template grid** — rows = stage (funnel order), columns = day 1/3/7/14. Each cell:
   subject preview (truncated), enabled toggle state, click → editor. Disabled cells
   visually muted. This grid IS the mental model of the whole system — one glance answers
   "who gets what when."
2. **Editor modal** — subject input + body textarea (blank-line-paragraph hint, identical
   affordances to `BulkEmailModal.jsx`: char caps, validation messages, "Send test to me",
   NO backdrop-close per project rule). Save = explicit button → PUT (gesture-based
   persistence; no autosave, no reactive writes). Show the stage's allowed variables under
   the textarea (`{{game_name}}`, `{{clip_count}}` per T7230's whitelist) — and surface the
   backend's render error verbatim if a test-send uses one that doesn't resolve.
3. **Activity view** — send log table (`GET /drip/sends`: when, who, day, stage, status,
   detail) + a "Preview next tick (dry run)" button rendering the plan from
   `POST /drip/run {dry_run: true}` — the founder's answer to "who's getting emailed
   tonight?"

State in `adminStore.js` following its existing patterns (fetch actions, loading flags,
raw API shapes stored — no transformation before store per frontend rules).

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/admin.py` — 3 CRUD/test endpoints (thin)
- `src/frontend/src/components/admin/DripEmailsPanel.jsx` — NEW (grid + log + dry-run)
- `src/frontend/src/components/admin/DripTemplateEditor.jsx` — NEW (modal)
- `src/frontend/src/stores/adminStore.js` — fetch/save/test actions
- `src/frontend/src/screens/AdminScreen.jsx` — mount the section
- Tests: `DripEmailsPanel.test.jsx`, `DripTemplateEditor.test.jsx`, backend endpoint tests

### Related Tasks
- Depends on: T7230, T7260 (endpoints)
- Completes the epic — after this lands, run the EPIC rollout sequence

### Technical Notes
- Reuse `BulkEmailModal.jsx`'s validation/test-send/confirm patterns — same file is the
  style reference; do not extract a shared abstraction yet (2 uses < abstract-on-3rd rule).
- No delete endpoint: the 28 cells are the fixed universe; `enabled=false` is the off
  switch. No create endpoint either — new stages/days are schema-level decisions (a
  migration), not runtime data.
- Editor must not strip/alter whitespace — blank lines are the paragraph format.

## Implementation

### Steps
1. [ ] Backend CRUD + test-send endpoints + tests
2. [ ] adminStore actions
3. [ ] Grid + editor modal + activity view
4. [ ] Frontend unit tests (grid renders 28 cells, editor validation, test-send flow)
5. [ ] Live check: edit a template on dev, test-send to self, verify footer + variables

### Progress Log

## Acceptance Criteria

- [ ] Founder edits copy → saved without deploy → next dry-run plan reflects it
- [ ] Test-send delivers the REAL rendered email (drip shell, unsubscribe footer, sample vars)
- [ ] Enabled toggle round-trips; disabled cell shows muted in grid and `skipped` in dry-run
- [ ] Send log shows the staging verification sends
- [ ] Tests pass (relevant set)
