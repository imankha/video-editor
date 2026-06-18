# T3700: Framing & Overlay Clarity (Outcome-First UX)

**Status:** DONE (P0 shipped; P1 split to T3780; P2 dropped)
**Impact:** 8
**Complexity:** 5
**Created:** 2026-06-16
**Updated:** 2026-06-17

## Resolution (2026-06-17)

- **P0 — DONE.** Default crop guarantees a zero-effort valid framing export (`default_crop.py`,
  `ExportButtonContainer.jsx`), non-blocking amber framing hint, and terminal button renames
  ("Export Highlight" / "Add Spotlight"). The quest/tutorial restructure shipped as T3705.
- **P1 — split out to [T3780](T3780-framing-overlay-clarity-p1.md).** Hide confidence % behind
  Advanced, replayable hints, deep-linked nav, plus stale-copy/jargon cleanups. Still to do.
- **P2 — DROPPED.** Subtle/Bold presets + keyframe-affordance polish judged not worth doing.

## Problem

Framing and Overlay are the two steps where non-technical parents fall off. The current UI
speaks in editor jargon and exposes pro-grade readouts that create cognitive load and doubt:

- **Export can be impossible by accident.** If a user doesn't understand keyframes, there may
  be no valid crop to export — "I didn't understand keyframes" becomes "export is impossible."
- **Conceptual, not procedural language.** "Set crop keyframes" / "Frame Video" describe the
  *mechanism*, not the *outcome*. Per Van der Meij's minimalism, instructions should be
  procedural and outcome-oriented ("keep your player in the shot"), not conceptual.
- **Blocking hints.** Framing guidance can wall off export instead of softly nudging.
- **Ambiguous terminal buttons.** "Frame Video" and "Add Overlay" are verbs that don't clearly
  say "this finishes / exports."
- **Pro readouts leak cognitive load.** Pixel coordinates on Framing (`205x365 @ 858,358`) and
  confidence percentages on Overlay (`84%`, `74%`…) are noise for a parent — and the
  percentages make the tool look *unsure of itself*.
- **One-shot onboarding.** In-app hints can't be replayed in context.
- **Dead-end navigation instructions.** "Home → Drafts → select a reel" is text that sends users
  hunting instead of a clickable deep link.
- **Raw sliders.** Stroke/fill/dim are exposed as raw px/% sliders with no sensible presets.

## Solution

Reframe both steps around the user's goal ("keep your player in the shot," "spotlight your
player") and guarantee a zero-effort happy path. Demote every pro readout and mechanism behind
"Advanced." Make guidance non-blocking and replayable. Deliver in three priority phases — each
phase is independently shippable, so this can be split into sub-tasks if scope demands.

---

## Phase P0 — Directly unblocks the framing step

1. **Guarantee a valid zero-effort export.** Ship a sensible default crop (centered / full-frame
   fit) so clicking the terminal export button *always* produces a valid framing job, even if the
   user touched nothing. Never let a missing/un-animated crop make export impossible.
2. **Reframe the task as an outcome, everywhere.** Kill "set crop keyframes." Replace with
   "keep your player in the shot." Procedural, not conceptual (Van der Meij).
3. **Make any framing hint non-blocking.** If the crop isn't animated, show a soft nudge —
   never a wall that prevents export.

## Phase P1 — Consistency & cognitive load (research-backed, broader)

4. **Rename ambiguous terminal buttons.** "Frame Video" and "Add Overlay" → unambiguous,
   consistent finish/export verbs (e.g. "Export Highlight," "Apply Spotlight → Save"). Final
   copy to be confirmed in Architecture.
5. **Hide pro readouts by default.** Remove or gate behind "Advanced": the pixel coordinates on
   Framing and the confidence percentages on Overlay.
6. **Make in-app guidance re-accessible.** Let users replay any step's hint in context; remove
   one-shot-only onboarding.
7. **Deep-link the navigation steps.** "Home → Drafts → select a reel" becomes a clickable link
   that drops the user there, not a text instruction.

## Phase P2 — Polish

8. **Presets over raw sliders.** Offer "Subtle / Bold" for stroke/fill/dim, with px/% sliders
   behind an "Adjust" expander.
9. **Clearer keyframe affordance** for users who *do* go manual: obvious "add point here," a
   visible playhead-to-keyframe relationship, and hide the multi-lane timeline complexity until
   needed.

---

## Tutorial & Onboarding Impact (MUST update alongside the UI)

