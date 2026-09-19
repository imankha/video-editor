# T10620: Mobile portrait — compact editor strip under a visible video

**Status:** STAGING
**Impact:** 7
**Complexity:** 4
**Created:** 2026-09-19
**Updated:** 2026-09-19
**Epic:** [play-editor-autosave/EPIC.md](EPIC.md) (task 3 of 4, M-tier). **Blocked by T10610** (no pinned Save footer anymore; editor always in edit mode).

## Problem

Reproduced live 2026-09-19 at 393x852 (real account) — screenshots in the epic's decision
artifact. On a portrait phone the play editor renders as `AnnotateModeView.jsx`'s
`mobileInlineForm` sheet: `fixed inset-x-0 bottom-0 z-40 ... max-h-[85vh]` wrapping
`AnnotateFullscreenOverlay layout="inline" surface="sheet_mobile"`. It covers ~85% of the
viewport; only a thumbnail-strip sliver of the video remains above it. The trim handles and
the `<| 1:14.3 |> -> <| 1:22.3 |>` nudge controls are the whole point of the editor on this
surface and they have no video to refer to. User: "I need to see the video in order for the
levers for the edit timing to make sense." Same sheet, same problem for a just-marked play
and for editing an existing one (one component, one wrapper).

The sheet was `position: fixed` + `max-h-[85vh]` for ONE reason (T8140): to pin a Save
footer on screen at 390x844. T10610 removes that footer, so the constraint is gone.

## Solution (EPIC D8 — Option B from the artifact, ui-designer recommendation)

Extend the shipped `landscape-inline` compact-strip pattern (`AnnotateFullscreenOverlay.jsx`
~1216-1288: `ClipScrubRegion compact` + one dense controls row, `border-t px-3 py-2`, no
sheet) to portrait, rendered IN FLOW directly under the video card — not fixed, not a sheet.

Layout (top to bottom, portrait phone, editor open):
1. Video card — guaranteed visible height (design target: the video keeps at least the
   height it has when the editor is closed on the same viewport; do NOT shrink it to make
   room, the strip is short instead).
2. Strip row 1: `ClipScrubRegion compact` (trim bar + the T9480 typed-entry readouts) with
   the play-progress badges (T10410) right-aligned if they fit at 393px, else on their own
   compact row.
3. Strip row 2: clip name input (flex-1, `min-w-0`, truncates) + "Notes and Tags" disclosure
   button (`flex-none`, `whitespace-nowrap`) + Done/X (`flex-none`). The artifact mockup's
   overflow bug (Update button clipped off-screen because none of the three had shrink
   priority) is the exact regression to test for: the two buttons never shrink, the input
   absorbs the squeeze.
4. Stage CTA (Frame / Apply Spotlight / View Final — `stageCta`) full width below the strip
   when the clip has a project; the T10310 main-screen [Edit Play]/[Frame] row stays hidden
   while the editor is open (as today).
5. Play category (My athlete / Team), rating (already a popup badge, T10520/T10560), tags,
   notes, teammates, sport prompt, Delete play: all behind the "Notes and Tags" disclosure
   -> `AddDetailsPopup` (mobile full-screen popup, T8600). It may cover the video; none of
   those fields need it. Rename the disclosure label if category now lives there
   (`ANNOTATE.DETAILS` is the single source; propose "Details" or keep "Notes and Tags"
   and put category on strip row 2 if it fits — decide by measuring at 360px, the
   narrowest supported width per the `responsiveness` skill).

Implementation shape: add `layout="portrait-strip"` (or generalise `landscape-inline` with
an `orientation` prop — pick whichever leaves ONE markup path for both phone orientations;
do not copy the block). `AnnotateModeView.jsx` renders it in flow where `mobileInlineForm`
renders the sheet today (`~1244-1270`), removing `fixed inset-x-0 bottom-0 z-40 max-h-[85vh]
rounded-t-2xl` and the sheet's `[@media(max-height:700px)]:pb-9` keyboard padding hack
(T8790/F3), which existed only for the pinned footer. Keep `surface="sheet_mobile"`'s
analytics value only if any beacon still reads it after T10610 (grep).

