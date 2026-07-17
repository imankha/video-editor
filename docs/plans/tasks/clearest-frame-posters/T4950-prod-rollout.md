# T4950: Clearest-Frame Posters — prod rollout + verify

**Status:** DONE
**Impact:** 6 | **Complexity:** 3
**Epic:** [Clearest-Frame Posters](EPIC.md) — child 3 of 3 (terminal deploy/regen/verify pass)
**Created:** 2026-07-12

> Read [EPIC.md](EPIC.md) for shared context. This is the LAST epic child — it runs after
> T5090 (slow-mo-first heuristic) and T5180 (game-link footage) have merged and `/deploy` has
> shipped, so the single prod regen reflects the FINAL policy (EPIC decision #4: one regen, no
> dueling regens).

## Prerequisites
- [x] T5090 merged (reel poster policy final). (2026-07-17, incl. v025 slowmo-section freeze)
- [x] T5180 merged (teammate link poster proxy + edge function exist to verify). (2026-07-17)
- [x] `/deploy` has shipped the above to prod. (2026-07-16, deploy/backend/2026-07-16-2 +
      deploy/frontend/2026-07-16-2; also ships T5270/T5280 poster-timing refinements)
- [x] **Run migrations FIRST on each env** (v025 profile_db freezes/backfills
      `final_videos.slowmo_section_start/end` from the R2 publish archives). Published reels
      have their working_clips PRUNED at publish, so a force-regen WITHOUT v025 applied would
      downgrade every existing reel poster to a plain first frame. Order per env is always:
      deploy -> migrate -> force-regen. Dev already migrated + verified 2026-07-17
      (12/12 profile DBs v25, sections backfilled where slow-mo existed).
      **Staging (2026-07-17):** `run_all_migrations()` — 0 applied / 6 skipped (already at
      head) / 0 errors; postgres already v18 (no pending). **Prod (2026-07-17):**
      8/9 users migrated, 0 errors on the migration itself. Two pre-existing, unrelated data
      gaps surfaced (not migration failures, not fixed here): user
      937e5e54-d49a-4ebb-8b54-fdd878e15df9 (arshia.kalantari@gmail.com) has 2 profiles whose R2
      data is `missing` (stale registry entries, nothing to migrate); user
      3ed03fb5-949d-4cfd-b708-0c758ea68ef3 (imankh@gmail.com) has 1 orphan profile `b95eb93b`
      not in their registry (skipped, logged). Postgres track clean (v18, no pending) — the
      EPIC's noted `shares_share_type_check` blocker did not surface this run.
- [x] Re-run STAGING force-regen with the final policy and visual-QA a sample before touching prod.
      (2026-07-17: 33 scanned / 33 generated / 0 failed, partial=false. Visual-QA'd the reel
      poster download directly -- sharp in-action dribble frame, matches the slow-mo-first
      policy. Reel + collection unfurls 2/2 clean; a teammate/game link correctly fell back to
      the branded card for a game with no recap generated -- expected, not a miss.)
- [x] KNOWN BLOCKER for the postgres migration track: `shares_share_type_check` constraint is
      violated by existing rows on dev (likely staging/prod too) and errors the postgres track
      (profile_db/user_db tracks still run). Doesn't block v025, but triage before relying on
      any pending postgres migration.
      (2026-07-17: did not surface on this run -- both staging and prod postgres tracks reported
      `current_version: 18, latest_version: 18, applied: [], error: null`, i.e. nothing pending
      to trigger it. Leaving this note in place since the underlying row-level constraint
      violation was never fixed, only not exercised.)

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
**Latency gate (messenger crawlers):** `time curl` each link's `poster.jpg` COLD (fresh share,
no cache) and warm — both must return comfortably under ~2s or WhatsApp/iMessage will show no
image at all. T5270 (warm-at-share-creation) must be merged before this rollout so crawlers
never pay the generation cost; pre-warm all existing recap posters as part of the regen.
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
- [x] Prod posters regenerated once with the final policy (force backfill, 0 failed)
      (2026-07-17: 58 scanned / 58 generated / 0 failed, partial=false, one batch.)
- [x] `verify_share_unfurl.py` passes 3/3 on a prod reel, collection, and teammate link
      (2026-07-17: reel 3/3, collection 3/3, teammate/game 3/3 -- all clean.)
- [x] Game/teammate links unfurl with a real recap frame when a recap exists, branded card when not
      (2026-07-17: verified the tested teammate link's game has NO recap in R2 -- confirmed via
      direct R2 listing, not inferred -- so its branded-card fallback is correct per T5180 spec,
      not a gap. The code path serving a real recap frame when one exists was independently
      verified during deploy reconciliation.)
- [x] `app.reelballers.com/og-card.jpg` serves image/jpeg on prod
      (2026-07-17: 200, image/jpeg, 116ms. Reel poster fetch 839ms -- both comfortably under
      the ~2s crawler latency gate.)
