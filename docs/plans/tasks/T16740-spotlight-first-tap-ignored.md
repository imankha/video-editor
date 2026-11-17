# T16740: Spotlight first tap ignored

**Status:** STAGING
**Impact:** 7
**Complexity:** 3
**Created:** 2026-11-16
**Updated:** 2026-11-16

## In plain words

**Today.** Spotlight is the step where the parent taps their athlete and we draw a ring that follows them. When a parent arrives on Spotlight from the "Add spotlight" button after sharpening, the video sits on its first frame with the player boxes drawn. Tapping a box there does nothing visible: the panel keeps saying "Tap your athlete to add a spotlight", and tapping again still does nothing.

**The problem.** Found in the staging QA pass on 2026-11-16. Three taps on a player box at 0:00 (mouse, a second mouse tap, and a direct element click) each saved a spotlight point on the server, but the screen never counted any of them, and it still said "Tap your athlete" after a page reload. The same tap worked as soon as the playhead sat on the first frame the guide uses (0.67 seconds): "Tap 1" was ticked and the guide moved to Tap 2. A parent who taps and sees nothing is likely to think Spotlight is broken and leave. That is the step where 5 of 22 Spotlight exporters returned and all 5 payers were among them (roadmap item 2).

**What we will do.** Make the first tap count wherever the parent taps. Either open Spotlight parked on the first guided frame (as a reload already does), or treat a tap on a drawn box at any time as that step's tap. The parent should never see a box they can tap that ignores them.

**Why this and not something else.** The tap is already saved, so the data path works; only the guide's count and the starting playhead disagree. Hiding the boxes at 0:00 would also stop the dead tap, but it would leave the parent with nothing to tap on arrival.

**How we will know it worked.** Sharpen a highlight, tap "Add spotlight", and tap a player box straight away: "Tap 1" is ticked and the guide moves to Tap 2. A reload after that still shows Tap 1 ticked.

## Evidence (staging, build 94928afa1, account e2e@test.local)

- Project 13 ("Play 1" of game "qa-game3-2026-11-16"), reached from the Finished overlay's "Add spotlight" button at 1440x900.
- Playhead at 0:00. Detection data has no boxes at timestamp 0 (`boxes: []`); the boxes drawn come from the 0.667 s detection.
- Each tap sent `POST /api/export/projects/13/overlay/actions` with `add_keyframe` at `time: 0` on `region-auto-0-0` (200 OK, version 0 to 3). `GET overlay-data` afterwards shows the keyframe stored.
- The panel stayed on "Tap your athlete to add a spotlight", including after a reload. After the reload the playhead parked at 0.666 s; a tap there ticked Tap 1 at once.
- Console on entry: `[useHighlightRegions] region has detections but no usable box for auto-select; using centered default`.
- Screenshots (local, gitignored): `.playwright-mcp/qa-30-spot.png`, `qa-33-overlay-reload.png`, `qa-34-spot-0666.png`.

## Implementer notes

- Tap handling: `src/frontend/src/modes/overlay/overlays/PlayerDetectionOverlay.jsx` (`handlePlayerClick`). Boxes are drawn at times that are not detection-marker frames.
- Tap checklist: `pickProgress` / `pickGuideStep` / `pickGuidePhase` passed from `src/frontend/src/modes/OverlayModeView.jsx` to `src/frontend/src/components/settings/OverlaySpotlightPanel.jsx`. Find where `pickGuideProgress` is computed and why a keyframe at time 0 does not count for marker 1.
- Entry path: the Finished overlay "Add spotlight" navigation into `/overlay/p/{id}` does not park the playhead on marker 1, while a cold load does. Compare the two entry paths.
- Knowledge docs: `.claude/knowledge/keyframes-framing.md`, `.claude/knowledge/guidance.md`.

## Acceptance Criteria

- [ ] Entering Spotlight from Finished's "Add spotlight" and tapping a drawn box immediately ticks Tap 1 (browser check).
- [ ] No drawn box is tappable without counting toward the guide.
- [ ] After reload, the ticked state matches what the parent tapped.
