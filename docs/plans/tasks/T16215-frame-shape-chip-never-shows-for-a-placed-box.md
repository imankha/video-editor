# T16215: Frame's Portrait/Landscape chip never shows for a highlight that already has a box

**Status:** TODO
**Impact:** 4
**Complexity:** 2
**Created:** 2026-11-13
**Updated:** 2026-11-13

## In plain words

**Today.** When a parent opens Frame on a highlight whose box they already placed, Frame
still shows the big "Where will you share it?" picker and numbers the guide as 6 steps. It
should show the small Portrait/Landscape chip and the 5-step guide instead.

**The problem and how we got here.** T15610 froze the "box already placed" flag when Frame
first appears, so a parent's own first drag can't renumber the guide steps mid-session.
But the saved box positions load a moment later, after that first appearance. The flag
therefore reads "no box" for every highlight. The 2026-11-09 staging QA still saw the chip,
which suggests this regression came in with T15610. T16210's browser check found it on
2026-11-13: it drags the box, leaves Frame, comes back, and the picker is still there.

**What we will do.** Have Frame's screen record "this highlight opened with saved
positions" when it restores the clip's saved box (once per clip), and pass that down instead
of guessing at first render. Reset it when the clip changes.

**Why.** Returning parents are asked again where they'll share a highlight they already
framed, and see the wrong guide step count. It also blocks T16210's touch-size check for
the chip.

**How we will know it worked.** A highlight with a saved box opens on the chip and a 5-step
guide. A fresh highlight the parent drags still shows no renumbering (T15610's case).

## Implementer details

- `src/frontend/src/modes/FocusModeView.jsx`: `const [boxPrePlaced] = useState(() => focusPointCount > 0)`
  runs at mount; `src/frontend/src/screens/FocusScreen.jsx` restores keyframes in a `useEffect`
  (`stateRestoredForClipIdRef` branch -> `restoreCropState`) after that.
- Expert recommendation (2026-11-13): set state in the FocusScreen restore branch
  (`{clipId, value: parsedCropKfs.some(k => k.origin !== 'trim')}`) and pass it as the
  `boxPrePlaced` prop. Delete the child `useState`. Key FocusModeView by clip id so
  `hasDragged`/`shapeTapped` reset on clip switch. Optionally hide FrameShapeChoice until
  restore settles, so the picker doesn't flash. Do not derive the flag from live keyframes
  or `clip.crop_data`, because gesture saves would flip it.
- Once it lands, T16210's check (`src/frontend/e2e/checks/T16210.check.spec.js`, Frame test)
  should pass unchanged.

## Acceptance criteria

- [ ] C1: Opening Frame on a highlight with saved box positions shows the Portrait/Landscape chip (not the picker) and a 5-step guide, proven by a browser check.
- [ ] C2: A highlight with no saved positions still shows the picker, and the parent's first drag does not renumber guide steps (T15610 regression test still passes).
