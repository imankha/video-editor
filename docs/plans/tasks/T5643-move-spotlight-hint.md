# T5643 — Move "Tap the spotlight to adjust" hint + gate on no-frame-selected

**Tier:** S/M · Frontend only. **Model:** Sonnet. Straightforward UI reposition + conditional.

## Request (from the user)
The T5610 OverrideHint pill ("Tap the spotlight to adjust it — or hide tracking to edit
freely") should:
1. **Move** so it sits **right under the "N players detected" text** (e.g. "8 players
   detected"), instead of wherever it renders now.
2. **Only show when a tracking frame is NOT selected.** Today it may show regardless; it should
   hide as soon as the user has a tracking keyframe/spotlight frame selected.

## Files (own ONLY these — do NOT touch OverlayScreen.jsx or VideoPlayer.jsx; those are T5642's)
- `src/modes/overlay/overlays/OverrideHint.jsx` — the pill itself (T5610).
- `src/modes/OverlayModeView.jsx` — where the hint is placed relative to the "N players
  detected" label; and where the "selected tracking frame" state is available.
- Find the "players detected" label render site (grep "players detected" / "detected") and
  place the hint directly beneath it.

## Notes / current behavior
- T5610 gated the hint on: tracking ON + region present + not-yet-overridden. Add the new
  condition: **no tracking frame currently selected**. Confirm what "tracking frame selected"
  maps to in the overlay state (a selected keyframe / spotlight-frame index — grep the overlay
  hook/store, likely `useHighlightRegions` or the overlay store).
- Keep the existing fade/subtlety; just move it and add the selected-frame gate.
- There is a test `OverrideHint.test.jsx` — update it for the new gating and add a case for
  "hidden when a frame is selected".

## Acceptance criteria
- Hint renders immediately below the "N players detected" text.
- Hint is visible when tracking is ON, a region exists, not overridden, AND no tracking frame
  is selected.
- Selecting a tracking frame hides the hint; deselecting shows it again.
- No regression to the existing T5610 gating.

## QA (mandatory)
Live-drive overlay in a real browser (`loginAsRealUser(ctx,'imankh@gmail.com','9fa7378c')`),
confirm placement under "players detected" and the show/hide on frame select/deselect.
Update `OverrideHint.test.jsx`. Map evidence to each acceptance criterion.
