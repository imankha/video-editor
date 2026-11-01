# T14330: Prototype 3: video-VLM slot on the child's windows ("is this interesting, a highlight, a learning opportunity?")

**Status:** TODO
**Impact:** 8
**Complexity:** 4
**Tier:** M (prototype script, no app code; budget under $20 of API spend per candidate)
**Created:** 2026-10-31
**Updated:** 2026-11-01
**Epic:** [Player Moments](EPIC.md), task 5/6. Runs only if T14320 PASSED. Retires R5, R6, R7, R9, R13 (collects the data for the product decision).

## Problem

Tier 2 takes the seconds where tier 1 says the child is in frame and asks a better model whether the moment matters for that child. At filing this is cheap on Flash-class Gemini ($0.06 to $0.46 per game for 240 windows, Batch halves it) but has a real quality ceiling (human raters agree only moderately; best published VLM result MCC 0.50 on soccer), LLM timestamps drift on long video, and drawing a box on the child can halve accuracy while the same box as text helps. This prototype measures ranking quality against the Veo bar and cost, on our games, with the questions the user wants asked, for whichever `video-vlm` candidates the registry holds when it runs.

## Slot and candidates

Slot `video-vlm` from `candidates.json`: run every `candidate` entry that fits the tier 2 cost cap ($2 per game) on all windows; run entries above it only on the top 20 windows (as a re-ranker). Candidates at filing: Gemini 2.5 Flash-Lite, 3.5 Flash-Lite, 3.8 Flash, 3.1 Pro (re-ranker); Claude Haiku 5.5 on sampled frames (no audio); Qwen3-VL-8B self-hosted on Modal. The script takes `--candidate <id>` and reads price, input mode (native video vs frames, audio yes/no) and limits from the registry. Benchmark scores in the registry (Video-MME, SPORTU-video, SportR) are the ordering hint for which candidate to run first, not the verdict.

## KPIs

| KPI | Definition (EPIC.md) | Pass bar |
|-----|----------------------|----------|
| P@K_veo, R@K_veo | per game, at Veo's count | strictly above Veo on a majority of games |
| R@20 | recall of parent moments in the top 20 | at or above the floor (proposed 0.6) |
| AP | ranking quality | reported; NEAR decision uses it |
| Label kappa | highlight vs learning vs interesting agreement with the parent | reported (R13 data) |
| $/game | tier 2 at the registry price, standard and Batch, plus tier 1 from T14320 | tier 2 under $2; total under $5 |
| Timestamp error | mean absolute error of returned sub-ranges vs the parent's, after snapping to the tracker | reported (R6) |
| Window retention | windows kept by the optional audio pre-filter and the recall lost by it | reported (R9) |

## Setup

1. **Windows.** From T14320's winning presence output, 15-second windows where the child is present (merge adjacent, cap 30 s). Record windows per game and the fraction of the game they cover. Optional: the `audio-prefilter` registry candidate on CPU, retention and lost recall recorded.
2. **Prompt.** Per window, one structured-JSON call with reasoning before scores asking the user's questions: "Is this interesting for the player at {box as text coordinates, kit color, direction of play}? If so, which time ranges inside this window?", "Is this a highlight?", "Is this a learning opportunity?", each with a 0 to 1 score and a one-line reason. Timestamps are window-relative and snapped to the tracker timeline (R6); the model never sees more than 30 s.
3. **Visual prompting A/B (R7)** per candidate: (a) box as text coordinates vs (b) drawn box or circle on the frames. Keep the better; expect (a).
4. **Candidates.** Every in-cap candidate on all windows; over-cap candidates as top-20 re-rankers. Low media resolution first; one game at high resolution to see whether ranking changes. Tokens and dollars per game per candidate, standard and Batch.
5. **Ranking.** Scores are ranks (R5). A listwise pass over the top 10 to 15 windows in one call ("order these by how notable they are for the player"); use the listwise order or a simple Bradley-Terry fit.
6. **Baseline.** One whole-game call per game at low resolution with no tracking ("list every notable moment for the player in {description}") on the cheapest native-video candidate, to confirm tier 1 earns its cost.
7. **Score** everything with `score.py` against ground truth and the Veo bar; results in `results/T14330-{candidate}-{game}.md`, raw JSON kept.
- Budget: under $20 per candidate; time box two weeks.
- Registry under 60 days old, else T14295 refresh mode first.

## Decision

- **PASS** (best candidate beats Veo on P and R, R@20 at or above floor, tier 1 + tier 2 under $5): T14340 productizes tier 1 winner + this candidate.
- **NEAR** (beats Veo on recall only, or AP within 0.1 of the best Veo-beating configuration, or only an over-cap candidate passes): one round, which is the next candidate up in the registry used as a re-ranker within the tier 2 cap, re-scored once. PASS or FAIL after that.
- **FAIL**: the epic STOPS and reports. A hybrid (hosted-video-search queried only on tier 1 windows) is a new pilot the user must approve; it is not started automatically.

## Context

### Relevant Files (REQUIRED)
- `scripts/prototypes/player_moments/vlm_criticality.py` (new; `--candidate`, reads T14320 presence JSON and the transcoded game, writes predictions)
- `scripts/prototypes/player_moments/results/T14330-*.md` (new)
- Reference: [EPIC.md](EPIC.md), research addendum tier 2, Obsidian note `criticality_scoring_tier.md`

### Related Tasks
- Depends on: T14295, T14300, T14320 (PASS)
- Blocks: T14340

### Technical Notes
- Native-video candidates: upload one transcode and clip by offsets rather than uploading each window (Gemini Files API: 2 GB, 48 h retention at filing).
- Frame-only candidates get 2 fps sampled frames per window; audio absence is recorded as a confound.
- "Learning opportunity" results are collected; the product decision on showing them (R13) belongs to the user in T14340.

## Implementation

### Steps
1. [ ] Window extraction from T14320 output; counts per game
2. [ ] Prompt and JSON schema; text-coordinate vs drawn-box A/B
3. [ ] Run the in-cap candidates; over-cap as re-rankers; tokens and dollars
4. [ ] Listwise refinement; score everything against ground truth and Veo
5. [ ] Whole-game no-tracking baseline
6. [ ] Verdict (PASS / NEAR / FAIL) recorded in EPIC.md with the winning candidate id and settings

### Progress Log

**2026-10-31**: Filed from the research session.
**2026-11-01**: Rewritten as a slot prototype with KPIs, setup, and the PASS / NEAR / FAIL decision.

## Acceptance Criteria

- [ ] Every KPI above recorded per candidate per game next to Veo's numbers
- [ ] Tier 1 + tier 2 $/game recorded (standard and Batch) with the price date
- [ ] Text-coordinates vs drawn-box result recorded per candidate
- [ ] Whole-game baseline recorded next to the two-tier result
- [ ] Verdict recorded in EPIC.md
