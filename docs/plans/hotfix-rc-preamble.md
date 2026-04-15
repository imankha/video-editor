# RC Hotfix Preamble — Changes Since Last Prod Deploy

**Last prod deploy:** `deploy/backend/2026-04-08-6` / `deploy/frontend/2026-04-08-5` (2026-04-08)
**Current RC:** `master` @ `90abefa`
**Scope:** 166 commits, ~89 non-test source files, +6,639 / -2,941 LOC (excluding docs/tests)

Use this document as the first context you load when chasing an RC regression. **Do not speculate about root causes outside the surface areas listed below** — every behavioral change on master since the last prod deploy falls into one of these buckets. Bisect within the bucket that matches the symptom.

---

## How to use this preamble

1. Match the regression symptom to a **Surface Area** below.
2. Read the commits/files listed for that surface area. `git show <sha>` and `git log -p <path>` are your primary tools.
3. If the symptom straddles buckets (e.g. "video won't load AND 401s"), start with the earliest-touched bucket.
4. Revert the narrowest commit that restores behavior. Prefer surgical reverts of the offending hunk over whole-task reverts — several tasks landed in layered commits (T1430 has 5+ commits, T1500 has 4).
5. Tag the fix commit so the next deploy tag supersedes it cleanly.

**Rule of thumb:** if a bug reproduces on the last prod deploy too, it's not an RC regression — stop and redirect.

---

## Surface Areas (ranked by regression risk)

### 1. Video load path (HIGHEST RISK — most churn, most subtle)
**Why risky:** 6 layered tasks (T1400, T1410, T1420, T1430, T1440, T1460, T1490, T1500) reshaped the cold/warm load routing, range-request behavior, cache warmer, watchdog, and metadata probe. Regressions here look like: first video fails to load, 401 on /stream, over-buffering, CORS console spam, stuck "loading" spinner, format-error overlay.

**Files:**
- [src/frontend/src/hooks/useVideo.js](src/frontend/src/hooks/useVideo.js) — +311 LOC; route decision moved in (T1460 `3a16ecb`), watchdog added
- [src/frontend/src/utils/cacheWarming.js](src/frontend/src/utils/cacheWarming.js) — +441 LOC; no-cors switch (T1350), same-origin credentials (T1490 `5ab4726`), origin-branched fetch (T1490 `df103d1`), head-prewarm (T1480)
- [src/frontend/src/utils/videoLoadRoute.js](src/frontend/src/utils/videoLoadRoute.js) — NEW
- [src/frontend/src/utils/videoLoadWatchdog.js](src/frontend/src/utils/videoLoadWatchdog.js) — NEW
- [src/frontend/src/utils/probeVideoUrl.js](src/frontend/src/utils/probeVideoUrl.js) — NEW
- [src/frontend/src/utils/videoErrorClassifier.js](src/frontend/src/utils/videoErrorClassifier.js) — NEW
- [src/frontend/src/utils/videoMetadata.js](src/frontend/src/utils/videoMetadata.js) — probe removed (T1500 `4ad5d13`, `fb9636e`)
- [src/backend/app/routers/clips.py](src/backend/app/routers/clips.py) — +294 LOC; two-window proxy for cold-path (T1430 `9238e17`, `ef295c0`), moov-tail window (T1440 `18c6abd`)
- [src/backend/app/routers/storage.py](src/backend/app/routers/storage.py) — warmup JOINs to game_videos/working_videos (T1222, `9447617`)

**Key commits to bisect first:** `4ad5d13` (T1500 probe removal), `3a16ecb` (T1460 route move), `9238e17` (T1430 two-window proxy), `d5a2d51` (T1350 no-cors).

### 2. Auth / login / session (HIGH RISK — user-visible, hard to reproduce)
**Why risky:** Guest accounts ripped out (T1330), cookie path/SameSite changed (T1270), auth DB restore now mandatory (T1290), GIS centralized (T1340), auth router shrank by ~740 LOC. Symptoms: login loop, 401 on /api/auth/me, One Tap errors, session not persisting, OTP form bugs.

**Files:**
- [src/backend/app/routers/auth.py](src/backend/app/routers/auth.py) — −741 LOC (huge simplification)
- [src/backend/app/services/auth_db.py](src/backend/app/services/auth_db.py) — +364 LOC; mandatory restore with retries
- [src/frontend/src/stores/authStore.js](src/frontend/src/stores/authStore.js) — +76 LOC
- [src/frontend/src/components/AuthGateModal.jsx](src/frontend/src/components/AuthGateModal.jsx) — −314 LOC (gutted)
- [src/frontend/src/components/auth/OtpAuthForm.jsx](src/frontend/src/components/auth/OtpAuthForm.jsx) — NEW
- [src/frontend/src/components/GoogleOneTap.jsx](src/frontend/src/components/GoogleOneTap.jsx) — StrictMode dedup (`bb1ce07`)
- [src/frontend/src/utils/googleAuth.js](src/frontend/src/utils/googleAuth.js) — NEW
- [src/frontend/src/utils/sessionInit.js](src/frontend/src/utils/sessionInit.js) — +122 LOC

**Key commits:** `96e0298`+`10473e8` (guest removal backend/frontend), `612f037` (cookie path/SameSite), `38c3b2e` (mandatory auth DB restore), `458ac3f` (401 degradation).

