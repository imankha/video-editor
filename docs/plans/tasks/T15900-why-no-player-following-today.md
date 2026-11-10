# T15900: Player-following history note

## In plain words

Today the app does not follow a player on its own: Spotlight finds people in a few sampled frames, and the parent places and corrects the circle and the crop box by hand. The code still carries traces of an earlier attempt, a layer called player tracking that was only a detection overlay with an on-off switch, and a tracker library that nothing uses. Before we build a click-once follower we spend half a day finding out what was tried, when, and why it was dropped, and write it down with dates. That way the new prototype starts with the cases that defeated the old one. Done when the history note exists and names the failure cases the prototype must test first.


**Status:** TODO
**Impact:** 7
**Complexity:** 2
**Created:** 2026-11-09
**Updated:** 2026-11-09
**Milestone:** Roadmap 0, Immediate (see PLAN.md)

## How we got here

Owner request 2026-11-09 after the AI-vectors research: the frontend carried a "Player tracking
disabled" string until T14520, the backend venv still holds `deep_sort_realtime`, and the On Fire
audit (2026-09-08) recorded "there is NO player tracker today: spotlight motion between keyframes is
Catmull-Rom interpolation; YOLO samples 4 frames per clip, person-only, no track ids". Before the
click-once following prototype (T15860) is built on SAM 2.1 / SAMURAI, find out what was tried, what
was switched off, and why. The models changed; the footage did not.

## What is already known (do not re-derive)

- "Player tracking" in the product was a per-frame YOLO detection layer with green squares and a layer
  toggle (T58, 2026-02-11: "dim tracking squares when the layer is off"). The "disabled" string was the
  toggle's off state, not a product decision to abandon following.
- Spotlight seeds the ellipse from `detect_players_modal` (YOLOv8x on Modal T4) at sampled frames
  (`modal_functions/video_processing.py` around lines 1151 and 1297); between keyframes the ellipse is
  interpolated. T5570, T5590, T5600, T5610 (July 2026) hardened the detection layer on mobile and made
  the manual override discoverable. T11000 (2026-09-21) fixed a re-export that dropped all detections.
- `deep_sort_realtime` is installed in `src/backend/.venv` but nothing under `src/backend/app` or
  `modal_functions` imports it.

## The problem

Nobody can say today whether a track-following step was ever shipped and removed, prototyped and
rejected, or never attempted. Building T15860 without that answer risks repeating a known failure on
the same footage (30 to 80 px athletes, static wide shot, same-kit confusion).

## What we will do

A half-day read, no product code.

1. Git archaeology: `git log -S"deep_sort"`, `-S"track_id"`, `-S"DeepSort"`, `-S"tracking"` across
   `src/backend`, `src/frontend/src/modes/overlay`, `docs/plans/tasks/T58*`, `T5570*`, `T5600*`,
   `PLAN-archive.md`, `DONE.md`. Record every commit that added or removed a tracker, with its stated
   reason.
2. Read the Overlay detection pipeline as it runs today: which frames are sampled, what `detections`
   the frontend stores, how the ellipse path is derived, and what the user does by hand (count the
   framing points per clip in prod: 1,287 `framing_point_added` events by 69 users, about 19 each).
3. Write `docs/plans/research/player-following-history-2026-11.md`: a dated timeline, the reason
   following was never shipped or was removed, the specific footage failures seen (if any), and a
   go / no-go for T15860 with the two or three failure modes it must test first.

## How we will know it worked

- [ ] The history note exists with a dated timeline and cites commits or task files for every claim.
- [ ] The note states, with evidence, whether a track-following step ever ran in production and why it does not today.
- [ ] The note lists the footage failure modes T15860 must test first (for example same-kit crossings, athlete leaving frame, blur at 30 px), each tied to an observed case or marked as untested.
- [ ] T15860's task file is updated with the go / no-go and the failure modes before it starts.

## For the implementer

### Related Tasks
T15860 (click-once following prototype, gated on this), T15870 (productize), T14520 (removed the
"tracking" copy), T58, T5570, T5600, T5610, T11000, the 2026-09-08 On Fire audit note.

### Relevant Files (REQUIRED)
- `src/backend/app/modal_functions/video_processing.py` (detect_players_modal, YOLO sampling)
- `src/frontend/src/modes/overlay/overlays/PlayerDetectionOverlay.jsx`
- `src/frontend/src/modes/overlay/layers/DetectionMarkerLayer.jsx`
- `src/frontend/src/screens/OverlayScreen.jsx`
- `docs/plans/tasks/T58-dim-tracking-squares-when-disabled.md`
- `docs/plans/PLAN-archive.md`, `docs/plans/DONE.md`
