# T10860: Update shared version - re-point share token to moved final_video_id after private re-export

**Status:** TODO
**Impact:** 4
**Complexity:** 6
**Created:** 2026-09-21
**Updated:** 2026-09-21

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
1. [ ] Code Expert: map the `gallery/{id}/share` endpoint and `final_videos` versioning file:line
   (T10180's Code Expert deliberately did not do this)
2. [ ] Architect: design the CAS-safe re-point (refuse-on-conflict semantics), decide whether this
   is a new endpoint or an extension of an existing one
3. [ ] User approval gate
4. [ ] Implement per approved design
5. [ ] Live-verify on dev/staging: publish -> get link -> re-export -> "Update shared version" ->
   confirm the link now resolves to the new final_video

## Acceptance Criteria

- [ ] Re-exporting a published draft offers to update the shared link's target via an explicit
      gesture (never automatic/reactive)
- [ ] The re-point follows the CAS/fail-loud persistence rule - no blind overwrite of a possibly-
      stale share row
- [ ] Live-verified: a pre-existing shared link resolves to the NEW final_video after re-point,
      confirmed against a live backend
- [ ] "Update shared version" copy added to `displayNames.js`
- [ ] Relevant test set + live-drive evidence per criterion
- [ ] Branch CI green
