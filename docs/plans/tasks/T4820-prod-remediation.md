# T4820 — Prod Remediation Checklist

Run **after** the T4820 branch is QA'd, approved, and merged to master. Order matters: the
v023 migration code must be **deployed** before it can run, and migrations do **not** auto-run
on deploy.

Prod backend app: `reel-ballers-api`. Prod Postgres app: `reel-ballers-db-prod`.
Prod profile_db head is currently **v021** (v022 is pending on prod) → this run applies
**v022 AND v023** in order to every user's profile DB.

---

## 0. Pre-flight (before deploy)

- [ ] Branch `feature/T4820-…` merged to master; CI green.
- [ ] Confirm the new migration file is `profile_db/v023_repair_sourceless_active_games.py`
      (strictly greater than v022; no collision).
- [ ] Re-confirm the baseline blast radius on prod is unchanged (read-only scan, section 4 below):
      expect **7 active-but-sourceless games / 3 users** (aee3e218 g1/3/4/6, f05d1b29 g1 ×2
      profiles, 1b842983 g5).

## 1. Deploy to prod

- [ ] `/deploy` (runs `scripts/deploy_production.sh`: backend `fly deploy` + frontend). This
      **ships the v023 code** but does not migrate.
- [ ] Health check passes; `app.reelballers.com` loads.
- [ ] `/deploy` auto-promotes T4820 to DONE only if its implementation shipped in the range —
      that's fine; the migration below is a separate step.

## 2. Run migrations on prod (profile_db: v022 + v023)

Preferred — admin endpoint (requires admin session):
- [ ] `POST https://api.reelballers.com/api/admin/migrate` with the admin `X-User-ID`/session.

SSH fallback (if the endpoint is unavailable):
- [ ] ```
      fly ssh console -a reel-ballers-api -C "python -c 'from app.migrations import run_all_migrations; from app.services.pg import init_pg_pool; init_pg_pool(); print(run_all_migrations())'"
      ```
- [ ] Output shows each user's profile DB advancing to **v023** (watch for the v023 repair
      log line: "repaired N sourceless game(s) for user=…"). `run_all_migrations` downloads
      each R2 DB, applies, bumps `PRAGMA user_version` + R2 `x-amz-meta-db-version`, re-uploads.
- [ ] No `tuple indices` / row-factory error (T4110 class). If it crashes mid-fleet, the
      migration is idempotent — fix + re-run; already-migrated users are skipped.

## 3. Restart + warm (clear cached state)

- [ ] Restart prod machines if the migrate path didn't (per "restart staging/prod after data
      changes" rule): `fly apps restart reel-ballers-api` (or the deploy script's warm step).
- [ ] Warm one request so the first real user doesn't eat cold start.

## 4. Verify (read-only) — the 7 games now compute 'expired'

Re-run the active-but-sourceless scan (this is the same scan used to find the bug). Open the
prod PG proxy first if resolving users needs it:

```
fly proxy 15433:5432 -a reel-ballers-db-prod   # background; only if the scan resolves user_ids via PG
```

Then, for confirmation without the scan, check the repaired timestamps directly:

- [ ] ```
      cd src/backend && .venv/Scripts/python.exe ../../scripts/edit-user-db.py sarkarati@gmail.com \
        --env prod --db profile \
        --sql "SELECT g.id, gs.storage_expires_at FROM games g LEFT JOIN game_storage gs ON gs.blake3_hash=g.blake3_hash WHERE g.id IN (1,3,4,6)"
      ```
      Expect: games 1/3/4/6 `storage_expires_at` now in the **past** (was `2026-07-29T05:11:08`).
- [ ] Same check for f05d1b29 (game 1, both profiles) and 1b842983 (game 5 — a game_storage
      row now EXISTS with a past expiry where there was none).
- [ ] Full re-scan reports **0** active-but-sourceless games across all users (controls —
      sarkarati g5/g7 — stay `'active'`).

## 5. User-facing confirmation

- [ ] Ask sarkarati (bug 29p reporter) to **hard-refresh** (their build was the stale June-25
      `72ef4e8c`; they need the live build) and open game 4 "Beach FC Partida 2" in Annotate →
      should now show the yellow **"Source video expired"** panel with clips still listed, not a
      hanging/blank player.
- [ ] Bugs 27p + 29p: move to `testing` (user gesture), then `done` once sarkarati confirms.

## Notes / risks

- The sources are genuinely gone (grace-deleted) — the fix makes the games **degrade
  gracefully** (expired panel), it does not restore playback. Re-materialization from a
  surviving recap is out of scope (see T4140).
- v023 does an R2 `head_object` per game across all users' DBs during migration — bounded
  (10 users / 16 profiles on prod today), one-time.
- Part 2 (sweep-writes-truth + heal guard) prevents recurrence; no data step needed for it
  beyond the deploy.
