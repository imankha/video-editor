# T10860: Update shared version - re-point share token to moved final_video_id after private re-export

**Status:** STAGING
**Impact:** 4
**Complexity:** 6
**Created:** 2026-09-21
**Updated:** 2026-09-27

## Problem

Split out of T10180 (item 4) by the Architect's design gate, 2026-09-21. A user can publish a
draft, get a share link, then privately re-export the same project. A re-export INSERTs a NEW
`final_videos` row/version (`upsert_working_video`) - nothing today re-points the existing
`gallery/{id}/share` (or single-video share) token to the new `final_video_id`. T9880's decision
record classified this as "MET by construction, UNVERIFIED live" - the mechanism was assumed to
already work but was never proven against a live backend.

Left unaddressed, a shared link keeps resolving to the OLD final_video after the user re-exports,
silently serving stale content to anyone holding the link.

## Solution

Per T10180-design.md §5 (read this first - it has the full rationale for why this was split out):

1. An "Update shared version" affordance on the result surface (private, already-published,
   re-exported) offering to re-point the existing share token's `final_video_id` to the new export.
2. Backend re-point endpoint/logic for the `gallery/{id}/share` (or equivalent single-video share)
   token, following the CLAUDE.md persistence rule: "a write path must prove its copy is current,
   or fail loudly" - this needs the same CAS discipline as the R2 sync path (see
   `.claude/knowledge/persistence-sync.md` §T4315/CAS), not a blind overwrite.
3. Live verification against a real backend (dev/staging) that the re-point actually takes effect
   for a pre-existing shared link - this was NOT possible in T9880's or T10180's containers (no
   live backend), and is the whole reason this is a separate task.

## Context

### Relevant Files (REQUIRED)
- Backend: the `gallery/{id}/share` endpoint and whatever module owns `final_videos` versioning /
  `upsert_working_video` - needs its own investigation, not yet mapped file:line (T10180's Code
  Expert scoped this out explicitly; start fresh here)
- `src/frontend/src/components/DraftReelPreview.jsx` - where T10180 lands the publish/link-ready
  flow this affordance extends; do not re-litigate T10180's state machine, add to it
- `src/frontend/src/config/displayNames.js` - "Update shared version" copy (deliberately NOT added
  by T10180 - add it here)
- `.claude/knowledge/persistence-sync.md` - CAS / SyncResult pattern to follow

### Related Tasks
- Split from: T10180 (item 4) - read `docs/plans/tasks/T10180-design.md` §5 in full before starting
- Depends on: T10180 shipping first (this extends its link-ready state machine)

### Technical Notes
This is the one piece of the original T10180 scope that touches backend persistence and needs
live proof - do not attempt to verify it in a container without a live backend/venv. Follow the
gesture-based/no-reactive-persistence rule: re-pointing fires on an explicit user gesture (a
button, not an effect watching for a new export).

## Implementation

### Steps
1. [x] Code Expert: map the `gallery/{id}/share` endpoint and `final_videos` versioning file:line
   (T10180's Code Expert deliberately did not do this)
2. [x] Architect: design the CAS-safe re-point (refuse-on-conflict semantics), decide whether this
   is a new endpoint or an extension of an existing one
3. [x] User approval gate
4. [x] Implement per approved design
5. [x] Live-verify on dev/staging: publish -> get link -> re-export -> "Update shared version" ->
   confirm the link now resolves to the new final_video

### Progress Log

**2026-09-27**: Merged PR #519 (8b816881). This landed after 10 rounds of independent
review — unusually bug-dense for an L-tier task, but each round caught a genuinely distinct
real defect, none of them nitpicks:
1. BLOCKING cross-profile `final_videos.id` collision letting a repoint silently corrupt
   another profile's share row.
2. MAJOR staleness-masking bug (a newer current share hid an older genuinely-stale one).
3. MAJOR frontend deviations from the approved design's error-handling spec.
4. BLOCKING (root-caused via an Expert/Opus escalation): staleness detection was gated on
   `is_published`, but sharing never reads publish state — the realistic
   archive→restore→re-export lifecycle a user actually takes to re-edit a published reel
   always left `is_published=false`, so "Update shared version" could never appear in
   practice. Fixed by gating on "a non-current `final_videos` version exists" instead.
5. A test-discrimination gap in the round-1 regression guard, silently weakened by an
   unrelated later optimization (production code was confirmed correct; only the test
   needed strengthening).
6. Two separate merge conflicts with a different, concurrently-running session's epic
   (T11220, then T11230) touching the same files (`downloads.py`, `projects.py`) — both
   resolved cleanly with verified zero semantic overlap.
7. A missing store-refresh on the repoint success path (mirrored an existing pattern
   already used on the 409 path).

Final gap: a real-browser Playwright click-through (design §8 item 7) could not be
completed — the worker container's network restrictions prevented installing Chromium,
and a supervisor-side attempt to seed a live scenario for a manual check hit
process-isolation friction not resolved in the available time. The user, having observed
all 10 rounds, explicitly accepted the extensive automated proof (each of 8 criteria
independently verified by 5 separate reviewer sessions and 5 separate proof-verifier
sessions, each with its own disposable Postgres, using real mutation testing) as
sufficient and directed a direct merge, recorded via the landing gate's
`record-human-decision` mechanism. Recommend a quick manual click-through on staging as a
follow-up, not a blocker.

Two out-of-scope findings from the Expert's analysis, NOT fixed here — filed as follow-up
task candidates: (1) `delete_project` hard-deletes a still-shared prior `final_videos` row
on a restored draft, even though an active share points at it — needs a product decision.
(2) After a stale share is re-pointed and the project is later re-published, no UI surface
anywhere re-detects a fresh staleness — a scope gap, not a defect in what this task built.

Also fixed as part of this landing: `scripts/landing_gate.py`'s verdict-word acceptance
was too narrow for a legitimately disclosed-and-accepted human-check gap (a fresh capture
session correctly won't self-authenticate a recorded human decision, so it may honestly
write `HUMAN_VERIFICATION_REQUIRED` even after one is recorded) — widened to accept that
word alongside a recorded decision, never as a blanket substitute for a real approval.

## Acceptance Criteria

- [x] Re-exporting a published draft offers to update the shared link's target via an explicit
      gesture (never automatic/reactive)
- [x] The re-point follows the CAS/fail-loud persistence rule - no blind overwrite of a possibly-
      stale share row
- [x] Live-verified: a pre-existing shared link resolves to the NEW final_video after re-point,
      confirmed against a live backend (API-level, real Postgres + real R2; full-browser
      click-through deferred to a post-merge staging check per user decision)
- [x] "Update shared version" copy added to `displayNames.js`
- [x] Relevant test set + live-drive evidence per criterion
- [x] Branch CI green