### 3. Admin impersonation (NEW FEATURE)
**Why risky:** Brand-new session-swap code path in auth router + admin router. Regressions isolated to admin users but could corrupt session state.

**Files:** [src/backend/app/routers/admin.py](src/backend/app/routers/admin.py) (+101), [src/frontend/src/components/admin/UserTable.jsx](src/frontend/src/components/admin/UserTable.jsx), [src/frontend/src/components/ImpersonationBanner.jsx](src/frontend/src/components/ImpersonationBanner.jsx) (NEW).
**Commits:** `5701172`, `06f7dd9`, `90abefa`.

### 4. Upload / faststart
**Why risky:** Client-side MP4 moov faststart is new and runs on every upload. Upload manager rewritten (+232/−? on uploadManager.js). R2 Content-Type migration (T1470).

**Files:**
- [src/frontend/src/utils/mp4Faststart.js](src/frontend/src/utils/mp4Faststart.js) — NEW, +329 LOC
- [src/frontend/src/services/uploadManager.js](src/frontend/src/services/uploadManager.js) — heavy rewrite
- [scripts/apply-faststart.js](scripts/apply-faststart.js), [scripts/migrate_games_faststart.py](scripts/migrate_games_faststart.py), [scripts/migrate_r2_content_type.py](scripts/migrate_r2_content_type.py) — migration scripts

**Key commits:** `2c79bf7` (T1380 faststart), `3c7fb4f` (T1470 content-type), `e37b734` (T1180 reject null video).

### 5. Modal / export pipeline
**Why risky:** `video_processing.py` shrunk by **1256 LOC** (T1220 scratch-extract pattern, T1221 dead code removal). Framing + multi_clip export touched for game_hash JOIN bugs (`18d3e51`, `f555936`).

**Files:**
- [src/backend/app/modal_functions/video_processing.py](src/backend/app/modal_functions/video_processing.py) — massive shrink
- [src/backend/app/services/modal_client.py](src/backend/app/services/modal_client.py) — −301 LOC
- [src/backend/app/routers/export/framing.py](src/backend/app/routers/export/framing.py), [src/backend/app/routers/export/multi_clip.py](src/backend/app/routers/export/multi_clip.py)

**Key commits:** `3c75115` (T1220 scratch-extract), `f5515f2` (T1220 r2 client restore hotfix), `87388b3` (T1221 dead code), `18d3e51` (single-video hash join fix), `ed77e2d` (T1222 join).

### 6. DB sync / startup recovery
**Why risky:** Sync retry fix (T1150), persistent sync-failed state (T1152), lazy per-user startup recovery (T1380+T1390 backend), DB bloat pruning + VACUUM gating (T1160/T1170).

**Files:** [src/backend/app/middleware/db_sync.py](src/backend/app/middleware/db_sync.py), [src/backend/app/session_init.py](src/backend/app/session_init.py), [src/backend/app/main.py](src/backend/app/main.py), [src/backend/app/database.py](src/backend/app/database.py).
**Key commits:** `5d11cb2` (T1150 retry no-op), `99b33bc` (T1152 persist failed), `4b2714e` (T1380 lazy recovery), `d99a5ba` (T1160/T1170 prune+vacuum).

### 7. UI rename: Projects → Reels (LOW RISK but broad surface)
User-facing copy change only, but touched ~many files. Symptoms: stale "Projects" text, broken aria-labels, test ID mismatches.
**Key commit:** `bd769f1`.

### 8. Games / quests / storage routing (small)
- [src/backend/app/routers/games.py](src/backend/app/routers/games.py) — null video_filename rejection (T1180)
- [src/backend/app/routers/quests.py](src/backend/app/routers/quests.py) — pre-login empty shape (`7fe10da`)

---

## Hotfix-prompt preamble (copy/paste to the AI doing the fix)

> You are fixing a regression on RC `master` vs last prod deploy `deploy/backend/2026-04-08-6`.
>
> **Do not speculate about root causes.** All behavioral changes between prod and RC are enumerated in [docs/plans/hotfix-rc-preamble.md](docs/plans/hotfix-rc-preamble.md). Read it first.
>
> Workflow:
> 1. Restate the symptom in one sentence.
> 2. Match it to a Surface Area (1–8) in the preamble. If it matches none, stop and confirm with the user that this is actually an RC regression (reproduce on the prod deploy tag first: `git checkout deploy/backend/2026-04-08-6`).
> 3. Within the matched bucket, name the 1–3 commits most likely to be responsible based on the symptom. Justify each in one line.
> 4. Use `git show <sha>` on each; do not read unrelated files.
> 5. Propose the narrowest revert or patch. Prefer reverting a single hunk over reverting an entire task.
> 6. Confirm with the user before committing. Do NOT merge or deploy.
>
> Constraints:
> - No new features. No refactors. No "while I'm here" cleanup.
> - Obey [CLAUDE.md](CLAUDE.md) rules — especially the no-reactive-persistence rule and no-defensive-fallback rule. A hotfix that adds defensive code to mask a bug is rejected.
> - If the fix requires a schema or R2 migration, stop and flag it — hotfixes must be code-only.
> - Write a failing test that reproduces the regression before patching, if the code path is testable.
