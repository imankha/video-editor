# T5745: Import merge must be layer-aware (My Athlete clips must survive a claim)

**Status:** WIP
**Impact:** 8
**Complexity:** 2
**Created:** 2026-08-02
**Updated:** 2026-08-02

Follow-up bug fix on the [Share the Game epic](EPIC.md). Behavior-only; no schema change, no
migration. See [EPIC.md](EPIC.md) for the epic's layer model and provenance invariants (not
duplicated here).

## Problem

`_materialize_clips` (`app/services/materialization.py`) merged an incoming clip with ANY existing
clip whose time range intersects, **regardless of layer**, and its UPDATE hardcoded
`my_athlete = 0`. The merge logic predates this epic (it came from teammate shares), but the epic
makes it constantly reachable: every claim imports Team clips into an account whose owner tags their
own athlete on the same plays. Same play = same timespan = guaranteed intersection.

Observed (empirically reproduced):

```
BEFORE (recipient's own clip):  'My kid scores'  10.0-20.0  my_athlete=1
INCOMING (team clip):                            15.0-25.0
AFTER (buggy):                  'My kid scores'  10.0-25.0  my_athlete=0
```

Three failures in one:
1. The recipient's **My Athlete clip is converted to Team** (`my_athlete` 1 -> 0). It then drops out
   of reels / rankings / collections, which are `my_athlete = 1` only
   (`exclude_teammate_reels_clause`). Silent data loss of the user's own curation.
2. Its **bounds are stretched** to the union (end 20.0 -> 25.0), corrupting a deliberately trimmed
   clip.
3. The **incoming Team clip is never inserted** — swallowed by the merge, so the recipient also loses
   the distinct team clip.

Root cause: `_get_existing_clips` did not even SELECT `my_athlete`, so the merge loop was layer-blind
by construction, and the UPDATE then forced `my_athlete = 0` onto a row that may be the recipient's
own athlete clip.

## Solution

Make overlap merging **layer-aware**:

1. `_get_existing_clips` now SELECTs `my_athlete` so the loop can see the layer.
2. New `_is_team_layer(clip)` helper: `clip.get("my_athlete") == 0`. Layer semantics —
   `my_athlete` NULL/1 = My Athlete, `0` = Team. NULL is treated as My Athlete via an explicit
   `== 0` test, never a truthiness check on a possibly-NULL value.
3. An incoming (Team) clip merges with an existing clip **only when that existing clip is also Team
   layer** (`_is_team_layer(ex) and clips_overlap(ex, clip)`).
4. A cross-layer intersection falls through to the normal no-overlap path — a **plain insert** — so
   the My Athlete clip and the Team clip coexist.
5. The UPDATE **no longer touches `my_athlete`** — a merge of two Team rows leaves it 0 anyway, and a
   merge must never change a row's layer.

## What must NOT regress (verified)

- **Same-layer merge still merges** (Team-vs-Team dedupe) — keeps re-claims idempotent, prevents
  duplicate reels. `tagged_teammates` union behavior unchanged.
- **T5330 invariant:** every copied game and newly inserted clip still carries a NON-NULL `shared_by`.
- Newly inserted imported clips still land `my_athlete = 0`; only the UPDATE-of-an-existing-row path
  stopped touching `my_athlete`.
- Teammate-share materialization (the older flow through the same function) still works.

## Tests

`tests/test_t5745_layer_aware_merge.py` (mirrors `test_materialization.py` fixtures): headline
survival case, NULL-is-My-Athlete variant, same-layer-still-merges (+ teammate union),
non-intersecting on either layer, exact-boundary touch (strict `<`), and a full `materialize_game_share`
claim where the recipient's intersecting My Athlete clip survives with layer + bounds intact.

Three pre-existing `test_materialization.py` merge tests were setting up their existing clip on the
My Athlete layer (the old helper default) while expecting a merge; updated to Team-layer existing
clips so they exercise the same-layer merge path they were written to test.

## QA

Targeted, foreground, redirected:

```
cd src/backend && python -m pytest \
  tests/test_t5745_layer_aware_merge.py tests/test_materialization.py \
  tests/test_t5730_claim_import_flow.py tests/test_t5740_share_scope.py \
  tests/test_auto_materialize.py tests/test_shared_game_extension.py \
  tests/test_move_reels_stale_target.py tests/test_t4315_restore_on_staleness.py \
  --tb=short --capture=sys -q
```

Postgres-fixture (`pg_conn`) setup errors are environmental (dirty test DB row vs the
`shares_share_type_check` constraint in migration `v016_collection_shares`) and unrelated to this
behavior-only SQLite change.