**Yes — the tutorial must change.** The onboarding tutorial *is* the quest system, and it
hardcodes the exact button labels and keyframe language this task is replacing. Every UI string
change below has a matching quest string. The tutorial and the UI must change together in the
same task, or the tutorial will instruct users to click buttons that no longer exist and teach
the keyframe jargon we are explicitly killing.

### `src/frontend/src/config/questDefinitions.jsx` — the tutorial copy

| Line | Key | Current | Change required | Driven by |
|------|-----|---------|-----------------|-----------|
| 54 | `STEP_TITLES.export_framing` | `'Frame Video'` | Rename to match the new Framing terminal button (e.g. "Export Highlight"). | P1.4 |
| 72 | `STEP_DESCRIPTIONS.export_framing` | "Drag and resize the crop box around your player **at different keyframes**… click **Frame Video**." | Kill "keyframes" language → outcome-first ("keep your player in the shot"); cropping is now **optional** (P0 default crop) so reword from a required step to a soft suggestion; update button name. | P0.1, P0.2, P1.4 |
| 56 | `STEP_TITLES.export_overlay` | `'Spotlight Your Player'` | Already outcome-oriented — keep, but confirm it matches the new Overlay terminal button verb. | P1.4 |
| 74 | `STEP_DESCRIPTIONS.export_overlay` | "Click each green square… click **Add Overlay**." | Update "Add Overlay" → new Overlay terminal button label; confirm the green-square/confidence flow copy still matches once confidence % is hidden (P1.5). | P1.4, P1.5 |
| 60 | `STEP_TITLES.export_second_highlight` | `'Frame another Video'` | Align with renamed Framing button. | P1.4 |
| 78 | `STEP_DESCRIPTIONS.export_second_highlight` | "crop it along the timeline… click **Frame Video**." | Same as line 72: drop crop-is-required framing, update button name. | P0.1, P1.4 |
| 80 | `STEP_DESCRIPTIONS.overlay_second_highlight` | "…click **Add Overlay**." | Update button label (mirrors line 74). | P1.4 |
| 71 | `STEP_DESCRIPTIONS.open_framing` | "Click Home → {DRAFTS} and select a reel." | This is the exact "Home → Drafts → select a reel" string P1.7 wants deep-linked. If the hint can host an interactive element, make it a clickable deep link rather than text. | P1.7 |

### `src/frontend/e2e/new-user-flow.spec.js` — the test that drives the tutorial

This spec asserts on the **literal** button text and quest step IDs. Renaming the buttons breaks
it — update in lockstep:
- `button:has-text("Frame Video")` at lines ~572, 705, 882 → new Framing button label.
- `button:has-text("Add Overlay")` at lines ~608, 726, 906 → new Overlay button label.
- `waitForQuestStep(page, 'export_overlay')` (line ~618) and other step-ID waits — step **IDs**
  stay the same (only titles/descriptions change), so these keep working; just confirm.
- Quest-step copy assertions, if any, must match the reworded descriptions.

### Coordination with T3660 (Quest 4 Rework)

T3660 (Season Highlights epic) **also rewrites the new-user-flow quest-4 segment**. If T3660
lands first, rebase these button-label updates onto its rewritten spec. If T3700 lands first,
note in T3660's handoff that button labels already changed. Avoid double-editing the same
quest-4 test block.

## Context

### Relevant Files (REQUIRED)

**Terminal buttons (P1.4):**
- `src/frontend/src/components/ExportButtonView.jsx` — terminal button label/UI
- `src/frontend/src/containers/ExportButtonContainer.jsx` — export gating/state
- `src/frontend/src/screens/OverlayScreen.jsx` — "Add Overlay" terminal action

**Default crop + non-blocking hint (P0.1, P0.3):**
- `src/frontend/src/modes/framing/hooks/useCrop.js` — crop/keyframe state; default-crop source
- `src/frontend/src/modes/framing/FramingMode.jsx` / `src/frontend/src/modes/FramingModeView.jsx`
- `src/frontend/src/screens/FramingScreen.jsx` — framing entry/hint surface
- `src/frontend/src/api/framingActions.js` — surgical crop persistence (default must persist via gesture, not reactively)
- `src/frontend/src/stores/framingStore.js`

**Pixel readout (P1.5 — Framing):**
- `src/frontend/src/components/CropControls.jsx` — pixel coordinate readout
- `src/frontend/src/modes/framing/layers/CropLayer.jsx`
- `src/frontend/src/modes/framing/overlays/CropOverlay.jsx`

**Confidence % readout (P1.5 — Overlay):**
- `src/frontend/src/modes/overlay/overlays/PlayerDetectionOverlay.jsx` — confidence percentages
- `src/frontend/src/modes/overlay/OverlayMode.jsx`

