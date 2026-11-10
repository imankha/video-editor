# Epic: Player Moments (AI-found moments for a tapped player, any sport)

## In plain words

The step after suggested plays: tap your child and get the moments that involve them. Which small figure is your kid is the hard half, so this waits until team-level suggestions have captured most of the gain.


**Status:** TODO (prototype-gated: each prototype has KPIs and a kill criterion written before it runs, and the next task starts only if the decision tree says so)
**Started:** 2026-10-31
**Completed:** -
**Impact:** 9 **Complexity:** 8 **Priority:** 1.1

## Goal

A parent uploads a full game (any sport, 60 to 90 minutes, phone, tripod or Veo-style wide shot), taps their child once in the video, and the app comes back with a ranked list of time ranges where that child is involved in something notable, each with a score and a label (highlight, learning opportunity, or just interesting). The ranges land as **suggested plays** the parent promotes with one gesture (the suggestion model the Veo Highlights Import epic introduced in `play_suggestions`, T13200), so the editor's existing Annotate -> Framing -> Overlay flow is unchanged. Target cost: **under $5 per game all-in, ideally under $1.50**.

## The bar: beat Veo's AI on precision AND recall (user, 2026-11-01)

Veo sells per-player moments as the **Player Spotlight** add-on ("Player Moments": shirt-number detection, tunable player-to-ball distance, time on ball, pre/post buffers; Veo support article 27698176364817). It only works on Veo cameras and only via jersey numbers. Our feature is only worth shipping if, on the same games and against the same parent-marked ground truth, it has **higher precision and higher recall than Veo's output for that child**. T14300 measures Veo's numbers first; every prototype is scored against them with the same script. Two Veo baselines exist, and T14300 records which one each game has:

| Baseline | What it is | Fairness |
|----------|-----------|----------|
| **Veo-Spotlight** | Veo Player Moments for the child (needs the add-on on the recording) | Fair, like for like. The bar. |
| **Veo-team** | The Veo highlights zip (Goal / Shot on goal / Attack / Defence / Highlight, team-level, T13200 parser) | Weak on precision (not filtered to the child), fair on recall. If this is the only baseline, recall is the number that counts and precision is reported with that caveat. |

## Decided constraints (user, 2026-10-31 and 2026-11-01)

