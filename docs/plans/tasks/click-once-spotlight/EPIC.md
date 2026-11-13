# Epic: Click-once Spotlight

## In plain words

Spotlight is the step that draws a circle that follows the parent's athlete through a highlight (a finished short clip). Today nothing follows anyone: the app finds people on four frames across two seconds, the parent taps their athlete on each of the four, and the circle glides between those taps. If the athlete turns between two taps the circle cuts the corner, and on a phone four precise taps are where parents stall. This epic makes it one tap. The parent taps their athlete once on the first frame and a video model follows that athlete frame by frame for the whole spotlight. A prototype on 54 of the owner's real highlights kept the circle on the right player for four seconds on 46 of the 47 clips we could score cleanly. Where the follower is unsure, the app marks the spot and asks for one more tap; if it fails outright, the parent gets today's four taps and loses nothing.

**Status:** TODO
**Filed:** 2026-11-12
**Started:** not started
**Impact:** 9 **Complexity:** 7 **Priority:** 1.3
**Placement:** runs after the Referral programme (owner, 2026-11-13; it was first placed before Mark plays with AI on 2026-11-12).
**Design:** the Spotlight screen changes (T16240, T16250) need a design review before they are built.

## Goal

A parent taps their athlete once in Spotlight and gets a circle that stays on that athlete for the whole spotlight, at least four seconds, with no further taps on most highlights, and with every manual correction that works today still working.

## Owner decisions (2026-11-12)

1. **One tap is the goal.** After the parent taps their athlete's box on the first frame, they should not need another tap.
2. **Prove it outside the app first.** Done: the prototype project and its results are described below.
3. **The model is SAM 2.1 base+.** The owner picked it from the prototype table. It is free to use commercially (Apache 2 licence).
4. **This runs after the Referral programme.** (Moved by the owner on 2026-11-13; it was first placed before Mark plays with AI.)
5. **A new spotlight stays two seconds long.** Following covers those two seconds, and continues for as long as the parent stretches the spotlight (T16260).

## What the prototype measured

The prototype lives outside this repo at `C:/Users/imank/projects/player-tracking`. The full write-up is [click-once-following-2026-11.md](../../research/click-once-following-2026-11.md); why the app never followed anyone before is in [player-following-history-2026-11.md](../../research/player-following-history-2026-11.md).

- **Footage:** 54 highlights from the owner's production account, portrait phone video that pans with play, athletes 90 to 340 pixels tall. The parent's first stored pick was the tap; their later picks were the truth to two seconds; from two to four seconds the truth was the box most trackers agreed on, checked by eye.
- **SAM 2.1 base+:** stayed on the athlete for four seconds on 46 of 47 cleanly scored clips, and landed on 158 of the parent's 166 own picks, the best of ten trackers on that measure.
- **The old approach** (find every person on every frame and link the boxes, written for the app in December 2025 and deleted a day later) held 22 of 47. It loses the athlete whenever players cross or the phone pans.
- **Bigger was not better.** The large model was slower and no more accurate. A lighter model, EdgeTAM, was nearly twice as fast and five clips worse; it is the fallback if cost or wait is a problem.
- **Speed:** about 5 frames a second on a laptop graphics card, so a two-second spotlight took about 12 seconds and a four-second one about 23.

**What went wrong, and what it means for the build.** Every real failure was a look-alike: a teammate or opponent of similar build crossing or running beside the athlete, and the follower switching to them. This is why the epic has its own task for marking doubtful spots (T16250). Two more clips had a first pick that covered two overlapping players.

**What nobody has measured yet.** The first task (T16220) measures all of these before any screen is built:

- the tap as it will really be, on one detected person's box (the prototype used the parent's stored circle, which is looser);
- speed and cost on the rented graphics cards the app uses;
- wide-angle Veo and DJI footage, where athletes are much smaller;
- anything longer than five seconds;
- an athlete who leaves the picture and comes back.

## How it works (locked unless a task file says otherwise)

- **The tap names one person.** The follower starts from the detected box the parent tapped on the first frame, as Spotlight shows it today.
- **The follower runs on the server** on a rented graphics card, on the highlight the parent already paid to sharpen. It returns the athlete's box on every frame, with a mark on any stretch where it is unsure.
- **The result becomes ordinary spotlight points.** The path is thinned to a handful of points the parent can drag, exactly like the ones their taps make today. Export, saving and re-editing do not change.
- **No new charge.** Following is part of Spotlight. Its cost is measured in T16220 and watched afterwards (T16270); if it is not small, the owner decides before the screens ship.
- **Failure is quiet.** If the follower cannot run, is switched off, or takes too long, the parent sees today's four taps with one plain line of explanation. Nothing is lost and nothing is charged.
- **Safety switches.** A kill switch and a daily spend cap, like the ones planned for Mark plays with AI.
- **Frame is not in this epic.** Frame is the step where the parent crops around their athlete. Following there happens on the raw game video, where athletes are far smaller; that stays a separate, unproven task (T15860, T15870).

## Tasks (dependency order)

| ID | Task | Status |
|----|------|--------|
| T16220 | [Following engine](T16220-following-engine.md) | TODO |
| T16230 | [Followed path as spotlight points](T16230-followed-path-as-spotlight-points.md) | TODO |
| T16240 | [One tap in Spotlight](T16240-one-tap-in-spotlight.md) | TODO |
| T16250 | [Doubtful spots and one-tap fix](T16250-doubtful-spots-and-one-tap-fix.md) | TODO |
| T16260 | [Following for longer spotlights](T16260-following-for-longer-spotlights.md) | TODO |
| T16270 | [Following read-out and switches](T16270-following-read-out-and-switches.md) | TODO |

## Done when

- On the 54-clip set, with the tap made on a detected box, a parent needs no second tap on at least 45 clips.
- On staging, on a phone, one tap on a real highlight produces a spotlight that follows the athlete, and the exported video shows it.
- A forced failure of the follower leaves the parent in today's four-tap flow with no error screen.
- The admin can see how many spotlights used following, how many needed a correction, and what it cost.

## For implementers

- Read the prototype's `RESULTS.md`, `README.md` and `trackers/impl.py` (class `Sam2`) before writing code: the model is driven through the stock `sam2` package's video predictor with a box prompt on frame 0, config `configs/sam2.1/sam2.1_hiera_b+.yaml`, checkpoint `sam2.1_hiera_base_plus.pt`.
- The test set is rebuilt with the prototype's `fetch_prod_data.py`; it is footage of children from a private account and must not be committed or copied to shared storage.
- Knowledge docs: `.claude/knowledge/modal-gpu.md`, `.claude/knowledge/keyframes-framing.md`, `.claude/knowledge/persistence-sync.md`.
- Stored detection boxes in production were found offset from the players on these clips (seen while building the test set). T16220 checks whether that is a display-only artefact of old data or a live bug, because the tap depends on those boxes.
