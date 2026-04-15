# RC Staging Test Scripts

**Target:** https://app-staging.reelballers.com (or your staging URL)
**Baseline:** prod at `deploy/backend/2026-04-08-6`
**Goal:** derisk that RC staging is no worse than prod. Each test maps to a surface area from [hotfix-rc-preamble.md](hotfix-rc-preamble.md).

**Ground rules for every test:**
- Open DevTools → Console + Network before starting. Keep them open.
- Do the flow on **desktop Chrome** first (primary browser). If time permits, repeat on Safari/mobile.
- If you see any red console error, any `401`/`403`/`5xx` on Network, or any stalled request >5s — pause, screenshot, note the step.
- After each test, clear the clip/reel you made so the next test starts clean.

---

## Script 0 — Pre-flight (2 min)

1. Log out fully. Clear cookies for the staging domain.
2. Hard reload. You should see the login screen, **not** a half-loaded app.
3. Console: no red errors before login. `/api/auth/me` returns 401 cleanly (not 500).
4. Network: no CORS-blocked requests. No repeated polling of any endpoint.
5. Open an incognito window and leave it — you'll use it for the multi-session test later.

**Fail condition:** app partially renders without auth, or console shows uncaught exceptions pre-login. → Bucket 2 (Auth).

---

## Script 1 — Smoke Test: End-to-end golden path (10 min)

Covers: auth, upload, annotate, framing, export, gallery. This is the single most important test.

1. **Login** with Google (One Tap or button). Confirm: no AbortError in console, banner/avatar appears, no login loop on refresh.
2. **Upload a game video** (use a ~30–60s MP4 you know works in prod). Watch Network:
   - Upload chunks complete with 200s.
   - Client-side faststart step runs (you may see a brief "processing" state — new in RC).
   - No freeze at 99%.
3. **Create a reel** from the uploaded game. The user-facing term should say **"Reel"** everywhere (not "Project"). Note any stale "Project" copy.
4. **Annotate**: seek, add 2 clips. Scrubbing should be responsive. No watchdog warnings in console beyond the first load.
5. **Framing**: open the reel, set crop keyframes on 2 clips, including one at start and one mid-clip. Save.
6. **Export** the reel. Watch backend requests — framing + multi_clip endpoints should 200.
7. **Gallery/Downloads**: download the exported file. Play it locally. Confirm crops applied correctly.
8. **Refresh** the page mid-workflow and reload the reel — state should persist exactly (clips, keyframes, crop positions).

**Expected zero:** 401s on `/stream`, CORS errors, `NaN` in crop overlay, format-error overlays, "Projects" text.

---

## Script 2 — Video Load Path (highest-risk bucket, 10 min)

Targets T1400/T1410/T1430/T1440/T1460/T1490/T1500 — the most layered changes.

1. **Cold load (first video request after login):**
   - Login fresh. Open a game. Network tab filter: `stream`.
   - First `/stream` request **must not 401**. (T1490 regression check.)
   - Response should be a 206 Partial Content with a bounded range — not the full file. (T1430 over-buffer check.)
2. **Warm load:**
   - Navigate away from the game and back. Second load should be noticeably faster, and you should see `cacheWarming` logs (if verbose). No CORS console errors. (T1350.)
3. **Multi-video game:**
   - If you have a game with 2+ source videos, open it in framing mode. The second video should load without "format error" overlay. (T1440.)
4. **Clip with no keyframes (fresh):**
   - In framing, select a clip you haven't set crops on. Crop overlay should render default. No `NaN` values in the overlay dims. (T1500 dim persistence check — if clip has no stored dimensions, watch for the loud warn log the code was changed to emit.)
5. **Stale blob recovery:**
   - Play a clip, then let it sit for ~2 min. Scrub again. Should keep playing, not drop to a format-error overlay. (T1360.)
6. **Watchdog:**
   - If any load takes >5s, the watchdog should log structured data — no silent hangs. (T1400.)

**Fail condition:** any of (first 401, format-error overlay, NaN crop, 10MB+ range when you asked for 5s, stuck spinner). → Bucket 1.

---

## Script 3 — Auth & Session (10 min)

Targets T1270/T1290/T1330/T1340. Guest accounts were ripped out; cookie behavior changed.

1. **Cookie inspection** (DevTools → Application → Cookies):
   - `rb_session` cookie has `Path=/` and `SameSite=Lax`. (T1270.)
2. **Refresh persistence:** logged in, F5, still logged in without a flicker to the login screen.
3. **Logout → login loop check:** logout; login again via Google. Should complete in one click, no repeated OAuth popup, no AbortError.
4. **OTP path** (if enabled in staging): attempt email+OTP login, confirm the new `OtpAuthForm` renders and submits.
5. **No guest fallback:** open a private window, go to the app URL — you should see the login screen, **not** an auto-created guest session. (T1330.)
6. **Two tabs:** open staging in 2 tabs logged in as same user. Actions in tab A should not log out tab B. Session should not ping-pong.
7. **Auth DB restore (harder to test from UI):** check staging backend logs for `auth_db_restore` entries on cold start — if you just triggered a Fly machine restart, the restore must succeed with retries, not skip. (T1290.)

