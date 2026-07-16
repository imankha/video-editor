# T4950: Clearest-Frame Posters — prod rollout + verify

**Status:** TODO
**Impact:** 6 | **Complexity:** 3
**Epic:** [Clearest-Frame Posters](EPIC.md) — child 3 of 3 (terminal deploy/regen/verify pass)
**Created:** 2026-07-12

> Read [EPIC.md](EPIC.md) for shared context. This is the LAST epic child — it runs after
> T5090 (slow-mo-first heuristic) and T5180 (game-link footage) have merged and `/deploy` has
> shipped, so the single prod regen reflects the FINAL policy (EPIC decision #4: one regen, no
> dueling regens).

## Prerequisites
- [ ] T5090 merged (reel poster policy final).
- [ ] T5180 merged (teammate link poster proxy + edge function exist to verify).
- [ ] `/deploy` has shipped the above to prod.
- [ ] Re-run STAGING force-regen with the final policy and visual-QA a sample before touching prod.

## Scope

### 1. Prod force-regen (the task trigger)
Run the force regeneration on prod (batched; repeat while `partial=true`):
```
fly ssh console -a reel-ballers-api -C 'python -c "from app.services.pg import init_pg_pool; init_pg_pool(); from app.services.poster import backfill_posters; import json; print(json.dumps(backfill_posters(200, False, True)))"'
```
(Admin endpoint alternative: `POST /api/admin/backfill-share-posters?limit=200&force=true`.)

### 2. Verify all surfaces
```
python scripts/verify_share_unfurl.py https://app.reelballers.com/shared/{token} --attempts 3
```
Run on a real prod **reel** link, a **collection** link, and a **teammate** link (3/3 each).
Also confirm the app-root og:image `app.reelballers.com/og-card.jpg` serves `image/jpeg` (goes
live with the deploy; staging + landing already verified).

### 3. Optional tuning
Only if prod/staging visual QA shows misses — see EPIC.md "Optional tuning" (center-crop
weighting / spotlight-motion bias; NO ML).

## Relevant files
- `src/backend/app/services/poster.py` — `backfill_posters` (shipped; run with force)
- `scripts/verify_share_unfurl.py` — crawler-sim verifier

## Classification hint
S/M-tier ops task: no new code in the common case (runs shipped `backfill_posters`), plus
cross-surface verification. Coordinate regen timing with any T4890 follow-ups.

## Acceptance criteria
- [ ] Prod posters regenerated once with the final policy (force backfill, 0 failed)
- [ ] `verify_share_unfurl.py` passes 3/3 on a prod reel, collection, and teammate link
- [ ] Game/teammate links unfurl with a real recap frame when a recap exists, branded card when not
- [ ] `app.reelballers.com/og-card.jpg` serves image/jpeg on prod
