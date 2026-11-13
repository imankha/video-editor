> Source: the standalone prototype project at `C:\Users\imank\projects\player-tracking` (not part of this repo). Scripts and `out/` paths named below live there. History: [player-following-history-2026-11.md](player-following-history-2026-11.md).

# Results: can one click follow a player for 4 seconds?

2026-11-12. Yes. On 47 of 54 real Spotlight clips, the best open model (SAMURAI on SAM 2.1 base+)
kept the box on the clicked player for the full 4 seconds from a single box on the first frame.
Three of the other seven are real tracking failures; the rest are unclear test data.

## The test

- 55 Spotlight clips from one prod account (two profiles), pulled read-only. They are the framed,
  upscaled clips the parent sees in Spotlight: mostly 808 x 1440 portrait, 30 fps, hand-held phone
  footage that pans with play. Players are 90 to 340 px tall.
- The click: the parent's first stored pick. Its box goes to the tracker on frame 0; nothing else.
- Ground truth to 2 s: the parent's own later picks (the app's spotlight regions are 2 s long, with
  picks at about 0.67, 1.33 and 2.0 s). 166 picks across the 54 valid clips.
- Ground truth 2 to 4 s: the parent left none. A frame's reference is the box a majority of six
  independent segmentation trackers agree on (`reference.py`). Where they disagree with each other
  or with the parent's picks, the clip is "disputed" and was judged by eye.
- One clip is excluded (`5fbf-wv4`): a re-edited project whose first stored pick sits on empty
  background, so there is nothing to track.
- The stored YOLO boxes in prod are offset from the players in these clips; only the picks were used.

A clip passes when every parent pick is hit, a box is present on at least 90% of frames to 4 s, and
the box is on the reference player over the last half second before 4 s.

## Scores

Speed is frames per second on a laptop RTX 4060 (8 GB) with the GPU to itself, including reading
and resizing frames. A 4 s stretch is 120 frames.

| Tracker | Held 4 s, clean clips (47) | Parent picks hit (166) | Clips with every pick hit (54) | Box present 0 to 4 s | Speed |
|---|---|---|---|---|---|
| **SAMURAI, SAM 2.1 base+** | **47** | 92.8% | 48 | 99.9% | 5.2 fps |
| SAM 2.1 base+ | 46 | 95.2% | 49 | 99.8% | 5.5 fps |
| SAM 2.1 large | 46 | 91.6% | 47 | 99.9% | 3.7 fps |
| DAM4SAM, SAM 2.1 base+ | 44 | 92.2% | 46 | 99.8% | 5.4 fps |
| EdgeTAM | 42 | 94.0% | 47 | 99.5% | 9.4 fps |
| EdgeTAM, started from the person's outline | 41 | 94.0% | 48 | 99.6% | not timed alone |
| SAM 2.1 tiny | 41 | 89.8% | 44 | 99.4% | 6.6 fps |
| Legacy YOLOv8x + ByteTrack (the 2025 endpoint) | 22 | 76.5% | 34 | 74.0% | 12.2 fps |
| YOLO11m + BoT-SORT with re-id | 19 | 80.1% | 35 | 76.7% | 21.3 fps |
| OpenCV ViT tracker (CPU) | 13 | 74.7% | 33 | 96.6% | about 140 fps, tracking only |

How far to trust the "clean clips" column: the reference is a vote among SAM-family models, so it
favours them, and SAMURAI is one of the voters. Two checks do not depend on the vote. The parent's
picks are independent of every tracker, and on those the top five are within a few points of each
other. And contact sheets for SAMURAI were checked by eye on four of ten sheets (about 20 clean
clips); every one stayed on the picked player through 4 s.

## What this says

- The segmentation trackers are a different class from box-linking. The legacy approach and its
  modern sibling lose the player on more than half the clips: when players cross or the phone pans,
  the track id changes and the box simply stops.
- Bigger is not better. SAM 2.1 large is slower than base+ and no more accurate here.
- SAMURAI's motion-aware memory is worth one clip over plain SAM 2.1 base+ on the clean set, while
  plain base+ hits more of the parent's picks (158 against 154 of 166). Treat them as equal; both
  load the same checkpoint.
- EdgeTAM is the fast option: nearly twice the speed, five clean clips worse.
- Starting from the person's outline instead of the box did not help overall.

## The seven disputed clips (SAMURAI base+), judged by eye

| Clip | What happened | Verdict |
|---|---|---|
| `9fa7-wv11` | Backlit, players are dark silhouettes. All SAM 2.1 variants jump to a neighbour at 0.7 s. EdgeTAM and BoT-SORT stay on the right player. | Tracker failure |
| `9fa7-wv15` | Fast pan in the first second; the box shrinks to a fragment. | Tracker failure |
| `9fa7-wv48` | Player runs beside an opponent; box moves to the opponent near 3 s. BoT-SORT stays. | Tracker failure |
| `9fa7-wv27` | The first pick covers two overlapping players; the trackers took the one in front, the parent meant the one behind. | Unclear first box |
| `9fa7-wv31` | Same: two overlapping players in the first pick. | Unclear first box |
| `9fa7-wv16` | The parent's 2.0 s pick is on a different player than the picks at 0 to 1.3 s. The trackers stay on the first player. | Inconsistent picks |
| `9fa7-wv12` | Two players tangled from 1.3 s; cannot tell from stills. | Undetermined |

The failure cases named in HISTORY.md, as observed:

1. Same-kit or look-alike crossing: the cause of all three real failures. Seen, not solved.
2. Fast camera pan: handled on almost every clip; one failure (`wv15`).
3. Brief occlusion or blur: handled; box present on 99.9% of frames.
4. Player leaves the frame and returns: did not occur inside 4 s in this set. Untested.

## Not measured

- The click in the product is on a YOLO box; here it is the parent's stored ellipse, which is
  looser. The two "unclear first box" clips may or may not pass with a real click.
- Only one account's footage, mostly portrait phone video. No Veo wide shots, no DJI.
- Only the first 4 to 5 s after the click. Whole-clip following (10 to 30 s) is a different test.
- Speed and cost on Modal (L4, A100). The laptop number means a 2 s spotlight takes about 12 s and
  a 4 s one about 23 s with SAMURAI, half that with EdgeTAM.
- Box smoothing, and overlap against the parent's Frame crop path (T15860 asks for both).

## Recommendation

Go for the 4 s goal with SAMURAI or plain SAM 2.1 base+ (same weights, Apache-2). Before
productizing: re-run with the real YOLO-box click, add Veo and DJI clips, time it on Modal, and try
a cheap guard for look-alike swaps (BoT-SORT held two of the three clips SAMURAI lost, so a
disagreement between the two could trigger "check this one").

## See for yourself

- `out/videos/samurai_base_plus/*.mp4`: every clip with the tracked spotlight drawn (green), the
  parent's picks in yellow.
- `out/sheets/<tracker>/sheet_*.jpg`: one row per clip, the box at 0 to 5 s.
- `python compare.py <clip> samurai_base_plus,edgetam,botsort_reid_11m`: several trackers on the
  same frames.
