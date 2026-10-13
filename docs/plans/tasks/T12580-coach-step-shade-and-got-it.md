# T12580: Every guide step is a focused step: shade the rest of the screen, "Got it" dismisses it

**Status:** STAGING
**Impact:** 8
**Complexity:** 6
**Tier:** L (new cross-screen UI pattern, design gate required)
**Created:** 2026-10-11
**Updated:** 2026-10-11
**Priority placement:** user-ordered 2026-10-11 at the priority T11900 held, as the closing rows of the Parent Usability Audit milestone.

## Problem

Guidance today is a floating card that competes with the whole screen. Every control stays at full
contrast, so the card is one more thing among twenty and the user still has to guess which control
the sentence is about. The T12310 re-run found the two failure modes this creates: the card gets
covered or covers what it explains (T12470), and on phones it often never appears at all (T12460).
Even when it does appear, nothing makes the named button findable.

## Solution

Give every guide step two states, and only two:

1. **Focused** (the state a step starts in): the guide dialog is visible, the control the step wants
   the user to press is visible and clickable, and everything else sits behind a shade with alpha
   plus a blur. The background stays recognizable, so the user keeps their bearings, but the eye
   ignores it. The dialog carries a **"Got it"** button.
2. **Free** (after "Got it"): dialog and shade are gone and the whole screen is live again. It stays
   free until the resolved guide step changes; the next step opens in Focused again.

Turning the Guidance switch ON always puts the user in Focused for the current step (acknowledgements
reset). With guidance OFF nothing of this ever happens: no shade, no dialog, no listeners.

Mechanism (confirm in the design doc): one fixed layer in the existing `FloatingCoach` portal with
`backdrop-filter` (blur plus brightness) and a `clip-path` cutout around the step's anchor rect.
`clip-path` clips hit-testing too, so the cutout passes clicks through to the real control and the
shaded area swallows them, with one element and no copy of the app's DOM.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/components/instructions/resolveGuide.js` - the rule table; `phase` per step is the key the acknowledgement is stored against; rules may need a `keepClear` field
- `src/frontend/src/components/instructions/FloatingCoach.jsx` - portal, placement, dock, `BLOCKING_LAYER` and `AVOID_SELECTOR`; the shade layer mounts here
- `src/frontend/src/components/instructions/InstructionCoach.jsx` - the card; gains the "Got it" button next to the existing X (X still means "turn guidance off")
- `src/frontend/src/components/instructions/Guide.jsx` - the single mount point; passes the resolved guide through
- `src/frontend/src/components/instructions/placement.js` - rects and phone/dock rules
- `src/frontend/src/components/instructions/GuidanceToggle.jsx` - turning guidance on resets acknowledgements
- `src/frontend/src/constants/zLayers.js` - the shade needs a layer below the card and above app chrome
- `src/frontend/src/stores/settingsStore.js` - `coachEnabled` lives here (persisted by gesture); the acknowledged step must NOT be persisted

### Related Tasks

- Depends on nothing, but lands best after T12440/T12450/T12470 (action-band and placement fixes) so the cutout is measured against the fixed layout.
- Feeds T12590 (the guidance sweep checks the shaded guidance if this is on staging).
- Related: T12460 (phone guidance never appeared), T12300 (guidance preference persists), T12390 (Annotate guidance after the first play).

### Technical Notes

- **Acknowledgement is view state, so it is memory only.** No API call, no localStorage, no DB write:
  it dies with the tab. Keyed by the resolved `phase`. See CLAUDE.md persistence rules and the
  "no persisted view state" standard.
- **Do not give the shade or the card `role="dialog"` or `aria-modal`.** `FloatingCoach`'s
  `BLOCKING_LAYER` selector hides the coach whenever such a layer is open, so the coach would hide
  itself. Keep `role="status"` as today and move focus to "Got it" explicitly.
- Real modals (play editor, upload, share) already set `aria-modal`; the coach hides itself there and
  `Guide` has an `inline` mode for those. Decide per surface whether the shade applies at all.
