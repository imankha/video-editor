# T8130: Annotate primary CTA + Plays/Clips/Reels naming

**Status:** STAGING
**Impact:** 8
**Complexity:** 4
**Created:** 2026-08-31
**Epic:** [First-Clip Funnel](EPIC.md)

## Problem

The first-clip action is the visually weakest interactive element on the screen, and the
word "clip" names two different objects in the app.

Evidence (theory doc T1): on mobile the primary action is a tiny unlabeled green "+" in
the transport bar while the two largest buttons ("Playback Annotations" - disabled - and
"Shared") are useless to a first-timer. Three surfaces teach three contradictory
gestures: empty-state copy says *Use "Add Clip" button* (no such button exists on
mobile), *or pause in fullscreen*; desktop sidebar says *Click timeline to add clip*.
Checked prediction: desktop's labeled "+ Add Clip" converts no better than mobile (7/14
vs 3/5 all-time) - the whole hierarchy is broken, not the label. `clip_save_failed` = 0:
users are never refused; they never arrive.

Vocabulary collision: "Add Clip" exists on Annotate AND inside the reel-building flow
(`ClipSelectorSidebar.jsx:385`); the drafts tab is "Reel Drafts" and its action is
"New Reel", so drafts and published reels blur together.

## Solution

**Naming, user-approved 2026-08-31 (refined same day): Plays -> Clips -> Highlight
Reels.** UI strings only; no identifier, event-name, or schema renames (greppability
rule; analytics vocabulary untouched).

"New Clip" was explicitly REJECTED for the assembly button: it implies uploading a clip
and editing it directly (a real future feature - T7860's direct-clip path must keep that
name available), and the button actually opens the all-clips browser with filters that
assembles selected clips into a highlight video.

| Surface | Today | Becomes |
|---|---|---|
| Annotate create action | "Add Clip" / unlabeled "+" | **"Add Play"** |
| Home drafts tab (`displayNames.js` DRAFTS) | "Reel Drafts" | **"Clips"** |
| Assembly button (`ProjectManager.jsx:1213`) | "New Reel" | **"Build Highlight Reel"** |
| Assembly button location | Reel Drafts tab | **moves to the Highlight Reels surface** |
| Published surface | "My Reels" | **"Highlight Reels"** (houses the build button; visually separate from Clips) |
| Reel-building picker (`ClipSelectorSidebar.jsx`) | "Add Clip" | **"Add Play"** or clip-consistent label (settle in step 1) |

IA note: the separation the user wants is Clips (per-clip work) vs Highlight Reels
(assembled videos). Default proposal: the existing My Reels surface becomes the
"Highlight Reels" tab and gains the Build Highlight Reel button; the old Reel Drafts tab
becomes "Clips". If implementation reveals drafts are multi-clip assemblies rather than
per-clip work items, STOP and re-confirm the tab mapping with the user before renaming.

Hierarchy rescue (both platforms):
1. One full-width, high-contrast **"Add Play"** button directly under the video - the
   single loudest element on the screen; >=44pt; bottom third on mobile.
2. Demote "Playback Annotations" and "Shared" to text-level prominence until
   `clip_count > 0`.
3. Delete the two alternate instructions; the empty state's copy becomes the button
   itself (a launchpad, not a paragraph). Fullscreen-pause path stays but is no longer
   the taught gesture.
4. One sentence of backward-capture teaching at first use, on the button's first coach
   mark: "When something great happens, tap - we grab the last few seconds." (Full coach
   mark system is tutorial-redesign; here it is one static hint under the button when
   `clip_count == 0`.)

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/modes/annotate/AnnotateMode.jsx` - controls bar button
- `src/frontend/src/modes/annotate/layers/ClipRegionLayer.jsx` - empty-state copy
- `src/frontend/src/containers/AnnotateContainer.jsx` - Add Clip handler wiring
- `src/frontend/src/components/ClipSelectorSidebar.jsx` - reel-side "Add Clip"
- `src/frontend/src/config/displayNames.js` - DRAFTS display name
- `src/frontend/src/components/ProjectManager.jsx` - tab + "New Reel" button
- `src/frontend/src/config/questDefinitions.jsx` + `src/frontend/src/data/questDefinitions.js` - quest copy references "Add Clip"
- Tests: `ProjectManager.homeTabDefaults.test.jsx`, `config/questDefinitions.test.jsx`, `modes/annotate/hooks/useClipSelection.test.js`, `modes/annotate/constants/__tests__/tagRegistry.test.js`

### Related Tasks
- After T8120 (so the CTA experiment reads clean of the occlusion fix).
- Coordinate with tutorial-redesign step copy (T7620) - the guided path must say the
  same words ("Add Play", "Clips", "New Clip").
- T7580 precedent: Focus/Export naming stands; T7700 reversed one Overlay button - do
  not touch that button.

### Technical Notes
- Strings live near use or in `displayNames.js` - extend that config where a string
  appears in 2+ places; do not invent a registry.
- Screenshot evidence: `mobile-08-annotate-during-upload.png`, `desktop-01/03`.

## Implementation

### Steps
1. [x] Rename pass (table above) + update string-asserting tests - EXCEPT the Reel
       Drafts tab itself: mid-flight IA guard confirmed it holds a genuine mix of
       single-clip and multi-clip content, not cleanly per-clip, so renaming it to
       "Clips" (and relocating the assembly button off it) was deferred - split out as
       [T8360](../T8360-split-single-vs-multiclip-drafts.md) per user decision
       2026-09-02, rather than force a misleading name or a half-finished relocation.
2. [x] CTA hierarchy: full-width Add Play, demotions, empty-state-as-button
3. [x] First-use hint line (clip_count == 0 only)
4. [ ] Mobile 390x844 + desktop screenshots for the diff - browser live-drive not
       possible in the container (no chromium/network); CTA hierarchy asserted
       structurally by unit tests instead, documented rather than claimed

### Progress Log

**2026-09-02**: Implemented, CI green. Post-hoc review (the L-tier review step was
accidentally skipped during implementation) found 2 BLOCKING issues, both fixed before
merge: (1) the new CTA didn't gate on edit-mode, so selecting a clip made the loudest
button on screen say "Add Play" while its handler actually edited the selected clip
(and skipped recording `add_clip_opened`) - now mirrors `AnnotateControls`' label/icon
flip; (2) ~40 e2e spec files, including 4 mandatory staging-gate specs, still asserted
on the old "My Reels"/"New Reel" strings - swept in full. Merged to master.

## Acceptance Criteria

- [x] "Add Play" is the single loudest element on Annotate on both platforms; no
      alternate instruction copy remains
- [x] Every surface uses the approved vocabulary EXCEPT the Reel Drafts tab (deferred to
      T8360, see Implementation step 1); no UI string says "Add Clip" anywhere
- [x] Analytics event names and code identifiers unchanged (grep-proof independently
      re-verified by review)
- [ ] Metric to watch: `add_clip_opened / annotation_completed` (baseline ~1/2, last-30d 5/11)
      - post-ship metric, not verifiable pre-deploy