`mobileFs` (mobile fullscreen, T9500) is a separate surface and out of scope unless the
same wrapper feeds it — check `AnnotateModeView.jsx` ~575-600 and say so in the report.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/modes/AnnotateModeView.jsx` — mobile sheet wrapper (~1230-1270), `mobileInlineForm`/`underCanvasEditor` derivation (~264-274), video card wrapper with `backdrop-blur-lg` (the T10420 landmine — in-flow rendering sidesteps it; document that in the knowledge doc)
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.jsx` — new/generalised strip layout; `inline` layout becomes desktop-sidebar-only (ClipsSidePanel) or is deleted if unused on mobile after this
- `src/frontend/src/modes/annotate/components/AddDetailsPopup.jsx` + `DetailsFields.jsx` — receives category + Delete play if they move behind the disclosure
- `src/frontend/src/modes/annotate/components/ClipScrubRegion.jsx` — `compact` variant (no step chevrons; click-to-edit readouts) — verify touch targets under `coarse-pointer:` (real touch project, not a resized mouse viewport — see annotate.md's 2026-09-18 false-positive landmine)
- `src/frontend/src/hooks/useIsMobile.js` — the real mobile predicate (max-width 1023px OR coarse pointer); never a Tailwind `sm:` split for this decision (T10590 finding 2)
- `src/frontend/e2e/T4880-mobile-editor-reachable.spec.js` (pattern for the real-touch mobile drive) and `e2e/helpers/usabilityAudit.js`
- Tests: `AnnotateFullscreenOverlay.mobileStageCta.test.jsx`, `AnnotateFullscreenOverlay.details.test.jsx`, `AnnotateModeView.frameClip.test.jsx`; new `AnnotateFullscreenOverlay.portraitStrip.test.jsx`
- `.claude/knowledge/annotate.md` — T8140/T8790/T10420 entries for this surface get a "retired by T10620" note

### Related Tasks
- Depends on: T10610 (no Save footer; editor always edit mode)
- Design source: epic decision artifact, Problem 1 "Recommended" panel + option ledger
- Prior art: `landscape-inline` (T7350-era), T8600 `AddDetailsPopup`, T10420 (why fixed-inside-blur breaks)

### Technical Notes
- Guaranteed video height is the acceptance bar, measured, not eyeballed: at 393x852 and
  375x667 (iPhone SE class) the video element's on-screen height with the editor open must
  be >= its height with the editor closed minus 0px (the strip pushes content below, it does
  not overlay the video). If the page must scroll to reach the strip on the SE, that is
  acceptable; the video being covered is not.
- Real-device check owed: Playwright cannot reproduce iOS Safari's dynamic toolbar (T4880
  caveat). Flag it in the report as the staging-verification step, not as done.
- Keyboard: with the name input on the strip, the soft keyboard pushes/covers content —
  test typing a name at 393x852 with the keyboard emulated (viewport height reduced to ~480)
  and confirm the input stays visible (scrollIntoView on focus is acceptable; a fixed
  wrapper is not).

## Implementation

### Steps
1. [ ] Branch `feature/T10620-portrait-editor-strip`; load `annotate.md` (T8140, T8600, T9500, T10420, T10590 entries) + the epic
2. [ ] Measure the current closed-editor video height at 393x852 / 375x667 / 360x740 (Playwright, real touch project) — record in the task file
3. [ ] Implement the portrait strip layout + in-flow render; move overflow fields into the disclosure; wire Done + Delete play
4. [ ] Unit tests: layout renders no sheet wrapper on mobile portrait; strip row 2 buttons carry `flex-none`; disclosure holds the moved fields; `useIsMobile` decides the split
5. [ ] Live-drive (real touch emulation): trim with the video visible; keyboard-open name entry; SE height; landscape unchanged; desktop unchanged
6. [ ] Reviewer (fresh context) on the diff; knowledge doc update; push; CI verdict; hand to user WITH screenshots at the three widths (visual judgment -> user test gate, not auto-merge)

### Progress Log

