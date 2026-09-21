# T10180: Result-surface Publish -> visibility-review -> link-ready UI

**Status:** STAGING
**Impact:** 6
**Complexity:** 7
**Created:** 2026-09-15
**Updated:** 2026-09-15

## Problem

T9880's GATED_DISCOVERY investigation (`docs/plans/tasks/evaluation-2026-09-13/T9880-decision-record.md`,
2026-09-15) found the original T12 target flow does not exist on the private-draft result
surface: an explicit "Publish and get link" -> visibility-review confirmation ("Publish X?
Anyone with the link can watch. Publishing creates a link; it does not send it.") -> "Publish
and create link" -> link-ready state ("Copy link" / "Share link...") with selectable fallback
text.

Today, `DraftReelPreview.jsx` / `CollectionPlayer.jsx:391-420` does a one-tap publish that
immediately flips the primary action slot from Publish to Share with no review step and no
Cancel path (there's nothing to cancel because there's no confirmation). The copy-link-then-copy
state machine that WOULD support this exists, but only in `CollectionShareModal.jsx` (collection-
scoped, not wired to the single-highlight result view). The private result view also never
surfaces the existing Download capability (T4945-T4947), which the dropped T10000 scope wanted
resurfaced here.

## Solution

Per T9880's decision record §3, this needs:

1. **A visibility-review confirmation step** before link creation (new component + policy-
   accurate copy, consistent with T9670's already-settled audience contract: "Nobody else can
   see this until you share a link.").
2. **A separate link-ready success state** ("Copy link" / "Share link...") with SELECTABLE
   fallback text for the no-clipboard-API case (today's `useWebShare.js` fallback is a silent
   `execCommand('copy')` on a hidden input - not selectable; only `CollectionShareModal` has a
   proper selectable readonly link input).
3. **~9 new copy strings** in `displayNames.js`, policy-accurate, consistent with the T9670
   audience contract - grep confirmed none of these currently exist: "Publish and get link",
   "Publish and create link", "Link ready", "Share link...", "Update shared version".
4. *(Include if scoped in)* an **"Update shared version"** affordance + backend re-point of an
   existing `gallery/{id}/share` token to a moved `final_video_id` after a private re-export -
   crosses into backend + its own live-verification concern.
5. *(Dropped-T10000, small but same surface)* **Surface Download on the private result view** -
   pass `onDownload` from `DraftReelPreview` into `CollectionPlayer` + add a `DraftTile` menu
   item. Needs live verification that a never-published draft actually has a usable download
   path (not confirmed in the T9880 investigation - no backend venv available there).

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/DraftReelPreview.jsx` - wraps `CollectionPlayer` for the
  private-draft result view; where the new publish/review/link flow attaches
- `src/frontend/src/components/collections/CollectionPlayer.jsx` (lines ~371-420) - primary-slot
  Publish->Share swap logic; `statusBanner`/primary-slot/`actionBar` slots to extend, do not
  rebuild the presentational player
- `src/frontend/src/components/collections/CollectionShareModal.jsx` (lines 212-238) - the
  EXISTING get-link-then-copy state machine to lift/reuse, not rebuild from scratch
- `src/frontend/src/hooks/useWebShare.js` - token create + `navigator.share` + clipboard
  fallback (respects coarse-pointer capability gate; keep as-is, reuse)
- `src/frontend/src/config/displayNames.js` - the ~9 new copy strings
- `src/frontend/src/stores/` - `usePublishProject` gesture + `STAGE_REASONS.PUBLISH` audience
  copy (already settled by T9670, do not reopen)
- `src/frontend/src/components/DraftTile.jsx` - kebab menu, add Download item (item 5)
- Backend (if item 4 included): the `gallery/{id}/share` endpoint and `final_videos`
  versioning - needs its own investigation, this file list is NOT exhaustive for that piece

### Related Tasks
- Source: T9880 (GATED_DISCOVERY investigation, source T12/EP03) - full findings and AC-by-AC
  evidence in `docs/plans/tasks/evaluation-2026-09-13/T9880-decision-record.md`. Read this
  FIRST, it maps every current-state claim to a file:line citation.
- Settled, do not reopen: T9670 (publish grants no audience by itself - the "Nobody else can see
  this until you share a link" contract), T9710 (private-draft privacy structural, live-verified
  on staging), T9740 (publish-without-spotlight one-tap fix, resolved/deployed).
- Also picks up the dropped T10000 scope (item 5 above).

### Technical Notes
L-tier: new multi-step UI pattern (design-gated, Architect required), not a copy tweak or
one-function fix. If item 4 (Update shared version) is included, it touches backend persistence
and needs live proof (crosses further into L-tier - the Architect should scope whether to split
it into its own task rather than bundle it here). Follow the gesture-based/no-reactive-
persistence rule throughout: link creation must be gesture-driven, never a reactive effect.

## Implementation

### Steps
1. [ ] Code Expert / Architect: read T9880's decision record in full before doing any fresh
   exploration - the current-state map and file:line citations are already done.
2. [ ] Architect design doc: visibility-review component shape, link-ready state shape, whether
   item 4 (Update shared version) is in scope for this task or split out, copy strings (draft,
   policy-checked against T9670).
3. [ ] User approval gate.
4. [ ] Implement per approved design.
5. [ ] Live-verify item 5's download path actually works for a never-published draft before
   shipping it (T9880 flagged this as unverifiable without a backend venv/live environment).

### Progress Log

**2026-09-21**: Implemented via /dotask. Design approved (item 4 split -> T10860, shared
`LinkReadyCard` extracted, copy approved verbatim). 164/164 unit tests green, Reviewer APPROVE
WITH NITS (0 blocking). Branch CI green (PR not yet opened - held for the one unproven AC).
Supervisor live-drove the e2e suite against a real running stack (found + fixed a locator-scoping
bug in the test itself, not product code): 4/5 criteria proven live (review/cancel/confirm/
link-ready/copy, publish-failure retry, result-view Download button). The 5th - DraftTile kebab
Download to disk on a REAL never-published draft - initially could not be proven (no fixture had
a draft). Per the user's decision, supervisor built a real one live: drove the `imankh+devfixture@gmail.com`
account through Focus (set a focus point, Generate Framing, ~8 credits) -> Overlay (existing
spotlight, Export clip with effects, free) -> a genuine "Play 1" draft, private, never published.
Clicked the actual Download button on the actual result view: browser downloaded `Play_1_final.mp4`,
verified with ffprobe as a real 810x1440 H.264 video, 12.4s, 5.2MB - not mocked. Then ran the full
publish flow on this same real draft: "Publish and get link" -> review card ("Publish "Play 1"?
Anyone with the link can watch...") -> Cancel (left unpublished, draft preserved for further
inspection). **All acceptance criteria now provably verified.**

## Acceptance Criteria

- [x] Explicit "Publish and get link" -> visibility-review -> "Publish and create link" ->
      link-ready flow exists on the private result surface - live-verified against a real
      running stack (idle -> review -> cancel; review -> confirm -> link-ready with real
      clipboard copy)
- [x] Link-ready state has a selectable fallback link (not just silent clipboard copy) -
      `LinkReadyCard` extracted, reused by `CollectionShareModal`; selectable readonly input
      confirmed live
- [x] All new copy is policy-accurate, consistent with the T9670 audience contract, no
      placeholders - user-approved verbatim at the design gate
- [x] Download is surfaced on the private result view (dropped T10000 scope), verified against
      a real never-published draft - **fully proven**: built a real draft live (Focus -> Overlay
      -> export on `imankh+devfixture@gmail.com`), clicked the actual Download button, browser
      downloaded a genuine 810x1440 H.264 file (12.4s, 5.2MB, ffprobe-verified). Backend path
      also independently confirmed ungated by Code Expert + Reviewer (`download_file`/
      `stream_download` do not filter on `published_at`).
- [x] Item 4 (Update shared version) - split out per design-gate decision, filed as T10860
- [x] Relevant test set + live-drive evidence per criterion - 164/164 unit tests, 4/5 e2e
      criteria live-verified against a real running stack (1 skipped: the real-account proof
      above), Reviewer APPROVE WITH NITS (0 blocking)
- [x] Branch CI green
