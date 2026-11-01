# Epic: Player Moments (AI-found moments for a tapped player, any sport)

**Status:** TODO (prototype-gated: each prototype has a kill criterion and the next task only starts if the previous one did not already settle the path)
**Started:** 2026-10-31
**Completed:** -
**Impact:** 9 **Complexity:** 8 **Priority:** 1.1

## Goal

A parent uploads a full game (any sport, 60 to 90 minutes, phone, tripod or Veo-style wide shot), taps their child once in the video, and the app comes back with a ranked list of time ranges where that child is involved in something notable, each with a score and a label (highlight, learning opportunity, or just interesting). The ranges land as **suggested plays** the parent promotes with one gesture (the same suggestion model the Veo Highlights Import epic introduced in `play_suggestions`, T13200), so the editor's existing Annotate -> Framing -> Overlay flow is unchanged. Target cost: **under $5 per game all-in, ideally under $1.50**.

## Why

Scrubbing 90 minutes for one child is the single biggest time sink in the product and the main reason parents stop after the upload (journey data in the Admin journey drop-off milestone). Every competitor that does per-player moments locks it to its own camera; nobody sells it for arbitrary footage. The research (2026-10-31) found no model or service that does this as a self-serve API, but found a buildable two-tier design and one hosted service worth a one-week pilot. Research report: [player-moments-research-2026-10-31.md](../../research/player-moments-research-2026-10-31.md) (copy of the Obsidian report; raw research notes with sources are in the Obsidian vault under `reelballers/research_notes/Sports video player moment detection/`).

## Decided constraints (user, 2026-10-31)

