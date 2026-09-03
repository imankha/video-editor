# UX Review: Add Play / Edit Play relocation (inline play editor)

**Date:** 2026-09-03
**Agent:** ux-designer (spawned for pre-filing review of the T8600 proposal; found and verified the T8590 bug)
**Feeds:** [T8600](../tasks/T8600-inline-play-editor-under-canvas.md), [T8590](../tasks/T8590-desktop-edit-play-opens-create-form.md), decision artifact (claude.ai artifact "Inline Play Editor - Design Proposal")

## Verdict up front

The relocation is directionally sound for desktop (controls adjacent to what they affect; CapCut grammar puts clip editing under the preview), but the proposal as written has one evidence problem, one probable pre-existing bug it would build on top of, and two spec gaps (sidebar behavior during edit; the button-row mode swap) that would ship confusion if filed as-is.

## Evidence status: no usable baseline yet, and it may be contaminated

- `add_clip_opened_no_save` (T8140) fires once per create-mode open that closes without save (`AnnotateFullscreenOverlay.jsx:231-239`, via the T7515 `dialog` impression vocabulary). T8140 merged to master 2026-09-01; tasks are still STAGING, so prod almost certainly has zero days of this beacon. Filing the redesign now means no before/after comparison. Cheapest correct move: let the beacon accumulate 1-2 weekend cycles in prod first.
- **Probable T8130 wiring bug that inflates the beacon (VERIFIED in code after this review; filed as T8590):** on desktop non-fullscreen, "Edit Play" calls `editClip` -> EDITING -> `showAddClipForm` (`AnnotateScreen.jsx:676`) -> the sidebar inline overlay renders with **no `existingClip` prop** (`ClipsSidePanel.jsx:343-359`; compare the fullscreen render at `AnnotateModeView.jsx:604-621` which passes it). Consequence: the form opens in CREATE mode, headed "Add Play", with default 12s bounds; Save would create a duplicate clip, and because the beacon arms on `!isEditMode`, every confused close of a mislabeled edit-open counts as create-abandonment. The T8130 e2e guard only asserts the CTA label/title, not what opens after the click (`clip-selection-state-machine.spec.js:246-253`). Pre-T8130 this path was unreachable in non-fullscreen (the transport Add button hides when SELECTED).
- The stated rationale ("users are used to inputs under the canvas") is opinion, not trail evidence. Reframed as a falsifiable hypothesis (see d).

## a) Compact editor vs "Add details"

Always visible (ranked by necessity):
1. **ClipScrubRegion** - the only required input.
2. **Rating** - one row, keyboard 1-5, and it silently drives two other things: the auto-generated name and the Create Reel auto-toggle (`handleRatingChange` sets `createProject = rating===5 && myAthlete`). Hiding it would make those side effects invisible.
3. **Clip Name** - keep, but as a single compact input. It is the visible consequence of rating/tags (auto-generated label) and the clip's identity in the list; "Play N" default means it never blocks a one-tap save.
4. **Teammates, conditionally** - do NOT put teammates behind "Add details". They render only on the Team layer, and T5725's clear-on-switch was accepted precisely because the clearing is visible (the block disappears). If Layer lives in the button row while Teammates hides in a popup, switching layers silently destroys hidden state - the exact invisible-contradiction T5725 was designed to avoid. Render the Teammates input inline when Layer=Team; it costs nothing on My Athlete clips (the default since T8030).

Behind "Add details": **Tags and Notes** only. Tags are the big block (TagSelector `size="lg"`) and both are optional. One caveat: tags feed the auto-name and the rated-and-tagged quest achievement (`maybeRecordRatedAndTagged`); watch whether tag usage drops after hiding them - if tagging collapses, per-player teammate shares and curated collections quietly starve. Label the button with a count when details exist ("Details (2 tags, note)") so edit-mode users can tell there is hidden content.

## b) "Add details" surface

**Expand-in-place, not popover, not modal.**
- Popover anchored above the strip covers the canvas - the thing the user is framing against, and the thing this redesign exists to keep visible. Self-defeating.
- Modal: our no-backdrop-close rule means every open costs an explicit dismiss tap, and it re-creates the "form far from canvas" problem in a heavier form. Also the checklist forbids stacking (the sport question of T8140 is already a full-screen interstitial on mobile save).
- Expand-in-place (strip grows downward, its own max-height scroll for the TagSelector) keeps one surface, one Esc/Enter scope, no z-index or focus-trap work, and matches the context-toolbar grammar users know from CapCut. It may push the button row down while open; that is acceptable and self-explaining.

## c) Scope cut

**Desktop non-fullscreen only.**
- Mobile: keep the T8140 bottom sheet untouched. It shipped two days ago, is tuned for 390x844 Save visibility, and the redesign's premise (form far from canvas) does not apply - the sheet already rises from under the video. This audience is mobile-heavy; churning that surface now also destroys the ability to read the fresh beacon.
- Fullscreen: keep the docked panel. It already sits over/next to the canvas, and fullscreen has its own timeline strip.
- Bonus: an unchanged mobile surface is your control group (see d). Consider adding a `surface` discriminator to the beacon value (e.g. `add_clip_opened_no_save:inline_desktop`) within the existing `action:{reason}` encoding so the split is readable without new schema.

## d) Does relocation plausibly reduce abandonment?

Plausible mechanism: attention split / controls-not-adjacent. The user's eyes are on canvas + timeline; the form opens in the right sidebar; the scrub handles that drive the preview are 800+ px from the video they scrub. That is a real, known cost on desktop.

