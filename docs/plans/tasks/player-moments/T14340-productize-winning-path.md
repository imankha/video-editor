# T14340: Productize the winning path: tap a player in Annotate, get scored suggested plays

## In plain words

Turn the winning path into a feature: tap a player in Annotate, get scored suggested plays, under a cost cap per game.


**Status:** TODO
**Impact:** 9
**Complexity:** 7
**Tier:** L (design-gated: backend job + Modal or hosted integration + Annotate UI + credits; schema only if `play_suggestions` needs a score and label column)
**Created:** 2026-10-31
**Updated:** 2026-11-01
**Epic:** [Player Moments](EPIC.md), task 6/6. Gated on T14310 PASS, or T14320 and T14330 both PASS. Retires R8, R11, R12 (disclosure), R13 (product decision).

## Problem

The prototypes prove a path, a cost, and that it beats Veo on the ground-truth games. This task turns it into a feature a parent can use without seeing any of the machinery, inside the existing gesture-based editor, under a per-game cost cap, with the model choice still a parameter so a registry refresh can swap a candidate without a redesign.

## Solution (to be designed in Stage 2 after the prototypes; the shape below is the constraint set, not the design)

- **Gesture.** In Annotate, a new action "Find my player's moments": the parent scrubs to a frame, taps the child, confirms kit color (and direction of play if the design needs it). That tap is the only input. Re-tap prompts appear only if the tracker's confidence signal (T14320) drops, and only within the re-click budget (R14).
- **Job.** A background job in the existing export/job pattern (Live Queue milestone): transcode on Modal, then the winning path. Progress and completion arrive as change events; no polling refresh. Cost per game is computed before dispatch from the game's duration and the registry's dated price for the configured candidate(s), and the job refuses above the cap (R8) with a visible message.
- **Candidates as configuration.** The production job names its candidates by registry id in a config constant (greppable, not dynamic dispatch); swapping a candidate is a config change plus a re-run of `score.py` on the ground-truth games, not a redesign.
- **Output.** Rows in `play_suggestions` (T13200) with start, end, score, label (highlight / learning / interesting), and source = player_moments. Promotion to a play is the parent's one-tap gesture; nothing is persisted reactively. If `play_suggestions` lacks score and label columns, this task includes a profile_db migration (Migration agent).
- **Ranking and feedback.** Suggestions in score order with the label; dismiss and promote are recorded as the per-sport calibration signal (R5). No "probability" wording in the UI; the score is a rank.
- **Negative moments (R13).** Product decision by the user before the UI is built: whether "learning opportunity" rows are shown, behind what label, never auto-exported.
- **Privacy (R12).** If a hosted provider is used, the UI discloses where the video goes and for how long, consistent with the landing's kids'-privacy stance; footage is deleted from the provider once suggestions are stored.
- **Credits.** The per-game cost maps onto the existing credit model; the user decides whether the first game is free.

## KPIs

| KPI | Pass bar |
|-----|----------|
| Veo bar on staging | The shipped path, run on staging on the T14300 games, still beats Veo's P and R (numbers recorded here) |
| $/game on staging | under $5 measured, recorded with the price date |
| Cap refusal | a game whose computed cost exceeds the cap is refused with a visible message (test) |
| Gesture-only persistence | every write traces to tap / promote / dismiss (review checklist) |

## Context

### Relevant Files (REQUIRED, to be refined by the Code Expert at task start)
- `src/backend/app/routers/` new router for the player-moments job; `src/backend/app/services/` job service; Modal functions under the existing Modal app (`.claude/knowledge/modal-gpu.md`)
- `src/backend/app/database.py` profile_db `play_suggestions` (score, label columns if missing) and a `profile_db` migration under `src/backend/app/migrations/profile_db/`
- `src/frontend/src/modes/AnnotateModeView.jsx` and the suggestions list introduced by the Veo import epic
- `scripts/prototypes/player_moments/` prototype code and `candidates.json` are reference only; production code lives in `src/`
- Reference: [EPIC.md](EPIC.md), [research report](../../research/player-moments-research-2026-10-31.md)

### Related Tasks
- Depends on: T14310 (PASS) or T14320 + T14330 (PASS); T13200 (`play_suggestions`) and the Veo import suggestions UI; Live Queue job pattern
- Related: T7110 (kids'-privacy stance on the landing), Storage Credits decisions

### Technical Notes
- Persistence: every write traces to a gesture (tap to start the job; promote; dismiss). Job results are written by the backend job's explicit contract, never by a frontend effect.
- Re-cost at landing time: the price table is a named constant with the date it was read, copied from the registry; the cap check uses it.
- Design doc required (`docs/plans/tasks/T14340-design.md`), approved by the user before implementation.

## Implementation

### Steps
1. [ ] Classification and Code Expert audit of the Veo suggestions path and the job pattern
2. [ ] Design doc with the chosen path, candidate config, cost cap, schema delta, UI flow, disclosure copy; user approval
3. [ ] Failing tests (job dispatch and cap refusal; suggestion rows; promote gesture)
4. [ ] Implement backend job and provider integration
5. [ ] Migration if needed
6. [ ] Annotate UI: tap, progress, suggestions with score and label, dismiss feedback
7. [ ] Staging run on the T14300 games; Veo bar and cost per game recorded here

### Progress Log

**2026-10-31**: Filed from the research session.
**2026-11-01**: Veo bar on staging and candidates-as-configuration added.

## Acceptance Criteria

- [ ] Parent taps a child and receives scored, labeled suggested plays promoted by gesture only
- [ ] Job refuses above the per-game cost cap with a visible message; cap value and price date recorded in code
- [ ] Measured cost per game on staging under $5, and the Veo bar still beaten on staging, recorded in this file
- [ ] Privacy disclosure and the learning-opportunity decision approved by the user before non-admin visibility
- [ ] All risks R8, R11, R12, R13 marked retired in EPIC.md
