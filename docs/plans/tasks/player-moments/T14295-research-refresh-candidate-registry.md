# T14295: Research refresh: candidate registry for every slot (models as parameters, not hard-coded picks)

**Status:** TODO
**Impact:** 8
**Complexity:** 3
**Tier:** S (no app code; a research note and one JSON registry file under `scripts/prototypes/`)
**Created:** 2026-11-01
**Updated:** 2026-11-01
**Epic:** [Player Moments](EPIC.md), task 1/6. Retires R0; feeds R4, R8, R10, R12. **Runs first, and reruns in refresh mode whenever the registry is older than 60 days when a prototype is about to start.**

## Problem

The 2026-10-31 research named specific models, services and prices. By the time the epic runs (after For Alpha polish) the picture will have moved: new video VLMs, new trackers, price changes already announced for December and January, and a hosted vendor changing its plan model. If the prototype tasks hard-code today's names, they test the wrong things. The user's direction (2026-11-01): treat the state of models as a parameter.

## Solution

Produce the **candidate registry** that every prototype reads, plus a dated research note explaining each entry. The registry is the only place a model, service or price is named; prototype scripts take candidate ids as arguments.

### Slots and their requirements

| Slot | Requirement (what a candidate must offer) | Candidates at filing (2026-10-31; superseded by the registry) |
|------|-------------------------------------------|-------------------------------------------------------------|
| `hosted-video-search` | Upload a full game, query by text and by an image crop (the tap), get time-stamped results with a score; per-game cost computable; terms allow children's video with deletion on request | Twelve Labs Marengo 3.0 (+ Pegasus for labels); Azure Content Understanding; Memories.ai; Cloudglue |
| `person-detector` | Permissive license; person class; runs on an L4 at 5 to 10 fps on 1080p; tiling possible | RF-DETR, YOLOX (not Ultralytics, AGPL) |
| `tracker` | Detect-then-associate (tolerates 5 to 10 fps); exposes track ids over time; ideally re-ID or offline tracklet stitching; permissive license | ByteTrack, ARC-SORT, Deep-EIoU, BoT-SORT (CMC off) + OSNet |
| `video-vlm` | Native video or sampled-frame input of 15 to 30 s windows with audio if possible; structured JSON output; price per game computable; optional Batch mode | Gemini 2.5 Flash-Lite, 3.5 Flash-Lite, 3.8 Flash, 3.1 Pro; Claude Haiku 5.5 (frames only); Qwen3-VL-8B self-hosted |
| `audio-prefilter` (optional) | CPU-only audio event tagger; sport-agnostic | frozen AST + GRU head |

### Registry format `scripts/prototypes/player_moments/candidates.json`

One entry per candidate with: `id`, `slot`, `name`, `version_or_model_id`, `provider`, `access` (api / self-hosted / sdk), `license`, `price` ({unit, usd, read_on, change_announced_for}), `video_input` (native / frames / none; max length; audio yes/no), `benchmarks` (list of {name, split, score, source, date}), `terms` ({retention, training_use, deletion, children_ok: yes / no / unclear, source}), `notes`, `researched_on`, `status` (candidate / excluded with reason). A tiny self-test asserts every slot has at least two `candidate` entries and every price has a `read_on` date.

### Benchmarks to read scores from (the user asked for the best video-analysis multimodal models; 2026-11-01 snapshot of which benchmarks exist)

