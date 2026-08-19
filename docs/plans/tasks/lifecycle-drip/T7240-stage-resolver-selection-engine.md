# T7240: Stage Resolver + Template Selection/Render Engine

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-08-19
**Updated:** 2026-08-19

Epic task 2/5 — see [EPIC.md](EPIC.md) for the stage model (§2), template-as-data rules
(§3), and content rules (§8). Depends on T7230's `drip_templates` table.

## Problem

The "look at their activity and give them the right email" core: pure, heavily-tested logic
that maps a user's `user_actions` rows to a funnel stage, picks the `(drip_day, stage)`
template, and renders variables — with zero network/scheduling concerns so it can be unit
tested exhaustively before the scheduler (T7260) exists.

## Solution

New module `src/backend/app/services/drip_engine.py` with four pure-ish functions:

### `resolve_stage(action_counts: dict[str, int]) -> str`
Input: `{action: total_count}` for one user (the caller aggregates
`SELECT action, SUM(count) FROM user_actions WHERE user_id = %s GROUP BY action` — same
shape `routers/admin.py:list_users` already builds). Output: one stage key from EPIC §2.

Walk a stage-ordered ladder, highest reached wins — the drip-bucketed analogue of
`admin.py:_compute_last_step` (which walks `FUNNEL_STEPS` from `analytics.py`). Do NOT
modify `_compute_last_step` (it feeds the admin table's display labels); the drip ladder is
coarser (7 buckets) and maps `clip_created` OR `annotation_completed` → `clipped` (prod
data shows either can appear without the other — jautomo had `annotation_completed` with no
`clip_created`).

### `build_context(user_id: str, stage: str) -> dict`
Returns exactly the variables the stage's whitelist allows (T7230's table): `{{game_name}}`
(most recent game's name) and `{{clip_count}}` (raw_clips count), read from the user's
**default profile** DB. READ-ONLY — open via the same pattern `sweep_scheduler.do_sweep`
uses (`set_current_user_id` / `set_current_profile_id` / `ensure_database` then
`get_db_connection()`); never write, never sync back. Default profile id from
`user_db.get_profiles()` (`is_default = 1`).

If a required variable can't be produced (no game row despite `uploaded` stage — data
inconsistency), raise `DripRenderError` — the caller records `failed`, never guesses
(no-silent-fallbacks rule).

### `select_template(cur, drip_day: int, stage: str) -> row | None`
One SELECT on `drip_templates`. Returns `None` when the row is absent OR `enabled = false`
(caller records `skipped` with detail).

### `render_template(subject: str, body: str, context: dict) -> tuple[str, str]`
Substitutes `{{var}}` tokens in subject + body. ANY unresolved token after substitution →
`DripRenderError` (send must fail loudly, EPIC §3). No conditionals, no loops — flat
variables only; complexity in copy stays in copy.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/services/drip_engine.py` — NEW (the whole task)
- `src/backend/tests/test_drip_engine.py` — NEW
- Read-only reference (do not modify): `src/backend/app/analytics.py` (`FLOW_EVENTS`,
  `FUNNEL_STEPS`), `src/backend/app/routers/admin.py` (`_compute_last_step`),
  `src/backend/app/services/sweep_scheduler.py` (cross-user profile read pattern),
  `src/backend/app/services/user_db.py` (`get_profiles`)

### Related Tasks
- Depends on: T7230 (`drip_templates` table for `select_template` tests)
- Blocks: T7260 (pipeline composes these functions)

### Technical Notes
- Backend tests TRUNCATE the real dev Postgres — warn the user before the first run
  (memory `feedback_tests_wipe_dev_db`); tests not importing `app.main` must load `.env`
  (memory `feedback_test_dotenv`).
- Stage-ladder tests should use REAL fixtures from the win-back campaign's users (e.g.
  lisagee: 13 clip_created + 5 framing_opened + 0 framing_exported → `clipped`;
  drewsoccerati: 4 export_completed + 0 share_completed → `exported`; cschwartz:
  1 game_created only → `uploaded`) — these are the exact shapes prod produces.
- `framing_opened` deliberately does NOT advance the stage (opening ≠ finishing); only
  `framing_exported` moves `clipped → framed`. Same for `overlay_opened`.

## Implementation

### Steps
1. [ ] `resolve_stage` + ladder tests (each boundary, empty dict, unknown actions ignored)
2. [ ] `render_template` + unresolved-token failure tests
3. [ ] `select_template` + disabled/absent tests
4. [ ] `build_context` + missing-data `DripRenderError` test (mock profile DB)
5. [ ] Import check (`python -c "from app.main import app"`)

### Progress Log

## Acceptance Criteria

- [ ] Every stage boundary in EPIC §2 has a passing test, including the OR-condition for `clipped`
- [ ] Unresolved `{{var}}` raises, never sends through
- [ ] Disabled template → `None`, absent template → `None`
- [ ] `build_context` performs zero writes (assert no sync/write calls)
- [ ] Tests pass (relevant set)
