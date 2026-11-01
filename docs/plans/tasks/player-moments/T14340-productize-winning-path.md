# T14340: Productize the winning path: tap a player in Annotate, get scored suggested plays

**Status:** TODO
**Impact:** 9
**Complexity:** 7
**Tier:** L (design-gated: backend job + Modal or hosted integration + Annotate UI + credits; schema only if `play_suggestions` needs a score and label column)
**Created:** 2026-10-31
**Updated:** 2026-10-31
**Epic:** [Player Moments](EPIC.md), task 5/5. Gated on T14310 PASS, or T14320 and T14330 both PASS. Retires R8, R11, R12 (disclosure), R13 (product decision).

## Problem

The prototypes prove a path and a cost. This task turns it into a feature a parent can use without seeing any of the machinery, inside the existing gesture-based editor, under a per-game cost cap.

## Solution (to be designed in Stage 2 after the prototypes; the shape below is the constraint set, not the design)

- **Gesture.** In Annotate, a new action "Find my player's moments": the parent scrubs to a frame, taps the child, confirms kit color (and the direction of play if the design needs it). That tap is the only input. Re-tap prompts appear only if the tracker's confidence signal (T14320) drops, and only where the product threshold (R14) allows.
- **Job.** A background job in the existing export/job pattern (Live Queue milestone): transcode on Modal, then either the Twelve Labs path (T14310) or tracker + Gemini (T14320 + T14330). Progress and completion arrive as change events; no polling refresh. Cost per game is computed before dispatch from the game's duration and the price table in force, and the job refuses above the cap (R8) with a visible message.
- **Output.** Rows in `play_suggestions` (introduced by the Veo Highlights Import epic, T13200) with start, end, score, label (highlight / learning / interesting), and source = player_moments. Promotion to a play is the parent's one-tap gesture, exactly like Veo suggestions; nothing is persisted reactively. If `play_suggestions` lacks score and label columns, this task includes a profile_db migration (Migration agent).
- **Ranking and feedback.** Suggestions are shown in score order with the label; a thumbs-down (dismiss) and the promote gesture are recorded as the calibration signal per sport (R5). No "probability" wording in the UI; the score is a rank.
- **Negative moments (R13).** Product decision by the user before the UI is built: whether "learning opportunity" rows are shown, behind what label, and never auto-exported.
- **Privacy (R12).** If a hosted provider is used, the UI discloses where the video goes and for how long, consistent with the landing's kids'-privacy stance; footage is deleted from the provider once suggestions are stored.
- **Credits.** The per-game cost maps onto the existing credit model (Storage Credits / pricing rebalance decisions); the user decides whether the first game is free.

## Context

### Relevant Files (REQUIRED, to be refined by the Code Expert at task start)
- `src/backend/app/routers/` new router for the player-moments job; `src/backend/app/services/` job service; Modal functions under the existing Modal app (`.claude/knowledge/modal-gpu.md`)
- `src/backend/app/database.py` profile_db `play_suggestions` (score, label columns if missing) and a `profile_db` migration under `src/backend/app/migrations/profile_db/`
- `src/frontend/src/modes/AnnotateModeView.jsx` and the suggestions list introduced by the Veo import epic
- `scripts/prototypes/player_moments/` prototype code is reference only; production code lives in `src/`
- Reference: [EPIC.md](EPIC.md), [research report](../../research/player-moments-research-2026-10-31.md)

### Related Tasks
- Depends on: T14310 (PASS) or T14320 + T14330 (PASS); T13200 (`play_suggestions`) and the Veo import suggestions UI; Live Queue job pattern
- Related: T7110 (kids'-privacy stance on the landing), Storage Credits decisions

### Technical Notes
- Persistence: every write traces to a gesture (tap to start the job; promote; dismiss). Job results are written by the backend job's explicit contract, never by a frontend effect.
- Re-cost at landing time: the price table is a named constant with the date it was read; the cap check uses it.
- Design doc required (`docs/plans/tasks/T14340-design.md`), approved by the user before implementation.

## Implementation

### Steps
1. [ ] Classification and Code Expert audit of the Veo suggestions path and the job pattern
2. [ ] Design doc with the chosen path, cost cap, schema delta, UI flow, disclosure copy; user approval
3. [ ] Failing tests (job dispatch and cap refusal; suggestion rows; promote gesture)
4. [ ] Implement backend job and provider integration
5. [ ] Migration if needed
6. [ ] Annotate UI: tap, progress, suggestions with score and label, dismiss feedback
7. [ ] Staging run on 3 real games; measured cost per game recorded here

### Progress Log

**2026-10-31**: Filed from the research session.

## Acceptance Criteria

- [ ] Parent taps a child and receives scored, labeled suggested plays promoted by gesture only
- [ ] Job refuses above the per-game cost cap with a visible message; cap value and price date recorded in code
- [ ] Measured cost per game on staging under $5, recorded in this file
- [ ] Privacy disclosure and the learning-opportunity decision approved by the user before non-admin visibility
- [ ] All risks R8, R11, R12, R13 marked retired in EPIC.md
