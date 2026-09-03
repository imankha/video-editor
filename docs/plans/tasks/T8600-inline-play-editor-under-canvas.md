# T8600: Inline Play Editor - add/edit plays under the canvas, details behind a popup

**Status:** TODO
**Impact:** 7
**Complexity:** 5
**Created:** 2026-09-03
**Updated:** 2026-09-03

## Problem

Users are used to inputs happening UNDER the canvas (product-owner directive, 2026-09-03), but Add Play / Edit Play opens the form in the right sidebar on desktop - far from the video being clipped and from the scrub preview it drives. The form also charges every play with a full field stack (rating, big tag grid, name, notes, layer, teammates, reel toggle) when only the start/end time is actually required.

Falsifiable version (from the UX review): "moving the create form under the canvas (desktop, non-fullscreen) will cause more opened forms to end in Save, measured by `add_clip_opened_no_save` per `add_clip_opened` falling on desktop while mobile stays flat."

## Solution

Decision artifact (mockups + choices, user-reviewed): claude.ai artifact "Inline Play Editor - Design Proposal" (session 2026-09-03). UX review: [../ux/UX-inline-play-editor-2026-09-03.md](../ux/UX-inline-play-editor-2026-09-03.md).

1. **Editor replaces the timeline (desktop non-fullscreen only).** Clicking Add Play / Edit Play swaps the timeline area under the canvas for a compact editor strip until Save or close/discard; the sidebar form render goes away on desktop and the sidebar keeps showing the clip list. The strip: row 1 = ClipScrubRegion with live start/end time chips (the ONLY required input); row 2 = rating stars, compact name field ("Play N" default stays), Teammates input (Team layer only - must stay visible, see invariants), "Add details" button, Save/Cancel. Strip is tinted green (add) / yellow (edit) with an "Editing: {clip name}" header so the mode change is loud.
2. **Button row swap, existing gating logic unchanged.** While the editor is open, the Add/Edit Play CTA + Playback Annotations + Shared w/ Tagged rows are replaced by: Layer (LayerSegmentedControl), Create Reel (current create-toggle/edit-button logic), and Focus (EDIT MODE ONLY, gated on `region.autoProjectId` as today). Each control keeps its existing conditions - only position changes.
3. **Tags + Notes move behind "Add details"** (both optional). Surface decided per screen size (user decision 2026-09-03, simulated in the artifact):
   - Desktop (>=1024px): expand-in-place - the strip grows downward with its own max-height scroll for the tag grid; canvas stays fully visible.
   - Mobile (<1024px / coarse pointer, i.e. `useIsMobile()`): full-screen popup over the T8140 bottom sheet (the sheet's layout + pinned Save stay); explicit Done/X only, never backdrop-close; never stacks with the T8140 sport question (details closes before save runs).
   - Fullscreen annotate: docked panel unchanged (keeps the full form, v1).
   - Label the button with a count when hidden content exists (e.g. "Details (2 tags, note)").

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/modes/AnnotateModeView.jsx` - timeline/CTA area swap (non-fullscreen branch ~L760-927); hosts the new under-canvas editor render
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.jsx` - new compact strip layout + details expansion/popup; keyboard handling (Enter/Esc/1-5)
- `src/frontend/src/modes/annotate/components/ClipsSidePanel.jsx` - remove the desktop inline form render (~L343-359); rewire ClipDetailsEditor gating so EDITING never shows two live editors (~L323)
- `src/frontend/src/modes/annotate/components/AnnotateControls.jsx` - hide/re-purpose the transport-bar Add button while the under-canvas editor is open (it would silently flip edit->create via `startCreating`)
- `src/frontend/src/containers/AnnotateContainer.jsx` - handler plumbing, seek-outside-closes-overlay decision when there is no timeline to seek
- `src/frontend/src/screens/AnnotateScreen.jsx` - prop wiring
- New: details popup/expansion component (Tags + Notes), shared by both surfaces
- Tests: `AnnotateModeView.cta.test.jsx`, `AnnotateFullscreenOverlay.*.test.jsx`, `ClipsSidePanel.*.test.jsx`, `e2e/clip-selection-state-machine.spec.js` + a new e2e spec for the inline flow

### Related Tasks
- Depends on: **T8590** (desktop Edit Play missing-existingClip bug - it corrupts both this surface and the metric this task is judged by)
- Builds on: T8130 (primary CTA), T8140 (one-tap defaults, sticky Save, abandonment beacon), T5700/T5725 (layers/teammates), T8030 (My Athlete default)

### Technical Notes / invariants that MUST survive
- **Persistence unchanged:** the form stays memory-only until the Save gesture; surgical create/update calls as today. No useEffect persistence.
- **Teammates never hide in the details surface** - they render inline in the strip when layer = Team, because switching to My Athlete clears them and T5725 requires that clearing to be VISIBLE.
- **Teammate auto-commit on Save (T7540)** and rating->auto-name->Create Reel auto-arm coupling carry over.
- **`add_clip_opened_no_save` beacon keeps firing** on create-opens that close unsaved; add a per-surface discriminator (e.g. `:inline_desktop`) within the existing T7515 `action:{reason}` vocabulary so desktop/mobile split without schema change.
- **Esc layering:** Esc closes the details expansion/popup first, then the editor; 1-5 keys keep ignoring INPUT/TEXTAREA targets.
- **T8130 landmine:** every relocated button needs distinct title/accessible-name from simultaneously rendered siblings (Playwright strict mode); the CTA's isEditMode gate is untouched (CTA is hidden while editing).
- **Focus mid-edit:** navigating to Focus with unsaved form state must resolve explicitly (save-first prompt), never silent discard.
- UX evidence caveat: beacon has ~zero prod days (T8140 just landed). Prefer letting it accumulate 1-2 weekend cycles before judging the redesign; mobile stays the control group for the RELOCATION (not for the details collapse, which touches mobile too).

### Open choices (recorded in the decision artifact, defaults chosen)
1. Create Reel placement: user proposed the button row; UX recommends a labeled toggle near Rating (its state auto-flips with rating). DEFAULT: button row per user proposal unless user says otherwise.
2. Timeline context while editing: (a) none (v1 default), (b) slim read-only mini-timeline above the strip (UX-recommended), (c) scrub-as-zoomed-inset (most work).
3. Split: UX recommends shipping the details collapse (all form factors) separately from the desktop relocation. DEFAULT: one task, both halves, per user framing.

## Implementation

### Steps
1. [ ] T8590 landed first (hard prerequisite)
2. [ ] ui-designer spec pass on the strip (Tailwind-level details: heights, tints, responsive behavior 1024-1440px)
3. [ ] Architect design doc (L-tier: 6+ files, new layout pattern, mode-swap state) -> user approval gate
4. [ ] Implement strip layout + timeline/CTA swap + button row
5. [ ] Details expansion (desktop) + full-screen popup (mobile sheet)
6. [ ] Rewire ClipsSidePanel gating; hide transport Add button mid-edit
7. [ ] Beacon surface discriminator
8. [ ] Tests (unit + e2e, real browser for the popup/keyboard layering) + live-drive QA at 1280px and 390x844

## Acceptance Criteria

- [ ] Desktop non-fullscreen: Add Play / Edit Play opens the editor strip in place of the timeline; Save/close restores timeline + normal buttons
- [ ] Only start/end is required; one-tap Save still lands a valid "Play N" clip
- [ ] Tags + Notes reachable via Add details on BOTH desktop (expand-in-place) and mobile (full-screen popup); nothing in them required
- [ ] Layer / Create Reel / (edit-mode) Focus appear in the swapped button row with unchanged gating logic
- [ ] All invariants above verified (teammates visibility, Esc layering, beacon, no duplicate editors, no title collisions)
- [ ] Mobile sheet layout and fullscreen docked panel otherwise unchanged