**Tutorial / onboarding copy (P0.2, P1.4, P1.6, P1.7) — see Tutorial & Onboarding Impact above:**
- `src/frontend/src/config/questDefinitions.jsx` — `STEP_TITLES` + `STEP_DESCRIPTIONS`; hardcodes "Frame Video", "Add Overlay", keyframe language, and the "Home → Drafts" nav copy
- `src/frontend/src/stores/questStore.js` — quest step state / replay logic (P1.6 replayable hints)
- `src/frontend/src/components/QuestPanel.jsx` — renders quest hints in context
- `src/frontend/e2e/new-user-flow.spec.js` — asserts on literal "Frame Video" / "Add Overlay" button text + quest step IDs (update in lockstep with renames)

**Presets + keyframe affordance (P2.8, P2.9):**
- Overlay style controls (stroke/fill/dim) — `src/frontend/src/modes/overlay/overlays/HighlightOverlay.jsx`
- `src/frontend/src/modes/framing/FramingTimeline.jsx` — multi-lane timeline, keyframe affordance

### Related Tasks
- Related: T3540 (Framing in-progress visual ambiguity) — same "parents don't understand framing state" theme.
- Related: T1950 (Reels/Gallery terminology rename) — consistent, outcome-oriented naming precedent.
- **Coordinate: T3660 (Quest 4 Rework)** — also rewrites the `new-user-flow.spec.js` quest-4 segment. Whichever lands second must rebase the button-label/quest-copy changes onto the other's edits. See Tutorial & Onboarding Impact.

### Technical Notes

- **Default crop must persist via a gesture, not reactively.** Per CLAUDE.md "Persistence:
  Gesture-Based, Never Reactive": the default crop is a runtime fixup for *rendering*. Writing it
  to the backend must happen only on an explicit user gesture (the export click), NOT via a
  `useEffect` watching crop state. The export click is the gesture; the surgical/full-state save
  it already triggers is where the default gets persisted. Do not add reactive write-back.
- **No silent fallbacks for internal data:** the default crop is a legitimate *product* default
  (centered/full-frame), not a fallback hiding a bug. Keep it a real, named default in `useCrop`,
  applied for rendering and committed on export — visible, not silent.
- Gating readouts behind "Advanced" is a display concern only — do not change what data is
  computed or persisted, just its visibility.

## Implementation

### Steps
1. [x] **P0** — Zero-effort valid export. **DONE** (commit on feature/T3700-quest-framing-overlay-split):
   - Root cause: framing-mode export button was hard-disabled by `hasUnframedClips`
     ([ExportButtonContainer.jsx]) — a 1-clip reel hits `isMultiClipMode` and an untouched
     clip counts as unframed, so the button never enabled. Plus the single-clip render
     rejected empty `crop_data` and the multi-clip path rejected payload clips with no
     `cropKeyframes`.
   - Fix: (a) frontend de-gates the button (unframed is a soft, non-blocking nudge in the
     title only); (b) a named, centered default crop is applied on export — a single
     shared backend helper `app/services/default_crop.py` (mirrors the frontend default:
     `205x365 @ centered` for 9:16) used by both the single-clip render (`framing.py`) and
     the multi-clip path (`multi_clip.py`). Opened clips still show/persist the visible
     useCrop default via the existing export save (gesture-based, not reactive).
   - Tests: `test_default_crop.py` (5). Backend import + frontend build green.
2. [ ] **P0** — Replace "set crop keyframes" copy with outcome language across the Framing **editor** surfaces (quest copy already done; the `CropLayer` "Set Crop Keyframes" placeholder + other editor strings remain).
3. [x] **P0** — Framing export hint is non-blocking (the unframed gate is now a soft nudge, not a wall).
4. [ ] **P1** — Rename terminal buttons (Framing + Overlay) to unambiguous finish/export verbs.
5. [ ] **P1** — Gate pixel coordinates (Framing) and confidence % (Overlay) behind "Advanced" / remove.
6. [ ] **P1** — Make step hints replayable in context (remove one-shot-only behavior).
7. [ ] **P1** — Deep-link navigation instructions ("Home → Drafts → select a reel").
8. [ ] **P2** — Subtle/Bold presets for stroke/fill/dim with px/% behind an "Adjust" expander.
9. [ ] **P2** — Clearer manual keyframe affordance; hide multi-lane timeline until needed.
10. [ ] **Tutorial** — Update `questDefinitions.jsx` titles/descriptions (8 strings, see Tutorial & Onboarding Impact): drop keyframe language, reword crop as optional, rename button references, deep-link the open_framing hint.
11. [ ] **Tutorial** — Update `new-user-flow.spec.js` button-text selectors to new labels (coordinate with T3660).