But three things weaken the bet:
1. The cohort is mobile-heavy; a desktop-only change may barely move the aggregate metric.
2. If the dominant abandonment mechanism is choice overload (big tag grid, notes, layer, reel toggle) rather than distance, then the "Add details" collapse does all the work and relocation does little. These are separable experiments; the proposal bundles them.
3. The T8590 wiring bug may be manufacturing phantom "create abandonment" on desktop today.

Falsifiers, in order of cheapness:
- If desktop and mobile beacon rates are similar per open (mobile sheet is already canvas-adjacent), proximity is not the driver.
- If per-user trails (`user_action_log`) show opens abandoned after tag/rating interactions rather than immediately after open, the mechanism is overload, not distance.
- Hypothesis for the task file: "We believe moving the create form under the canvas (desktop, non-fullscreen) will cause more opened forms to end in Save, measured by `add_clip_opened_no_save` per `add_clip_opened` falling on desktop while mobile stays flat."

## e) Risks and regressions

1. **Losing the timeline mid-edit is a real cost.** ClipScrubRegion is a fixed anchor +-30s window (`ClipScrubRegion.jsx:4-5`), not the game timeline. The timeline is where users see neighboring clips (two lanes, T5700) - during boundary setting it is exactly when you want to see the adjacent play you must not overlap, and where your play sits in the half. Mitigation: keep a slim read-only strip (position indicator + existing clip markers) above the editor, or render the scrub region visually as a zoomed inset of the timeline. Also decide what happens to `handleTimelineSeek`'s seek-outside-closes-overlay gesture when there is no timeline to seek.
2. **Keyboard scoping.** The overlay's window-level keydown (Enter=save, Esc=close, 1-5=rating, `AnnotateFullscreenOverlay.jsx:243-268`) survives relocation if the component is reused. But with an "Add details" expansion: Esc while focused in a details input currently calls `onClose()` - discarding the whole editor when the user meant "close details". Esc needs layering (close details first, then editor). And 1-5 must keep ignoring INPUT/TEXTAREA targets inside details.
3. **T8130 gating landmine, new shape.** While editing, the CTA row is replaced, but the transport-bar Add button (`AnnotateControls`) still renders and calls the same `onAddClip`. In EDITING state, `selectionState.type` is not SELECTED, so that click calls `startCreating()` - silently flipping the open editor from edit to create mode (the component supports that switch, `AnnotateFullscreenOverlay.jsx:145-156`). Hide or explicitly re-purpose the transport button while the under-canvas editor is open.
4. **Spec gap: the sidebar during editing.** Today ClipDetailsEditor hides while the form is open only because `showAddClipForm` gates it (`ClipsSidePanel.jsx:323`). Move the form out of the sidebar and that gating must be rewired, or EDITING shows two live editors for the same clip (per-field-persisting ClipDetailsEditor in the sidebar, batch-on-Save editor under the canvas) with two ClipScrubRegions and conflicting semantics. Decide: during editing, sidebar shows list only.
5. **Playwright collisions.** The T8130 landmine generalizes: any relocated button must not share `title`/accessible-name with a simultaneously rendered sibling. New collisions to design around: "Create Reel" (would exist in the mid-edit row AND ClipDetailsEditor when SELECTED - mutually exclusive states, but tests must know that), "Focus" likewise, and the two Save buttons if mobile sheet and desktop strip ever co-render in tests.

## f) The Layer / Create Reel / Focus row

- **Focus is dead weight in create mode.** It gates on `region.autoProjectId`, which cannot exist before the clip is saved. A permanently disabled button in the primary row is pure choice tax; show Focus only in edit mode, and only when `autoProjectId` is set. Also: clicking Focus mid-edit navigates to Focus mode - define what happens to unsaved form state (block with "Save first", or auto-save; never silent discard).
- **Create Reel is a toggle wearing a button costume.** In create mode it is a toggle whose state also flips itself when rating hits 5 on My Athlete. Put a self-changing toggle in a row of action buttons and you get both slips (tap it thinking it acts now) and gulf-of-evaluation (it changed and nobody saw). Keep it visually a labeled toggle, and keep it near Rating (whose value drives it), not in the button row.
- **The row swap is a mode change; make it loud.** These parents edit in interrupted bursts; returning to a screen whose bottom row silently changed meaning invites mode errors ("invisible mode"). Tint the whole editor strip (yellow for edit, matching the T8130 CTA color language) and keep an explicit "Editing: {clip name}" header with Save/Cancel always visible in the strip.

## Recommendation for filing

Split into three tasks, sequenced: (1) fix the desktop Edit Play `existingClip` wiring bug (S/M, verify by live-drive first); (2) "Add details" collapse of Tags/Notes inside the existing surfaces (works on all form factors, likely the bigger abandonment lever); (3) the desktop-only relocation, with the sidebar-gating, transport-button, keyboard-layering, and mini-timeline decisions written into the design doc. Wait for 1-2 weeks of prod beacon data before judging any of them.

*(Filing outcome: user framing keeps (2)+(3) together as T8600 with the split recorded as an open choice; (1) filed as T8590, sequenced first. Post-review user decision on b): the expand-in-place recommendation stands for DESKTOP only; on mobile the user chose a full-screen popup over the T8140 sheet - simulated at both sizes in the decision artifact, rationale: the sheet already covers the canvas, an 85vh-capped sheet squeezes the tag grid behind the pinned Save, and the T8140 sport question already establishes the full-screen-takeover pattern on that surface.)*