- **All sports.** Nothing in the pipeline may depend on soccer-specific objects (ball detector, goal box, pitch lines). A sport-specific pre-filter may be added later as an optimization, never as a requirement.
- **The parent taps their child.** Identity is click-seeded. Jersey-number OCR, face, or roster matching is out (every published number says it fails on far wide shots; Veo's own docs admit it).
- **Two tiers.** A cheap model answers "is the child in frame, and where" for every second; a better model answers "is this moment critical for them" only on the seconds that passed tier 1.
- **Prototype before building.** Each prototype answers one question with a number against ground truth, and has a kill criterion written before it runs. If the Twelve Labs pilot (T14310) works economically, we productize that and skip the rest.

## Risk register

Every risk names the task that retires it. A task may not report done while its risks are still open.

| # | Risk | Evidence | Retired by |
|---|------|----------|-----------|
| R1 | **No ground truth.** Without parent-marked moments on real footage, no prototype can be judged; "it looked good on one clip" is how this has gone wrong before. | Every vendor benchmark is broadcast footage; no amateur benchmark exists anywhere | T14300 |
| R2 | **Track loss when the child leaves the frame, is substituted, or is occluded in a pile-up.** The user already saw ByteTrack lose the player on every exit. Memory trackers (SAM 2/3) have the same documented failure ("tracking is lost", GitHub issue #379, no maintainer reply). | Off-screen re-acquisition 8.7 percent in the one football study; VOT-LT F-scores 0.62 to 0.79; 1,400+ ID switches per SportsMOT test split | T14320 |
| R3 | **Small players.** At a wide shot the child is 30 to 80 px tall; detector recall drops and tiling multiplies detector cost about 5x. | SoccerNet 2026 Synloc winner needed adaptive tiling on 4K; SAHI 124 s to 613 s | T14320 |
| R4 | **Twelve Labs has no amateur-footage evidence**, its Search API reference returned 404 (confidence buckets unverified), and its pricing moves to storage-based plans on 2027-01-04 (Free tier 3 GB cannot hold one game). | Vendor benchmarks only, all broadcast | T14310 |
| R5 | **Criticality has a quality ceiling.** Human raters themselves agree only moderately and it is sport-dependent (Krippendorff alpha: soccer 0.70, basketball 0.65, hockey 0.46). Best published VLM result on soccer is MCC 0.50 / accuracy 0.75. No model returns a calibrated probability. | SVHighlights (8 sports); arXiv 2601.16333 | T14330 (rank, not probability; per-sport calibration from thumbs up/down) |
| R6 | **LLM timestamp drift on long video.** Gemini users report invented or drifting timestamps after a few minutes; the remedy is short windows and timestamps that come from the tracker, not the LLM. | Google AI forum threads on 2.5 Pro, 3 Flash, 3.1 Pro | T14330 |
| R7 | **Visual prompting can backfire.** Drawing a box on the child halved a VLM's accuracy in the only sports-video test; the same box as text coordinates improved it. Team confusion is the likely systematic error. | arXiv 2507.02904 (tennis) | T14330 (A/B overlay vs text, per model) |
| R8 | **Price drift.** Gemini 4 Argon doubles 2026-12-01, 3.8 Flash doubles 2027-01-01; Twelve Labs plan change 2027-01-04; hosted SAM endpoints are $30 to $50 per game. The budget must be re-costed at the price in force when T14340 lands. | Official pricing pages read 2026-10-31 | T14340 (cost cap per game enforced in code, not assumed) |
| R9 | **Sport generality of pre-filters.** Audio-event filtering (whistle, crowd) is the only nearly free sport-agnostic signal and its evidence is broadcast audio with commentary; amateur audio will filter less. | SVHighlights audio-only mAP 41.8 with commentary, 33.5 without | T14330 (measure retention on our audio; pre-filter is optional) |
| R10 | **Licensing.** Ultralytics YOLO11/26 is AGPL-3.0, T-DEED is GPL-3.0; SAM license commercial terms unreviewed. Prefer RF-DETR, YOLOX, ARC-SORT, Supervision, Qwen3-VL (Apache/MIT). | Repo licenses | T14320 (only permissive models in the bake-off) |
| R11 | **Operational.** A game file is 5 to 11 GB and must be transcoded first (Gemini Files API 2 GB cap, Twelve Labs storage); Modal cold starts and warm-time dominate self-hosted cost; a full-game job takes minutes to an hour, so the parent needs a background job with progress, not a spinner. | Roboflow reelcut: about one hour per game, "largely queueing and provisioning" | T14340 (reuse the export job pattern, Live Queue milestone) |
| R12 | **Kids' privacy.** Sending children's game video to a third party (Twelve Labs, Google) must be checked against their retention and training terms and against the landing's kids'-privacy stance (T7110). Self-hosted Modal keeps footage in our account. | Gemini Files API retains 48 h; Twelve Labs retains while indexed | T14310 (terms review is an acceptance criterion); T14340 (disclose in the UI) |
| R13 | **Negative moments.** "Learning opportunity" surfaces a child's mistakes to a parent. Product decision needed on whether, and how, these are shown (opt-in label, never auto-exported). | - | T14330 (collect them), T14340 (product decision before UI) |
| R14 | **Re-click burden.** If the tracker needs re-seeding every few minutes, the feature is "watch the game anyway". The acceptable number of re-clicks per game is a product threshold, set before T14320 runs. | No measured youth-sports number exists | T14320 (measure re-clicks needed per game) |

## Prototype ladder (strict order, each gated by the previous result)

| ID | Prototype | Question it answers | Kill criterion (numbers set in T14300 before running) |
|----|-----------|---------------------|------------------------------------------------------------|
| T14300 | Ground-truth set | What does "works" mean, numerically? | None; prerequisite |
| T14310 | Twelve Labs pilot | Can a hosted service do it end to end for under $5 per game? | Recall@20 on parent-marked moments below the T14300 threshold, or cost above $5 per game at 50 games/month, or terms incompatible with R12 |
| T14320 | Click-seeded tracking bake-off (ByteTrack, ARC-SORT, Deep-EIoU, plus BoT-SORT with camera-motion compensation off and OSNet re-ID) | Can any tracker keep the child's identity through exits and re-entries with an acceptable number of re-clicks? | No tracker reaches the T14300 presence-accuracy threshold within the re-click budget (R14) |
| T14330 | Gemini Flash criticality on the child's windows | Does a cheap VLM rank the parent's marked moments above the rest, and at what cost? | Ranking metric below the T14300 threshold on every Flash-class model, or tier 2 cost above $2 per game |
| T14340 | Productize the winning path | - | Gated on T14310 passing, or T14320 and T14330 both passing |

If T14310 passes, T14320 and T14330 are marked OBSOLETE and T14340 integrates Twelve Labs. If T14310 fails, T14320 runs; if T14320 fails, the epic stops and reports (no tier 2 without tier 1).

## Completion Criteria

- [ ] Every risk in the register is retired with a number or a decision, recorded in the owning task file
- [ ] One path (hosted or self-hosted) is productized behind a per-game cost cap enforced in code
- [ ] A parent can tap a child and receive suggested plays with scores and labels, promoted by gesture only (no reactive persistence)
- [ ] Measured cost per game on staging is under $5 and recorded in the task file
- [ ] Kids'-privacy disclosure reviewed by the user before the feature is visible to anyone but admins

## Budget reference (prices read 2026-10-31)

Modal L4 $0.80/hr, A100-80GB $2.50/hr, H100 $3.95/hr. Gemini 2.5 Flash-Lite / 3.5 Flash-Lite / 3.8 Flash / 3.1 Pro on 240 windows of 15 s: $0.06 / $0.22 / $0.46 / $1.30 per game (Batch API halves). Twelve Labs: about $4 to $7 per game on the legacy pay-as-you-go rates, about $2 per game of storage on the $99/month Pro plan at 50 games/month. Self-hosted tier 1 on an L4: $0.30 to $1.20 per game.