- **All sports.** Nothing in the pipeline may depend on sport-specific objects (ball detector, goal box, pitch lines). A sport-specific pre-filter may be added later as an optimization, never as a requirement.
- **The parent taps their child.** Identity is click-seeded. Jersey-number OCR, face, or roster matching is out (every published number says it fails on far wide shots; Veo's own docs admit it).
- **Two tiers.** A cheap model answers "is the child in frame, and where" for every second; a better model answers "is this moment critical for them" only on the seconds that passed tier 1.
- **Research is redone first, and models are parameters.** The landscape (models, benchmarks, prices, terms) moves monthly. T14295 refreshes the research and writes the **candidate registry** (`scripts/prototypes/player_moments/candidates.json`). Every prototype fills a **slot** (hosted video-search service, person detector, tracker, video VLM) from the registry; task files describe the slot's requirements and KPIs, never a hard-coded winner. Names in task files are "candidates at filing (2026-10-31)" and are superseded by the registry. **A prototype may not start on a registry older than 60 days** (rerun T14295 in refresh mode first).
- **Prototype before building.** Each prototype answers one question with a number against ground truth and the Veo bar, with the kill criterion written before it runs.

## KPI definitions (single source; `score.py` implements exactly these)

| KPI | Definition | Used by |
|-----|-----------|---------|
| Hit | A predicted range hits a ground-truth moment when their overlap is at least 50 percent of the shorter range; each ground-truth moment can be hit once | all |
| P@K | Of the top K predictions by score, the fraction that hit | T14310, T14330, Veo baselines |
| R@K | Of the ground-truth moments, the fraction hit by some top-K prediction | T14310, T14330, Veo baselines |
| K_veo | Per game, the number of moments Veo produced for the child (Veo-Spotlight) or for the team (Veo-team). Our P@K_veo and R@K_veo are compared with Veo's P and R at its own count | the bar |
| AP | Average precision over the full ranked list (one number for ranking quality) | T14310, T14330 |
| Label kappa | Cohen's kappa between predicted and parent labels (highlight / learning / interesting) on hits | T14330 |
| Presence accuracy | Per-second "child in frame" agreement on the labeled minutes | T14320 |
| Lost-then-recovered | Count of stretches where the track lost the child and later re-acquired the right one | T14320 |
| Wrong-child seconds | Seconds the track followed a different player | T14320 |
| Re-clicks | Number of extra taps needed to keep presence accuracy above threshold for the whole game | T14320 |
| $/game | Dollars per 90-minute game at the price in force on the run date, recorded with the date | all |
| Wall-clock | Minutes from job start to results, per game | all |

**Pass bar for a moment-finding prototype (T14310, T14330):** on a majority of ground-truth games, P@K_veo > Veo P and R@K_veo > Veo R (strict), AND R@20 at or above the absolute floor from T14300 (proposed 0.6), AND $/game under the cap. **Pass bar for tier 1 (T14320):** presence accuracy at or above the floor (proposed 0.85) within the re-click budget (proposed at most 4 per game) and tier 1 $/game under $2.

## Why

Scrubbing 90 minutes for one child is the single biggest time sink in the product and the main reason parents stop after the upload (journey data in the Admin journey drop-off milestone). Every competitor that does per-player moments locks it to its own camera; nobody sells it for arbitrary footage. The research (2026-10-31) found no model or service that does this as a self-serve API, but found a buildable two-tier design and one hosted service worth a pilot. Research report: [player-moments-research-2026-10-31.md](../../research/player-moments-research-2026-10-31.md) (copy of the Obsidian report; raw notes with sources are in the Obsidian vault under `reelballers/research_notes/Sports video player moment detection/`). T14295 produces the refreshed version.

## Risk register

Every risk names the task that retires it. A task may not report done while its risks are still open.

| # | Risk | Evidence | Retired by |
|---|------|----------|-----------|
| R0 | **Stale research.** Model quality, benchmarks, prices and terms change monthly; a plan that names today's winners is wrong by the time it runs. | Gemini 4 Argon and 3.8 Flash price changes within 60 days; Twelve Labs plan change 2027-01-04; Video-MME-v2 published because v1 saturated | T14295 (registry with dates; 60-day refresh rule) |
| R1 | **No ground truth.** Without parent-marked moments on real footage, no prototype can be judged; "it looked good on one clip" is how this has gone wrong before. | Every vendor benchmark is broadcast footage; no amateur benchmark exists | T14300 |
| R2 | **Track loss when the child leaves the frame, is substituted, or is occluded in a pile-up.** The user already saw ByteTrack lose the player on every exit. Memory trackers (SAM 2/3) have the same documented failure. | Off-screen re-acquisition 8.7 percent in the one football study; VOT-LT F-scores 0.62 to 0.79; 1,400+ ID switches per SportsMOT test split | T14320 |
| R3 | **Small players.** At a wide shot the child is 30 to 80 px tall; detector recall drops and tiling multiplies detector cost about 5x. | SoccerNet 2026 Synloc winner needed adaptive tiling on 4K; SAHI 124 s to 613 s | T14320 |
| R4 | **Hosted video-search slot has no amateur-footage evidence** and pricing moves to storage plans on 2027-01-04 (Twelve Labs, the candidate at filing; Search API reference returned 404, score fields unverified). | Vendor benchmarks only, all broadcast | T14310 |
| R5 | **Criticality has a quality ceiling.** Human raters agree only moderately, sport-dependent (Krippendorff alpha: soccer 0.70, basketball 0.65, hockey 0.46). Best published VLM on soccer: MCC 0.50 / accuracy 0.75. No model returns a calibrated probability. | SVHighlights (8 sports); arXiv 2601.16333 | T14330 (rank, not probability; per-sport calibration from thumbs up/down) |
| R6 | **LLM timestamp drift on long video.** Invented or drifting timestamps after a few minutes; remedy is short windows and timestamps from the tracker. | Google AI forum threads on 2.5 Pro, 3 Flash, 3.1 Pro | T14330 |
| R7 | **Visual prompting can backfire.** A drawn box halved a VLM's accuracy in the only sports-video test; the same box as text coordinates improved it. | arXiv 2507.02904 (tennis) | T14330 (A/B overlay vs text, per candidate) |
| R8 | **Price drift.** Budget must be re-costed at the price in force when T14340 lands. | Official pricing pages read 2026-10-31 | T14295 (dated prices in the registry), T14340 (cost cap enforced in code) |
| R9 | **Sport generality of pre-filters.** Audio-event filtering is the only nearly free sport-agnostic signal and its evidence is broadcast audio with commentary. | SVHighlights audio-only mAP 41.8 with commentary, 33.5 without | T14330 (measure retention on our audio; optional) |
| R10 | **Licensing.** Ultralytics YOLO is AGPL-3.0, T-DEED GPL-3.0; SAM commercial terms unreviewed. | Repo licenses | T14295 (license is a registry field; non-permissive candidates are excluded), T14320 |
| R11 | **Operational.** 5 to 11 GB game files must be transcoded first; cold starts dominate self-hosted cost; a job takes minutes to an hour, so the parent needs a background job with progress. | Roboflow reelcut: about an hour per game, mostly queueing and provisioning | T14340 (export job pattern, Live Queue milestone) |
| R12 | **Kids' privacy.** Children's video sent to a third party must be checked against retention and training terms and the landing's kids'-privacy stance (T7110). | Gemini Files API retains 48 h; Twelve Labs retains while indexed | T14295 (terms are a registry field), T14310, T14340 (UI disclosure) |
| R13 | **Negative moments.** "Learning opportunity" surfaces a child's mistakes to a parent. | - | T14330 (collect), T14340 (product decision before UI) |
| R14 | **Re-click burden.** If the tracker needs re-seeding every few minutes, the feature is "watch the game anyway". | No measured youth-sports number exists | T14320 (measure re-clicks per game) |
| R15 | **The Veo bar may be unavailable or unfair.** Veo-Spotlight needs the add-on on the recording; without it only the team-level zip exists, which makes the precision comparison one-sided. | Veo add-on applies only to recordings made after purchase | T14300 (records which baseline each game has; the bar is defined per baseline) |

## Decision tree

```
T14295 Research refresh -> candidates.json (dated; one entry per slot candidate)
  |
  v
T14300 Ground truth + Veo baseline numbers (per game: Veo P, Veo R, K_veo) + thresholds confirmed by user
  |
  v
T14310 Hosted video-search slot pilot (cheapest registry candidate first; at most two candidates)
  |-- PASS  (beats Veo on P and R, R@20 >= floor, $/game <= cap, terms OK) ----> T14340 hosted; T14320 + T14330 OBSOLETE
  |-- NEAR  (beats Veo on R but not P, or $/game within 2x of cap) -> one tuning round (query styles, VLM re-rank of top 40) -> re-score once
  |         |-- PASS -> as above        |-- still NEAR or FAIL -> FAIL
  '-- FAIL  --------------------------------------------------------------------> T14320
                                                                                    |
T14320 Tracker slot bake-off (detector slot x tracker slot from the registry)       v
  |-- PASS  (presence >= floor within re-click budget, tier 1 $/game <= $2) -------> T14330
  |-- NEAR  (presence >= floor but re-clicks over budget) -> user decides the re-click budget (product call)
  |         |-- raised -> PASS          |-- kept -> FAIL
  '-- FAIL  -> STOP. Report. Epic parks until T14295 refresh shows a new tracker candidate (no tier 2 without tier 1)
                                                                                    |
T14330 Video-VLM slot on the child's windows                                        v
  |-- PASS  (beats Veo on P and R, R@20 >= floor, tier 1 + tier 2 $/game <= cap) --> T14340 self-hosted
  |-- NEAR  (beats Veo on R only, or AP within 0.1 of bar) -> swap in the next registry candidate up (within tier 2 cap $2) -> re-score once
  |         |-- PASS -> as above        |-- still NEAR or FAIL -> FAIL
  '-- FAIL  -> STOP. Report. Hybrid (hosted slot queried only on tier 1 windows) is a NEW pilot the user must approve
```

"NEAR" exists so one bounded retry is allowed per prototype; a second retry is a new decision by the user, never an automatic loop.

## Prototype ladder

| ID | Prototype | Slot(s) filled from the registry | Question it answers | KPIs (pass bar in "KPI definitions") |
|----|-----------|----------------------------------|---------------------|--------------------------------------|
| T14295 | Research refresh | all | What are the candidates, their benchmark scores, prices, licenses and terms today? | Registry complete: every slot has 2 to 4 candidates with dated fields |
| T14300 | Ground truth + Veo baseline | - | What does "works" mean numerically, and what does Veo score? | Veo P, Veo R, K_veo per game; floors confirmed |
| T14310 | Hosted video-search pilot | hosted-video-search | Can a hosted service beat Veo end to end under the cap? | P@K_veo, R@K_veo, R@20, AP, $/game, wall-clock, terms |
| T14320 | Click-seeded tracking bake-off | person-detector, tracker | Can a tracker keep the child's identity through exits within the re-click budget? | presence accuracy, lost-then-recovered, wrong-child seconds, re-clicks, $/game |
| T14330 | Video-VLM criticality | video-vlm | Does a VLM rank the parent's moments above the rest, beating Veo, at tier 2 cost under $2? | P@K_veo, R@K_veo, R@20, AP, label kappa, $/game |
| T14340 | Productize | winner(s) | - | measured $/game on staging under cap; Veo bar re-confirmed on staging |

## Completion Criteria

- [ ] Every risk in the register is retired with a number or a decision, recorded in the owning task file
- [ ] The shipped path beats Veo on precision and recall on the ground-truth games (numbers in T14340)
- [ ] One path (hosted or self-hosted) is productized behind a per-game cost cap enforced in code, with candidates read from the registry, not hard-coded
- [ ] A parent can tap a child and receive suggested plays with scores and labels, promoted by gesture only (no reactive persistence)
- [ ] Measured cost per game on staging is under $5 and recorded in the task file
- [ ] Kids'-privacy disclosure reviewed by the user before the feature is visible to anyone but admins

## Budget reference (prices read 2026-10-31; superseded by the registry)

Modal L4 $0.80/hr, A100-80GB $2.50/hr, H100 $3.95/hr. Gemini 2.5 Flash-Lite / 3.5 Flash-Lite / 3.8 Flash / 3.1 Pro on 240 windows of 15 s: $0.06 / $0.22 / $0.46 / $1.30 per game (Batch halves). Twelve Labs: about $4 to $7 per game on legacy pay-as-you-go, about $2 per game of storage on the $99/month Pro plan at 50 games/month. Self-hosted tier 1 on an L4: $0.30 to $1.20 per game.