**2026-09-19**: Filed. Not started.

**2026-09-19 (implementation, worker on `feature/T10620-portrait-editor-strip`)**:

- **New `layout="portrait-strip"` branch** in `AnnotateFullscreenOverlay.jsx` — an
  IN-FLOW compact strip, its OWN branch (not a generalised `landscape-inline`: the two
  differ substantially — landscape is height-starved with rating+tags inline and NO
  disclosure/name-input; portrait has room for a name input + a details disclosure).
  Keeping them separate leaves `landscape-inline` byte-identical (Reviewer checklist) while
  every persistence handler + shared block (`ClipScrubRegion compact`, the progress badges
  incl. the rating popup, `stageCta`, `AddDetailsPopup`, `DeletePlayButton`) is reused from
  component scope — no copied write logic. Rows: (1) `ClipScrubRegion compact`; (1b)
  progress badges on their own row; (2) name input (`flex-1 min-w-0`) + disclosure + Done
  (both `flex-none whitespace-nowrap`); then the full-width `stageCta`; overflow fields
  behind the disclosure.
- **`AnnotateModeView.jsx`**: the `mobileInlineForm` render moved UP to render in flow
  directly under the video card (sibling of the video-player div, inside the windowed
  wrapper) with `layout="portrait-strip"`. The old `fixed inset-x-0 bottom-0 z-40
  max-h-[85vh] rounded-t-2xl` sheet AND its `[@media(max-height:700px)]:pb-9` keyboard hack
  (T8790/F3) are removed. In flow ⇒ the T10420 backdrop-filter containing-block trap no
  longer applies to this surface.
- **`AddDetailsPopup.jsx`**: gained OPTIONAL `myAthlete/onLayerChange/layerDisabled/
  layerDisabledReason`, `taggedTeammates/onTeammatesChange/teammateSuggestions`, and
  `hasProject/onDelete`. Only `portrait-strip` passes them; the `inline`/`mobileFs` hosts
  omit them ⇒ their popup stays byte-identical.
- **Design call (360px ambiguity, M-tier — no design gate):** category (My athlete / Team),
  teammates and Delete play live BEHIND the disclosure, NOT on strip row 2. Rationale: at
  360px a segmented control on row 2 crushes the name input below a usable width, and none
  of those fields are needed while trimming. Rating is NOT duplicated into the disclosure —
  the rated progress-badge popup is the single source for rating on every layout (T10520);
  duplicating it would reintroduce the control T10520 deliberately removed. `ANNOTATE.DETAILS`
  stays the single source for the disclosure label.
- **`mobileFs` (T9500) scope:** SEPARATE surface — `mobileFs = annotateFullscreen &&
  isMobile`, mutually exclusive with `mobileInlineForm = showAnnotateOverlay &&
  !annotateFullscreen && isMobile`. It has its own render site (`AnnotateModeView.jsx` ~835,
  its own `absolute inset-x-0 bottom-0 maxHeight:70vh` wrapper) and keeps `layout="inline"`.
  NOT touched by this task.
- **Tests (all green):** new `AnnotateFullscreenOverlay.portraitStrip.test.jsx` (12 — no
  fixed/85vh wrapper, no Save/Update button, row-2 flex-none shrink priority + name absorbs
  squeeze, name commit-on-blur, category/tags/notes/teammates/Delete reachable via
  disclosure, per-gesture writes, stage CTA); new `AnnotateModeView.portraitStrip.test.jsx`
  (2 — `useIsMobile` decides portrait-strip vs desktop strip, NOT a `sm:` split); updated
  `AnnotateModeView.renderSiteInventory.test.jsx` (windowed-mobile site now asserts
  `layout=portrait-strip`). Regression: 107 (mobileStageCta/details/frameClip/stripLayout/
  noSaveButton/teammates/layer/progressBadges/saveStatus/keys) unmodified; full annotate
  suite 631 pass; eslint 0 errors.
