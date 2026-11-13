> Source: the standalone prototype project at `C:\Users\imank\projects\player-tracking` (not part of this repo). Paths starting `legacy/`, `out/` and the `.py` scripts named below live there.

# Why the app does not follow a player today (T15900)

Written 2026-11-12 from the video-editor git history. Every rescued file named here is in
`legacy/`.

## The short answer

A real tracker ran in the codebase for one day and was never connected to the screen. Everything
called "player tracking" in the product since then was a detection overlay: boxes on a few sampled
frames that the parent clicks one by one. Nobody tested following and rejected it on evidence; it
was cut during a UI rework and the name stayed behind.

## Timeline

| Date | What happened | Evidence |
|------|---------------|----------|
| 2025-12-16 | A backend endpoint `POST /track/player` is added. It runs YOLOv8x on every frame, links boxes with ByteTrack (from the `supervision` library) and returns the track whose first box overlaps the box the user picked. Ball detection is added in the same file. | commit `f071ca62f`; `legacy/code/detection_router_2025-12-16_bytetrack.py` lines 426-572 |
| 2025-12-16 | The frontend hook and overlay added in the same commit only ask for detections on the current frame. Nothing in the frontend ever calls `/track/player`. | `legacy/code/usePlayerDetection_2025-12-16.js`, `PlayerDetectionOverlay_2025-12-16.jsx` |
| 2025-12-17 | The endpoint, its request/response models and the `supervision` requirement are deleted, 190 lines, in a commit titled "improving highlight UI". No reason is recorded. | commit `1c6e10a53`; `legacy/code/removal_2025-12-17.diff` |
| 2025-12-27 | `sam2==1.1.0`, `deep-sort-realtime`, `supervision`, `lap` appear in `requirements.txt` as part of a full `pip freeze`. No code imports SAM 2 or DeepSORT, then or since. A `sam2.1_hiera_tiny.pt` checkpoint sits unused in `src/backend/weights`. | commit `afcec67b0` |
| 2026-01 to 2026-02 | Plans describe detection at keyframes, not following; they are deleted in the gesture-sync rework. | `legacy/docs/auto-player-detection.md`, `player-detection-keyframes.md`, `player-detection-combined-plan.md` (deleted in `c2eac5036`) |
| 2026-02-06 to 02-11 | "Player tracking" becomes the name of the box layer's on/off toggle (T06, T57, T58, T53). The task note says "not removing tracking functionality", but the functionality is the box overlay. | `legacy/docs/T06-*.md`, `T57-*.md`, `T58-*.md`, `T53-*.md` |
| 2026-04-30 | Overlay v2 files "Tracker re-acquisition" and "Multi-player tracking" as future work. Neither is built. They name the two worries: the player leaving and re-entering the frame, and short occlusions by another player. | `legacy/docs/T2160-*.md`, `T2220-*.md` |
| 2026-09-08 | The On Fire audit states it plainly: there is no player tracker; the spotlight moves between keyframes by interpolation; YOLO samples 4 frames per clip. | `legacy/docs/T9250-*.md` |
| 2026-11 | T14520 removes the last "tracking" wording from the UI. | `legacy/docs/T14520-*.md` |

## Did following ever run in production?

No. The only tracking code lived on the backend for one day in December 2025, before the first
deployment (2026-01-24), with no caller.

## What the old approach does on today's footage

The 2025 endpoint is re-run as `legacy_bytetrack_v8x` in this prototype, on 55 real Spotlight clips.
See [click-once-following-2026-11.md](click-once-following-2026-11.md) for the numbers. Its weakness is structural: it only knows "a person box here, a
person box there" and links them by overlap. When two players cross, when the phone pans quickly, or
when YOLO misses the player for a few frames, the track id changes and the endpoint simply stops
returning boxes.

## Failure cases the new prototype must pass

Taken from what the old plans feared and what the prod clips actually contain:

1. Same-kit crossing: the athlete passes behind or in front of a teammate in the same shirt.
2. Fast camera pan: the phone operator swings to follow the ball, so every box jumps tens of pixels
   between frames.
3. Brief occlusion or motion blur: the athlete is hidden or smeared for a few frames.
4. Athlete leaves the frame and returns (T2160). Rare inside the first 4 seconds of a spotlight;
   reported separately where it happens.