- **General video understanding:** Video-MME (and Video-MME-v2, introduced in 2026 because v1 saturated), MVBench, LongVideoBench, LVBench, MLVU, VideoMMMU, TempCompass. Record the model's score, the split (long / no subtitles matters), and whether the number is self-reported or leaderboard-run. Note: the research found no single authoritative 2026 leaderboard; aggregator sites were stale, so take numbers from the benchmark's own page or the model card.
- **Sports-specific:** SPORTU-video (7 sports, QA; at 2024 release Claude 3.5 Sonnet led at 69.5 percent), SportR (ICLR 2026; the top model scored 34 percent on video foul classification, so sports reasoning is far from solved), CourtSI-Bench (spatial), SportD (on-ball decisions). These are the closest proxies for "is this moment notable for this player".
- **Tracking and re-ID:** SoccerNet tracking (HOTA) and re-ID (mAP), SportsMOT, DanceTrack, VOT-LT (long-term, exits and re-entries). Prefer numbers reported with camera motion and re-entry.
- **Temporal grounding (timestamps):** Charades-STA / ActivityNet-Captions moment retrieval R@1 IoU 0.5 where a model reports it; this is the R6 proxy.

Benchmarks are a screen, not the verdict; the ground-truth games (T14300) decide.

### Research scope beyond scores

- Prices in force and announced changes (R8), with dates.
- Terms: retention, training use, deletion, and whether children's video is allowed (R12), with the URL and date read.
- License per self-hosted candidate (R10); AGPL / GPL entries are `excluded` with the reason, kept in the file so nobody re-researches them.
- New entrants: any product or API that now sells per-player moments for arbitrary footage (none existed 2026-10-31). If one exists, flag it to the user: it may change the ladder (a hosted per-player service would be a new first prototype).
- Veo: current state of Player Spotlight / Player Moments (R15): what it outputs, whether an export exists, and whether the user's team's recordings have the add-on.

## KPIs for this task

| KPI | Pass |
|-----|------|
| Registry completeness | Every slot has 2 to 4 `candidate` entries; every entry has license, dated price, terms, and at least one benchmark score or an explicit "no public score" |
| Freshness | Every `researched_on` within 14 days of the task's completion date |
| Ladder check | A one-paragraph verdict: does any new entrant change the decision tree in EPIC.md? (yes/no, with the entry id) |

## Setup

- Run the deep-research skill with the 2026-10-31 report and its Obsidian notes as background to build on (not redo from scratch), one researcher per slot plus one for benchmarks and one for Veo.
- Output: `docs/plans/research/player-moments-refresh-{YYYY-MM-DD}.md` (dated note, sources) and `scripts/prototypes/player_moments/candidates.json`.
- Budget: no API spend; one session.
- **Refresh mode** (registry older than 60 days when a prototype starts): one researcher re-checks prices, terms and new entrants for the slot about to run; bump `researched_on`; takes under an hour.

## Decision

- Registry complete and no ladder-changing entrant -> T14300 starts.
- Ladder-changing entrant found -> stop and present the user a decision artifact (new ladder vs current) before T14300.

## Context

### Relevant Files (REQUIRED)
- `scripts/prototypes/player_moments/candidates.json` (new) and `scripts/prototypes/player_moments/test_candidates.py` (new, tiny self-test, run by hand)
- `docs/plans/research/player-moments-refresh-{date}.md` (new)
- Reference: [EPIC.md](EPIC.md), [research report 2026-10-31](../../research/player-moments-research-2026-10-31.md)

### Related Tasks
- Blocks: T14300, T14310, T14320, T14330
- Reruns before: any prototype starting on a registry older than 60 days

### Technical Notes
- `scripts/` is not run by CI; keep the self-test runnable with plain `python -I`.
- Never put API keys or account details in the registry.

## Implementation

### Steps
1. [ ] Research run (one researcher per slot, one for benchmarks, one for Veo), notes saved
2. [ ] Write `candidates.json` and its self-test
3. [ ] Dated research note with the ladder-check verdict
4. [ ] If a ladder-changing entrant exists, decision artifact for the user

### Progress Log

**2026-11-01**: Filed (user direction: redo research first; models are parameters; look at video benchmark scores).

## Acceptance Criteria

- [ ] `candidates.json` passes its self-test; every slot has 2 to 4 candidates with dated price, license, terms, benchmark scores
- [ ] Research note names the benchmarks consulted and the date each score was read
- [ ] Ladder-check verdict recorded in the note and in EPIC.md's progress
