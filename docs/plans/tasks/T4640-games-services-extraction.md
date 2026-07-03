# T4640: games.py Service Extraction — Activation + Single Share Flow

**Status:** TODO
**Impact:** 6
**Complexity:** 6
**Created:** 2026-07-03
**Source:** Audit item E9 ([audit doc](../audit-2026-07-03-code-quality.md)) · Depends on T4360 (activation invariant tests exist FIRST)

## Problem

[DRY][DEP] Two clusters in `games.py`:

1. **`activate_game` (:568-758, ~185 LOC in the handler)** hand-orchestrates 3 datastores inline: R2 HEAD validation (:606-611), ffprobe-over-R2 (:627), dynamic backfill UPDATEs (:632-685), working_clips.fps correlated-subquery backfill (:690-702), a deliberate **mid-handler commit to release the SQLite writer lock** (:721), storage-ref writes (:726-731), credit deduction (:736), second commit (:747-751) — with bug26p comments (:543-549, :717-725) as the only guardrails. `create_game` (:278-459, ~170 LOC, 3 connections) is similar.
2. **Share flow copy-pasted:** `share` (:1809-1950) vs `share_playback` (:1957-2142) share ~130 lines — lookup, expiry gate, share-record loop, email fan-out, revoke-on-fail with `except Exception: pass` (:1896-1898 / :2086-2088), materialize-or-pending tree. A share bug gets fixed in one and survives in the other.

## Solution

1. **`services/game_activation.py`**: `activate_game(user_id, game_id, ...)` — the handler becomes parse → call → respond. The bug26p ordering comments become **structure**: named steps with the invariants from T4360's tests enforced between them. The mid-handler commit's lock rationale is preserved as an explicit two-phase design with a docstring saying WHY.
2. **`services/game_sharing.py`**: one `share_game_flow(share_type: ShareType, ...)` where annotation-playback vs video-share differences are parameters/strategy branches, not files. The `except Exception: pass` revoke paths become logged, narrow error handling (T4280's rule).
3. Behavior-preserving throughout — T4360's invariant tests + existing games tests are the oracle.

## Steps

1. [ ] Confirm T4360's activation invariant tests are green on master (they're this task's safety net; if absent, do T4360 first).
2. [ ] Extract activation as pure code motion (one commit), then a second commit restructuring into named steps — motion and shape-change never mixed.
3. [ ] Side-by-side diff of share vs share_playback (table: line-range → same/different → parameter); extract `share_game_flow`; migrate both routes.
4. [ ] Backend tests + manual: activate a game on dev (credit deduction, storage refs) + both share types end-to-end (T3970's expiry gate still enforced).

## Acceptance Criteria

- [ ] games.py handlers for activate/create/share are < ~30 lines each (parse/call/respond)
- [ ] One share implementation; the except-pass sites eliminated
- [ ] bug26p invariants hold (T4360 tests green throughout)
- [ ] Both share types + activation manually verified on dev
