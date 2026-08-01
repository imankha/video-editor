# T5740: Share sheet UX + growth instrumentation

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-07-21
**Updated:** 2026-07-21

Task 5 of 5 in the [Share the Game epic](EPIC.md).

## Problem

T5720 makes the link exist; this task makes the SEND moment effortless and the loop
measurable. Without a native share sheet + prefilled message, "drop it in the team WhatsApp"
is copy-paste friction; without funnel numbers, we can't tune the watch page CTA or know
whether the loop converts.

## Solution (AS BUILT — 2026-08-01)

> **The original "share sheet + second entry point" premise is DEAD.** The user rejected a
> native share sheet and any new share affordance: the existing `ShareGameModal.jsx` already
> does the job. The real work was making that ONE modal control **which clips each recipient
> receives** (Google-Docs-style per-recipient permission), plus the read-only funnel. Design:
> [T5740-ui-design.md](T5740-ui-design.md).

1. **Per-recipient clip scope in the ONE modal.** `ShareGameModal.jsx` restructured into
   **People with access** (each added email becomes a row with a per-recipient scope dropdown
   + expandable clip preview) and **General access** (the T5720 public link + revoke
   confirmation + revoked state). No new entry point, no native share sheet.
   - Scope options (user-approved verbatim, `src/constants/shareClipScope.js`): **"All team
     clips"** (default) / **"Only clips they're tagged in"** / **"Game only (no clips)"**.
   - Zero-clip tagged-only recipient is surfaced BEFORE send twice (inline amber row warning +
     send-time banner); send stays enabled (game-only is a legitimate choice).
2. **Backend scope wiring (reuse, not rebuild).** `POST /api/games/{id}/share` body is now
   `{recipients: [{email, scope}]}` (one honest shape; `ShareGameModal` is the only caller).
   `materialization.resolve_scoped_clips(conn, game_id, email, scope)` is the single source of
   truth: ALL_TEAM → `team_layer_clips_for_game`; TAGGED_ONLY → `_filter_clips_for_tag` per
   `teammate_emails` tag, **intersected with the team layer** so `my_athlete != 0` clips never
   cross; GAME_ONLY → `[]`. The same resolver backs `GET /api/games/{id}/share-preview?email=`
   so the preview list equals what is materialized. `shared_by` stays NON-NULL every scope
   (T5330). No schema change.
3. **Funnel instrumentation (READS only).** `share_created`/`share_viewed` already emitted by
   T5720; claims already in `share_claims` (T5730). `GET /api/admin/analytics/share-funnel`
   (read-only) answers per link: views (`share_view_counts` reads the sharer's logged
   `share_viewed` events) → claims (`share_claims`) → activated (claimers with
   `export_completed`). Surface: "Share Links" sub-tab (`admin/ShareFunnelTable.jsx`). No new
   tables, migration count stays 21, analytics never on a user path.
4. **Revoke polish** — revoke goes through a confirmation dialog (backdrop inert per the
   no-backdrop-dismiss rule; Escape closes the confirm first), then a visible revoked state
   with "Create new link", inside the General access section.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/ProjectManager.jsx` — game card menu entry
- `src/frontend/src/components/RecapPlayerModal.jsx` — Team Recap share entry
- New shared share-sheet helper/component (navigator.share + copy fallback; coordinate with
  Dual-Camera T5510)
- `src/backend/app/routers/admin.py` + admin frontend — funnel surface
- Milestone recording: `record_milestone` call sites (T4840 beacon pattern)

### Related Tasks
- Depends on: T5720 (link), T5730 (claims)
- Related: Dual-Camera T5510 (share-sheet component reuse), T442 (Web Share API prior art if
  landed)

### Technical Notes
- Knowledge doc: [backend-services.md](../../../.claude/knowledge/backend-services.md)
- Analytics reads must not sit on response paths (T4840 lesson — background/beacon only).
- M-tier: UI + read-only admin surface; no schema beyond T5730's `share_claims`.

## Implementation

### Steps
1. [ ] UI Designer: share sheet copy + dual-affordance placement (approval gate)
2. [ ] Share-sheet component + entry points + toasts
3. [ ] Funnel milestones wiring + admin surface
4. [ ] Revoke confirmation/state polish
5. [ ] Tests + real-device navigator.share verify (Android + iOS)

### Progress Log

**2026-07-21**: Created from the epic consolidation.

## Acceptance Criteria

- [ ] One tap from game card or Team Recap opens the native share sheet (mobile) or copies
      the link (desktop) with the prefilled message
- [ ] Admin can see per-link: views, claims, activated accounts
- [ ] Revoke has a confirmation and a visible revoked state
- [ ] No analytics work on response paths
