# T14810: Upload modal: a path for parents who have no game file on this device

**Status:** TODO
**Impact:** 8
**Complexity:** 3
**Created:** 2026-11-03
**Updated:** 2026-11-03

## Problem

**Add footage is the largest loss in the funnel** (prod Journey, 2026-11-03: 277 opened the
upload screen, 100 never got footage in, all 100 gone). A parent arriving from
reelballers.com is sold on the promise, taps Upload game, and the modal asks for a file:
"Drop any game video here. MP4, MOV, WebM, or a zip of clips." If the game video is not on this
device (it is in the Veo or Trace app, on the club's portal, on a laptop at home, or still
on the camera), the modal has nothing to say. The only alternative is the small grey line
under the button on Home, "Have a highlight already? Skip ahead on Clips.", which is outside
the modal and easy to miss (observed in the 2026-11-03 walk-through, desktop and phone).

The walk-through estimated this transition at ~65% before seeing the data; prod says 64%.
The file-on-device problem is the single biggest reason a bought-in parent stops here, and it
is a copy and layout fix, not an engineering one.

## Solution

Inside the upload modal, under the drop zone, add a compact "Don't have the video on this
phone?" block with three one-line answers (final copy follows the
[Copy Vocabulary glossary](copy-vocabulary/EPIC.md); no "--", US spelling):

1. **Veo / Trace / Hudl**: "Download the game from your camera's app or website, then come
   back here." Link to a short help page per camera (existing landing guides if they exist,
   else a `/help/get-your-game-video` page in `src/landing`). Mention that a Veo highlights
   zip also works (T13240 shipped the zip path).
2. **Already have highlight clips?**: a real button that opens the direct clip upload (the
   `add_clip_opened` path), not the grey text link.
3. **On another device?**: "Open reelballers.com on that device; your account is the same."

Also: move the Home line "Have a highlight already? Skip ahead on Clips." from body-small grey
to a secondary button beside Upload game (same height, outline style, per the UI style guide).

No new backend. Record `add_clip_opened` from the new button exactly as the Clips-tab entry
does today so the Journey ladder keeps working.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/GameFootagePicker.jsx` - drop zone and accepted-format copy
- the Upload game modal component that renders `GameFootagePicker` (grep `data-testid="upload-submit"`)
- `src/frontend/src/components/home/` - Home "Review game footage" block with `home-upload-game` and the "Skip ahead on Clips." button
- `src/frontend/src/config/displayNames.js` / GUIDE copy table - any sentence the guide shows on the upload step
- `src/landing/src/pages/` - help page(s) for getting the video out of Veo / Trace / Hudl (coordinate with T7120 content expansion)
- `src/frontend/src/components/instructions/resolveGuide.js` - the upload-step guide sentence may need a variant for the new block

### Related Tasks
- Depends on: nothing. T14800 (Add footage split) tells us afterwards how much of the loss this moved.
- Related: T13200-T13240 (Veo Highlights Import, zip path shipped), T8370/T8380 (direct clip upload), T14600 (Home and tabs copy), T447 (PWA background upload), T448 (Share Target, camera roll into upload).

### Technical Notes
- **Hard boundary (owner, 2026-11-03): never fetch, link-import or scrape footage from Veo, Trace or Hudl.** An earlier link-import feature was removed (T2680) after the owner concluded it violated their terms of service and risked an IP blacklist. Every path here is parent-driven: the parent downloads their own footage from their own account and uploads it; the app never contacts the camera vendor. Help pages describe the vendor's own download steps and nothing more.
- Headline path for Veo parents is the **Veo highlights zip** (small, phone-friendly, already handled by T13240); the full game download is the fallback. Trace has no zip equivalent: download steps plus the laptop handoff.
- Consider a one-tap "Email me a link to upload from my computer" (reuses the existing email service) for parents whose footage lives on a laptop; cheap and covers the on-another-device case.
- Do not gate Upload game on anything; the block is additive.
- Keep the modal under the phone fold at 390x844 with the block collapsed by default ("Don't have the video on this phone?" is a disclosure row), expanded on tap.
- UI designer pass before the user tests (feedback rule 2026-10-22): mock both states on phone and desktop.

## Implementation

### Steps
1. [ ] ui-designer mock: disclosure row + expanded block on phone and desktop; user picks.
2. [ ] Implement the block and the Home secondary button; wire the clip-upload entry to the same handler the Clips tab uses.
3. [ ] Landing help page(s) with per-camera steps (owner supplies the exact Veo/Trace/Hudl export clicks or approves the draft).
4. [ ] Vitest: block renders, disclosure toggles, clip button fires the same `add_clip_opened` path; e2e: a fresh account can reach direct clip upload from the modal.
5. [ ] After deploy: compare Add footage loss (T14800 split) before/after.

### Progress Log

**2026-11-03**: Filed from the funnel walk + prod journey screenshot. Not started.

## Acceptance Criteria

- [ ] A parent with no file on the device sees, inside the upload modal, how to get it and a one-tap way to upload clips instead.
- [ ] Home offers "I already have highlight clips" as a visible secondary button, not grey body text.
- [ ] Copy follows the glossary; no new backend events.
- [ ] Tests pass.