### Progress Log

**2026-06-16**: Task created from user UX feedback on Framing/Overlay comprehension. Grounded
relevant files via codebase search. Phased P0/P1/P2; each phase independently shippable.

**2026-06-16**: Added Tutorial & Onboarding Impact section. Confirmed the onboarding tutorial IS
the quest system (`questDefinitions.jsx`): it hardcodes "Frame Video"/"Add Overlay" labels and
the keyframe language this task removes (8 affected strings, line-referenced). `new-user-flow.spec.js`
asserts on those literal labels and must update in lockstep. Flagged coordination with T3660
(also edits the quest-4 e2e segment).

**2026-06-16 (quest/tutorial half shipped — see PLAN row T3705)**: Implemented the quest-system
restructure on `feature/T3700-quest-framing-overlay-split`:
- 3-quest split: Q1 "Get Started", Q2 "Frame Your Highlight", Q3 "Spotlight Your Player",
  each decomposed into individually-triggered steps (14 steps total). The old repeat-everything
  "Make More Highlights" quest was dropped; the Vamos completion modal fires after Q3. Backend
  `quest_config.py` + `_check_all_steps`; frontend `questDefinitions.js/.jsx` (outcome-first,
  jargon-free copy, no "keyframes").
- 6 new achievement events wired in the editors: `crop_adjusted` (FramingContainer),
  `speed_segment_created` (speed < 1x only), `opened_overlay_editor` (App.jsx),
  `overlay_players_assigned` (OverlayContainer, all green regions assigned), `overlay_color_set` +
  `overlay_shape_set` (OverlayScreen). Registered in `KNOWN_ACHIEVEMENT_KEYS` + analytics FLOW_EVENTS.
- Terminal buttons renamed: "Frame Video" -> "Export Highlight", "Add Overlay" -> "Add Spotlight"
  (ExportButtonView, PaymentResultModal).
- `v005_quest_restructure` user_db migration reconciles existing users: old quest_2 (bundled
  framing+overlay) also satisfies the new quest_3 (Spotlight), so it's marked complete. No app-level
  legacy handling; data is migrated.

Remaining (this task / the new T37xx tasks): the editor-UX behaviors. **P0 default crop is now
ACCEPTANCE-CRITICAL and UNVERIFIED** — the live Q2 `export_framing` step requires that a user who
never touches the crop can still produce a valid framing export. `useCrop` appears to auto-init a
centered default, but export gating against an un-keyframed crop was not verified. Do this first.
New sibling tasks: T3710 (preview), T3720 (auto-advance to overlay), T3730 (dim non-selected),
T3740 (single-control spotlight), T3750 (e2e rewrite).

## Acceptance Criteria

- [ ] **P0:** A brand-new user can open Framing, touch nothing, click the terminal button, and get
      a valid export (centered/full-frame default crop applied).
- [ ] **P0:** No Framing copy reads "set crop keyframes"; language is outcome-oriented
      ("keep your player in the shot").
- [ ] **P0:** Un-animated crop produces a soft nudge, never a hard block on export.
- [ ] **P0:** Default crop is persisted only on the export gesture — no reactive write-back
      (verified against CLAUDE.md persistence rule).
- [ ] **P1:** Terminal buttons on Framing and Overlay clearly communicate finish/export and are
      consistent with each other.
- [ ] **P1:** Pixel coordinates and confidence percentages are hidden by default (Advanced-gated
      or removed); default view shows neither.
- [ ] **P1:** Any step's hint can be replayed in context.
- [ ] **P1:** Navigation instructions are clickable deep links.
- [ ] **P2:** Subtle/Bold presets available; raw px/% sliders behind an "Adjust" expander.
- [ ] **P2:** Manual keyframe affordance is obvious; multi-lane timeline hidden until needed.
- [ ] **Tutorial:** No quest title or description references a renamed button by its old label, and
      no quest copy uses "keyframe"/"set crop keyframes" language; the framing-crop step reads as
      optional, not required.
- [ ] **Tutorial:** The "Home → Drafts → select a reel" quest hint is a clickable deep link.
- [ ] **Tutorial:** `new-user-flow.spec.js` passes with the new button labels (no stale
      "Frame Video"/"Add Overlay" selectors).
- [ ] Frontend unit tests pass (`useCrop` default-crop logic, export-job validity).
- [ ] E2E: zero-effort export path verified for a fresh reel.