- `silent: true` rules and null guides produce no dialog, so they produce no shade.
- Docked (phone) guides: the anchor may be off-screen, and there is already a scroll-hint chevron.
  A shade with no reachable cutout would trap the user, so an off-screen anchor must either skip the
  shade or keep the chevron and the scroll gesture live.
- Steps whose instruction is "watch" (`annotate.watch`, `annotate.watch.playing`, `focus.progress.play`,
  `focus.progress.watchPreview`) must not blur the video they are asking the user to watch.
- Existing `pulse` recommendations (`mark-play`, `portrait`, `pick-box`) stay; the cutout and the pulse
  must name the same element.

### Rulings (user, 2026-10-12): all five recommendations accepted

1. Dialog only, no shade, for `tone` `progress` and `error`.
2. Shade once per rule id.
3. Cutout = anchor plus per-rule `keepClear` (video stays sharp on watch steps).
4. The Guidance switch stays clickable under the shade.
5. Esc acknowledges; a tap on the shade does nothing.

The design doc still goes to the user for approval per L-tier; these rulings are inputs to it.

### Original open questions (answered above)

1. States with nothing to press (export processing, finishing, failed, needs credits): shade or dialog
   only? Recommended: dialog only, no shade, for `tone` `progress` and `error`.
2. Repeating walks (the spotlight pick runs the same rule for step 1..n): shade once per rule, or again
   at every step? Recommended: once per rule id, so the pick walk does not shade n times.
3. Cutout scope: anchor only, or anchor plus a per-rule `keepClear` list (the video stage for watch
   steps)? Recommended: anchor plus `keepClear`.
4. Under the shade, does the Guidance switch stay clickable so a user can turn guidance off without
   acknowledging? Recommended: yes, the switch and nothing else.
5. Keyboard and pointer: Esc acknowledges, a tap on the shade does nothing (no backdrop dismiss, per
   the project rule). Confirm.

## Implementation

### Steps

1. [ ] Architect: design doc `docs/plans/tasks/T12580-design.md` with the shade mechanism, the
       acknowledgement model, the per-rule fields, the five rulings above, and phone/tablet/desktop
       behaviour. Decision artifact with previews for the user gate.
2. [ ] Failing behavioural tests first: Focused on step entry, "Got it" clears shade and dialog,
       a phase change re-opens Focused, guidance off renders nothing, turning guidance on resets to
       Focused, the cutout control is clickable and a control outside it is not.
3. [ ] Implement the shade layer, the "Got it" button, and the acknowledgement state.
4. [ ] Per-rule `keepClear` (if ruled in) and the watch-step cases.
5. [ ] Phone dock and off-screen-anchor behaviour, including the scroll chevron.
6. [ ] Curated test set plus one Playwright spec at 1440x900 and 390x844 driving two consecutive steps.
7. [ ] Update `.claude/knowledge/annotate.md` (and any guidance section) with the new two-state model.

### Progress Log

**2026-10-11**: Filed from the user's request. Not started.

## Acceptance Criteria

- [ ] With guidance on, entering any guided step shows the dialog plus the shade, with the step's
      control and the dialog unshaded and the control clickable.
- [ ] A control outside the cutout cannot be clicked while the shade is up.
- [ ] "Got it" removes dialog and shade; the screen is fully live and stays that way until the step
      changes; the next step opens shaded again.
- [ ] Turning the Guidance switch on puts the current step in the shaded state.
- [ ] With guidance off there is no shade, no dialog, and no new listeners or observers.
- [ ] Nothing about the shaded or acknowledged state is persisted anywhere (no request, no storage).
- [ ] The background behind the shade is still recognizable (alpha plus blur, not opaque).
- [ ] Works at 1440x900, 1024x768, 768x1024 and 390x844 with no horizontal overflow and no step whose
      cutout lands off-screen without a way to reach it.