**Fail condition:** any of (session drops on refresh, repeated OAuth popups, guest session appears, login loop). → Bucket 2.

---

## Script 4 — Admin Impersonation (5 min, admin account only)

Brand-new feature (T1510) — zero prod baseline.

1. Login as admin. Go to admin → user table.
2. Pick a non-admin test user. Click **Impersonate**.
3. **Impersonation banner** must appear at the **bottom** of the viewport (T1510 latest commit `90abefa`).
4. Confirm URL/app shows the impersonated user's reels — NOT the admin's.
5. **Stop impersonating** (button in banner). Confirm you return to admin's own session without a full re-login.
6. Backend: check the audit log table for an `impersonate_start` + `impersonate_end` entry with both user IDs. (Ask backend logs.)
7. **Edge:** try to impersonate yourself. Should be blocked.
8. **Edge:** refresh the page while impersonating — banner should persist and user context should stay on the impersonated user.

**Fail condition:** banner not shown, session doesn't swap, can't exit impersonation, missing audit row. → Bucket 3.

---

## Script 5 — Upload & Faststart (5 min)

Targets T1380 (client faststart) + T1470 (R2 content-type).

1. **Upload a large-ish MP4** (100MB+ if you have one). Confirm client-side faststart doesn't hang the browser tab. (T1380.)
2. **Upload a non-faststart MP4** (moov atom at end). Should still succeed and play back cleanly.
3. **After upload completes**, inspect the R2 object (via backend admin or `curl -I` on the stream URL): `Content-Type` must be `video/mp4`, **not** `application/octet-stream` or `binary/octet-stream`. (T1470.)
4. **Upload failure path:** kill network mid-upload (DevTools → offline), reconnect. Upload manager should retry/resume, not orphan a half-written object.
5. **Null video guard (T1180):** try to create a game without a video attached via the UI — should be rejected cleanly, no export crash later.

**Fail condition:** browser hangs during faststart, wrong content-type, corrupted playback. → Bucket 4.

---

## Script 6 — Export Pipeline (5 min)

Targets T1220 (Modal scratch-extract) + T1221 (dead code removal) + `18d3e51` single-video hash fix.

1. **Export a reel from a single-video game** (the common case, and the one `18d3e51` fixed). Must succeed end to end.
2. **Export a reel from a multi-video game** (if available). Multi-clip export should stitch correctly. (T1222.)
3. **Framing export with AI upscale/crop** (triggers Modal path — T1220). Confirm the job completes and the output is not truncated or missing audio.
4. **Watch Modal logs** (or backend logs) for any `ModuleNotFoundError`, missing-import, or "function not found" errors — T1221 removed dead functions and `f5515f2` was a hotfix restoring an r2 client.
5. **Export a reel with 3+ clips** with different crops. Confirm concat succeeds.

**Fail condition:** export 500s, output missing clips/audio, Modal function import errors. → Bucket 5.

---

## Script 7 — DB Sync & Restart Resilience (5 min)

Targets T1150/T1152/T1160/T1170/T1380+T1390 (lazy per-user recovery).

1. Make edits (add clips, set keyframes). Wait ~10s for sync. Check backend logs for `[SYNC_PARTIAL]` or sync-success entries — no `sync-failed` stuck states.
2. **Force a backend restart** (if staging has a safe way — e.g. trigger Fly machine restart). After restart:
   - Your edits are still there.
   - Auth still works without re-login.
   - Open a reel — startup recovery should lazy-init for your user without stalling other users. (T1380+T1390.)
3. **Large user check:** if you have a user with many games/reels, open their gallery. Should load without VACUUM timeouts. (T1160/T1170.)

**Fail condition:** edits lost after restart, startup hangs, sync stuck in failed state. → Bucket 6.

---

## Script 8 — UI Copy & Misc (3 min, quick visual sweep)

1. **Projects → Reels rename (T1390):** walk through Annotate, Framing, Gallery, navigation. Grep the UI for any leftover "Project" / "Projects" / "project" text. Report every instance.
2. **Quest panel pre-login:** logged-out view should show the quest panel with empty progress, not a 401-triggered error. (`7fe10da`.)
3. **Nested button warning (`8e8299e`):** open the game clip selector modal. Console should have no `validateDOMNesting` warnings.
4. **Sign-in button placement:** the new `SignInButton` should be visible and clickable pre-login.

---

## Prioritization if time-boxed

| Time | Run |
|------|-----|
| 15 min | Script 0 + Script 1 |
| 30 min | + Script 2 + Script 3 |
| 45 min | + Script 4 + Script 5 |
| 60 min | + Script 6 + Script 7 + Script 8 |

---

## If a test fails

1. Capture: screenshot + console + Network HAR + the step number + timestamp.
2. Copy to clipboard, then in Claude run `/logdump` for any log file.
3. Open a Claude session with [hotfix-rc-preamble.md](hotfix-rc-preamble.md) and the failure notes. The preamble's prompt tells Claude to match the symptom to a bucket before touching code.
4. **Do not** retry the failed flow more than twice — flakes mask real regressions. Note the repro rate.