- **OWED (container has no browser cache + no backend venv/.env — cannot dev-login a real
  account to load real video):** the video-height measurement at 393×852 / 375×667 /
  360×740 (closed vs. open), the real-touch live-drive, and the iOS-Safari dynamic-toolbar
  real-device check. Structural acceptance is met (in-flow render can't overlay the video;
  video keeps its natural windowed height as a sibling above the strip), but the MEASURED
  numbers the acceptance bar demands must be captured by the supervisor/user on a real
  device before merge (this is the visual/UX test-and-merge gate the kickoff describes).

**2026-09-19 (supervisor summary + live measurement)**: Implemented in a container worker (single commit 08185c93, purely additive to
`AnnotateFullscreenOverlay`/`AddDetailsPopup`; landscape-inline/strip/overlay layouts
byte-identical). New `layout="portrait-strip"` renders in flow under the video card; the old
`fixed inset-x-0 bottom-0 max-h-[85vh]` sheet + its keyboard-padding hack are deleted. Category
placed behind the "Notes and Tags" disclosure (a 360px segmented control would crush the name
input); rating stays on the existing badge popup, not duplicated. `mobileFs` confirmed untouched
(separate, mutually-exclusive surface). Reviewer approved (0 blocking/major, 2 no-action minor).
738 tests green (631 full annotate suite + 12 new portraitStrip + 2 useIsMobile-gating +
regression), lint clean. Branch CI green. PR not yet opened — **visual task, held for user
test per standing instruction, not auto-merged.**

**Live measurement (run by the supervisor session directly, via a real account/game, since the
container had no browser/backend to do this itself):**

| Width | Editor-closed video height | Editor-open video height | Fixed sheet present? | Video covered? |
|---|---|---|---|---|
| 393x852 | 197.4px | 197.4px (identical) | No (0 found) | No |
| 375x667 (SE) | 187.3px | 187.3px (identical) | No (0 found) | No |
| 360x740 | 178.9px | 178.9px (identical) | No (0 found) | No |

All three widths: open height == closed height exactly (video never shrinks or gets covered),
zero `.fixed.inset-x-0.bottom-0` elements remain in the DOM, and `elementFromPoint` at the
video's center resolves inside the video area both before and after the editor opens.
Screenshots (closed + open, all 3 widths) saved to `C:\work\tasks\t10620\qa\`. Real-device iOS
Safari dynamic-toolbar check is still owed (Playwright cannot reproduce it, per T4880's known
caveat) — this measurement covers everything Playwright *can* verify.

**2026-09-19 (user feedback + fix)**: User tested the pushed branch live and asked for the
disclosure label to read "Details" instead of "Notes and Tags" (it now also holds category,
teammates, and Delete play, so the old name undersold it and produced a redundant "Notes and
Tags (note)" suffix). One-line change to the single-source `ANNOTATE.DETAILS` constant
(commit 45d784b3), propagating everywhere via that constant; two test files' hardcoded
literal assertions updated to match. 19 relevant tests green, lint clean, Branch CI green.

## Acceptance Criteria

- [x] Portrait phone, editor open: the video's on-screen height equals its editor-closed height (measured at 393x852, 375x667, 360x740) — confirmed exactly equal at all 3 widths, supervisor live measurement
- [x] Trim bar, readouts, and name are visible together with the video without scrolling at 393x852 — confirmed by screenshot
- [x] No `position: fixed` editor wrapper on mobile portrait; no `max-h-[85vh]` — confirmed by grep (worker) and a live DOM check (supervisor, 0 matches at all 3 widths)
- [x] Strip row 2: Done and the disclosure button never clip or shrink; the name input truncates instead (unit + screenshot) — confirmed by screenshot at all 3 widths
- [ ] All fields removed from the strip are reachable via the disclosure; Delete play reachable — worker-claimed, NOT independently verified by the supervisor (did not open the disclosure popup live); verify before/during user test
- [x] Landscape-inline and desktop layouts unchanged (existing tests still pass unmodified) — confirmed, diff is purely additive to those layouts
- [x] Screenshots at 360/375/393 widths attached; real-device iOS check listed as owed — see `C:\work\tasks\t10620\qa\`
- [x] `annotate.md` updated; relevant tests green; lint clean; Branch CI green
