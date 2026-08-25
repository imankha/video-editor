# T7480: Prod game uploads failing since Aug 20: investigate + upload lifecycle observability

**Status:** WAITING ON USER
**Priority:** P1 (active prod outage)
**Impact:** 9
**Complexity:** 5
**Created:** 2026-08-24
**Updated:** 2026-08-24
**Epic:** [Upload Failure Integrity](EPIC.md)

## Problem

Zero game videos have landed in prod R2 since 2026-08-20 22:49 UTC. Across the two accounts
investigated on 2026-08-24 there were 5 upload attempts and 0 successes. Sample size is
small (2 users), so "broken for everyone" is not yet established, but a path that worked on
Aug 20 producing zero successes over 4 days warrants treating this as an active outage until
a live test proves otherwise.

The transfer failure itself could NOT be root-caused read-only. Ruled out with evidence
during the investigation:

- **R2 CORS**: live OPTIONS preflight from `Origin: https://app.reelballers.com` returned
  204 with `Access-Control-Allow-Methods: GET, HEAD, PUT` and ETag exposed
- **Insufficient credits**: cost for the 17.8 MB file is 2 credits; balances were 8 and 88;
  and `can_afford` runs after the pending_uploads INSERT, which would have left rows behind
- **Backend regression**: prod last deployed 2026-08-19 15:37 UTC; the Aug 20 22:49 success
  ran on that same image
- **Frontend regression**: uploadManager.js / mp4Faststart.js / uploadStore.js unchanged
  since 2026-07-04
- **Machine restart**: single prod machine `843e15c2d26718`, uptime unbroken since deploy
- **R2 outage**: profile.sqlite syncs succeeded at the exact timestamps the uploads failed

Known concrete failure shape (rooom1h): a 17.8 MB file is a SINGLE part (`PART_SIZE = 25 MB`),
so the whole transfer is one browser -> R2 presigned PUT with `PART_UPLOAD_TIMEOUT_MS =
180_000` and 2 retries. R2 shows the multipart still open with 0 parts uploaded.

**Unresolved anomaly worth chasing**: R2's ListMultipartUploads reports a DIFFERENT UploadId
for that same key than the one stored in `pending_uploads`, both initiated the same second.
Two multiparts were created for one prepare. This may be a real clue (double prepare call?
retry at the prepare layer?) or a red herring; establish which.

**The deeper structural problem this task must also fix**: the server has NO visibility into
the browser -> R2 leg. The client logs rich diagnostics (`[DIAG upload-freeze] uploadParts`,
`[ensureVideoInR2] prepare-upload FAILED`, `[ensureVideoInR2] finalize-upload FAILED`) but
they die in the user's console. An abandoned upload session is invisible server-side until
someone happens to impersonate the account.

## ROOT CAUSE CONFIRMED (2026-08-24 live reproduction on staging)

Reproduced end to end with a real browser driving the real Add Game UI (staging build
9417289f, same master code, same physical R2 bucket for the env-free `games/` prefix):

- **Unthrottled (~3MB/s): 17.17MB upload SUCCEEDS end to end** (prepare 645ms, single
  PUT 5.2s, finalize 1.3s, activate 9.4s). The pipeline itself is healthy: CORS, presign,
  finalize all fine. Prepare fired ONCE.
- **CDP-throttled to 0.5Mbps (phone-grade uplink): guaranteed-fatal loop, matching the
  real failures exactly.** PUT attempt 1 reached ~66% transferred, then the flat
  `PART_UPLOAD_TIMEOUT_MS = 180_000` XHR timeout killed it (ERR_ABORTED at exactly
  180.5s). The retry RESTARTS THE WHOLE FILE FROM BYTE 0 on the same slow link, so every
  attempt dies the same way: 4 x 180s + backoffs = 12.1 minutes of "Uploading..." then
  terminal failure. R2 completed zero parts. Aftermath identical to rooom1h: orphaned
  pending_uploads row, multipart open with 0 parts, and the T7470 cleanup DELETEd the
  game row. **Zero server-visible traffic from the entire failure.**

**The math (measured, not estimated): a 17.8MB single part inside 180s requires >=
0.79Mbps sustained uplink. Residential/cell uplinks commonly sit at 0.3-0.7Mbps. Retry
count is irrelevant because each attempt restarts from zero with the same budget.** This
fully explains bigajosue (4 attempts, mobile-shot video, failures in 11-18s were likely
the faster pre-transfer failures of his first file; the pattern class holds), rooom1h
(WhatsApp video, 0 parts), and why desktop-on-good-wifi users (cschwartz, jordark,
eticatch, multi-GB files at 25MB parts) succeeded: per-25MB-part at >=1.1Mbps clears
180s.

Secondary findings from the repro:
- **The double-UploadId is NOT client-side**: prepare fired once in both runs, prod has
  no StrictMode, and the resume path returns the SAME UploadId while valid
  (games_upload.py:159-195). Remaining suspect: boto3's internal retry on a timed-out
  CreateMultipartUpload (R2 executed the first, the retry created a second, only the
  second stored). Server-side hygiene fix below; not the transfer-failure cause.
- **All client DIAG logging is DEAD in prod builds**: vite.config.js:101 marks
  console.log as pure, so uploadManager's diagnostics are stripped at build time. Only
  console.warn/error survive. The beacon is the ONLY possible evidence channel.
- Progress % shows bytes BUFFERED, not delivered (kept advancing while offline): users
  see healthy progress right up to the reset loop.
- Prod dev-login is a hard 404 by design (auth.py:998-1006); staging requires the
  X-Test-Mode header.

## Solution (updated: cause known, fix + observability)

The fix, in priority order (each grounded in the capture):

1. **PART_SIZE 25MB -> ~5MB.** A 5MB part needs only 0.22Mbps to beat 180s; each
   completed part is durable progress (the parts-PATCH resume state already exists and
   works); a timeout loses one part, not the file.
2. **Progress-aware timeout, not flat**: abort only after N seconds with ZERO
   upload.onprogress delta (or scale timeout with part size). Today the timeout kills
   healthy 66%-done transfers.
3. **Adaptive retry**: with small parts the existing retry becomes sound; consider
   halving part size on a timeout retry.
4. **UploadId hygiene (server)**: before r2_create_multipart_upload, abort open orphan
   multiparts for the key (or make create idempotent per hash); log the UploadId
   returned. Kills the double-UploadId ambiguity permanently.
5. **Failure beacon (mandatory, proven necessary)**: the terminal failure produced zero
   server-visible traffic, and console diagnostics do not exist in prod builds. POST
   failure reason + attempt/timing detail on retry exhaustion.
6. **Honest progress**: drive % from completed parts, not buffered bytes.
7. T7470 (do not delete the game) and T7490 (honest pending/reap) close the aftermath.

**Implementation constraints from the 2026-08-24 best-practices research (sourced:
AWS/Cloudflare/Mux/tus docs; details in the research report):**
- **R2 requires all non-final parts of one upload to be the SAME size** - adaptive
  per-part sizing mid-upload is off the table. Pick the part size ONCE per upload; 5MB
  flat is the right default (it is the R2/S3 hard minimum and what vendors steer
  weak-connection clients toward; a 4GB game = 800 parts, well under the 10k cap;
  accept the Class A op cost). Optional later: measure throughput first, pick larger
  parts for fast links, per upload not per part.
- **Stall watchdog is a named industry pattern** (GCS TransferStallTimeoutOption:
  abort only when no bytes flow for N seconds), replacing the flat per-request timeout.
- **iOS realities**: no background upload exists on iOS Safari (Background Fetch
  unsupported; screen lock suspends the page). Required: keep-tab-open + screen-unlock
  messaging while uploading, request the Screen Wake Lock API (Safari 16.4+), and a
  beforeunload guard while an upload is in flight. Also surface a distinct "Preparing
  video..." state: the iOS photo picker can transcode (HEVC->H.264) large videos for a
  long dead period before byte 1 flows, which reads as a hang (verify on device).
- **Known iOS 18 Safari bug**: uploads >1MB over CELLULAR time out while wifi works
  (Apple dev forums thread 764420) - check affected users' timing against this; it may
  compound the slow-uplink math for the mobile cohort.

### 1. Root-cause the active failures
- Live upload test against prod with a real browser + DevTools (drive-app-as-user skill /
  real account), watching the DIAG console lines and the network tab for the presigned PUT
- If reproduced: fix follows the evidence (timeout too tight for slow links? presign
  header/checksum mismatch? part-size edge? double-prepare racing itself?)
- If NOT reproduced: instrument (workstream 2) and monitor; the affected users' networks
  (mobile/WhatsApp-sourced video, possibly slow uplinks) may be the variable. A 17.8 MB
  single-part PUT with a 180s timeout implies a ~0.1 MB/s floor; consider whether the
  single-part path needs smaller parts or a longer/adaptive timeout for slow uplinks.
- Explain or dismiss the double-UploadId anomaly

### 2. Server-side upload lifecycle observability
- Log the lifecycle server-side so prepare -> finalize pairing is queryable: prepare logged
  (already exists as a row in pending_uploads), part-completion progress optional, finalize
  success/failure logged, and CRITICALLY an abandoned session (prepared, never finalized,
  older than N hours) is visible without a browser
- Client failure beacon: when the browser exhausts retries, POST the failure reason +
  part/attempt detail to a lightweight endpoint so the server log carries the same evidence
  the console does (fire-and-forget, must never block or break the failure path)
- Surface: an admin-queryable view (log-based is fine to start; an admin endpoint listing
  stuck pending_uploads with age + R2 multipart state is the natural shape)

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/services/uploadManager.js` - `PART_UPLOAD_TIMEOUT_MS` ~52, part upload +
  retry loop, `ensureVideoInR2` ~478-619, existing DIAG log lines
- `src/backend/app/routers/games_upload.py` - `PART_SIZE` ~50, `prepare_upload` ~100-258,
  `finalize_upload`, `list_pending_uploads` ~425-480
- `src/backend/app/storage.py` - presigned part URLs, `r2_is_multipart_upload_valid` ~2362
- `src/frontend/src/stores/uploadStore.js` - upload state (context)

### Related Tasks
- Epic siblings T7470 (stop the destructive cleanup), T7490 (pending visibility), T7500
- T7140 (faststart remux) touches finalize_upload: coordinate if concurrent
- T7360 (concurrent uploads store rework): same surface, sequence deliberately

### Technical Notes
- The failure beacon is a write triggered by a failure event inside an existing
  gesture-originated flow (the upload the user started); it writes to LOGS or analytics,
  never to the profile DB, so the gesture-persistence rules are not in play. Keep it that
  way: no new profile/user DB writes from this path.
- Log handling rules apply to the investigation itself: redirect any long-running capture
  to a file and reduce_log it.
- If the fix needs the affected users to retry, remember rooom1h's stored `r2_upload_id`
  already returns NoSuchUpload; resume is dead for that session (T7490 owns honest reaping).

## Implementation

### Steps
1. [ ] Live prod upload test (real browser, DevTools open); capture DIAG lines + network
2. [ ] Root-cause from the capture, or instrument-and-monitor if not reproduced
3. [ ] Server-side lifecycle logging + client failure beacon
4. [ ] Explain the double-UploadId anomaly
5. [ ] Fix whatever the evidence names; verify with a real prod upload

## Acceptance Criteria

- [ ] A prod game-video upload demonstrably succeeds end to end (real browser evidence)
- [ ] The transfer-failure root cause is named with evidence, or instrumentation is live and
      a monitoring window is agreed with the user
- [ ] An abandoned upload session is visible server-side (queryable, with age and state)
      without any browser console access
- [ ] Client failure beacon lands the browser-side failure reason in server logs
- [ ] Double-UploadId anomaly explained or ruled out as a factor

## Progress Log

### 2026-08-24 — Design note (short Architect-by-exception pass, no separate design doc)

The kickoff's 7-item fix list is the design; the shape is "translate the numbered list into
code" with a few judgment calls resolved below. No item surfaced a real tradeoff that needed a
BLOCKED gate — the one genuine correctness risk (5MB parts vs existing 25MB resume state) is
resolved by a bounded, self-contained guard, not a design fork.

**Fix 1 — `PART_SIZE` 25MB -> 5MB (`games_upload.py:50`).** 5 MiB is the R2/S3 hard minimum for
non-final parts. 10GB max / 5MB = 2048 parts (< 10k cap). A 5MB part needs only 0.22Mbps to beat
a 180s budget, and each completed part is durable via the existing parts-PATCH resume state.

**Resume-safety judgment call (the "interacts with existing resume state" worry).** R2 requires
all non-final parts of ONE upload to be the same size. A pending upload created pre-deploy used
25MB parts; resuming it under the new 5MB chunking would splice 25MB completed parts with 5MB
remaining parts and finalize a corrupt file — unacceptable on money-backed uploads. Guard: on the
resume path, list the multipart's actual R2 parts and verify every already-completed part matches
the CURRENT `PART_SIZE` (last part may be the file's short tail). On mismatch, abort the multipart
+ delete the stale pending row + fall through to a fresh create. Net effect at deploy: any old
25MB in-flight upload restarts cleanly at 5MB (it had 0 completed parts anyway per the repro), new
uploads resume normally. No schema change (part size is derived from live R2 state, not stored).

**Fix 2 — stall watchdog replaces the flat per-part timeout (`uploadManager.js`).** Drop
`xhr.timeout = PART_UPLOAD_TIMEOUT_MS`. Instead reset a JS timer on every `upload.onprogress`
delta; abort + reject (retryable) only after `PART_STALL_TIMEOUT_MS` (30s) of ZERO progress. This
is the GCS `TransferStallTimeoutOption` pattern: a healthy 66%-done transfer is never killed; a
dead socket fails fast into the existing retry. Keep an absolute-cap fallback so a pathological
"1 byte every 29s" can't hang forever.

**Fix 3 — adaptive retry:** with 5MB parts the existing MAX_RETRIES=3 loop is sound as-is
(timeouts/stalls already classified retryable). Not halving part size on retry — out of scope /
over-build per the kickoff.

**Fix 4 — UploadId hygiene (server).** Before `r2_create_multipart_upload` on the fresh-create
path, list + abort any open multiparts already sitting on the key (orphans). This is only reached
after resume was declined, so we never abort a live resumable session. Kills the leaked-multipart
accumulation permanently.

**Double-UploadId anomaly — EXPLAINED (refines the task file's leading hypothesis).** The task
file guessed "boto3's internal retry." Evidence says NO: the R2 boto3 client is built with
`Config(retries={"max_attempts": 0})` (`storage.py:250`), so boto3 does NOT retry internally. The
real source is the APPLICATION-level wrapper: `r2_create_multipart_upload` calls
`retry_r2_call(client.create_multipart_upload, **TIER_3)` (2 attempts) and `is_transient_error`
classifies `ReadTimeoutError` as retryable (`read_timeout=30`). So a CreateMultipartUpload that R2
actually executed but answered slower than 30s times out on read, `retry_r2_call` fires a second
create, R2 opens a SECOND multipart, and only the second UploadId is returned + stored — leaving
the first as the orphan ListMultipartUploads reported. Fix 4's abort-before-create reclaims these;
the stored UploadId is always the live one used for finalize.

**Fix 5 — failure beacon (`POST /api/games/upload-failure-beacon`).** Lightweight endpoint,
logs-only, never a DB write (Technical Notes confirm the gesture-persistence rule doesn't apply —
it writes to logs/analytics, not the profile/user DB). Accepts a permissive JSON body, never
throws on bad input (returns 204 regardless). Client fires it fire-and-forget with `keepalive` at
transfer-retry-exhaustion (and on prepare/finalize failure), wrapped so it can never block or
break the failure path. This is the ONLY server-visible evidence channel: prod strips
`console.log` at build (`vite.config.js:101`), so the client DIAG lines are dead in prod.

**Fix 6 — honest progress.** Reported percent is driven by COMPLETED parts (bytes counted only
when a part's PUT returns 2xx), not by `upload.onprogress` buffered bytes (which climbed while the
socket was dead). `onprogress` still feeds the stall watchdog; it just no longer inflates the bar.

**Fix 7 — server-side lifecycle observability.** (a) Structured `[UPLOAD_LIFECYCLE]` logs at
prepare (session/hash/size/parts/upload_id/user) and finalize (success + every failure branch) so
an abandoned session (prepare with no finalize) is grep-pairable without a browser; plus the Fix-5
beacon carries the client-side reason. (b) A read-only admin endpoint
`GET /api/admin/users/{user_id}/stuck-uploads?older_than_hours=N` iterates the user's profiles via
`open_profile_db_readonly` (mode=ro — no writes, no sync), returns each `pending_uploads` row with
age + live R2 multipart validity/part-count. Scoped to a named user (the incident accounts), not
an all-users sweep — log-based remains the baseline per the task file; this makes it directly
queryable for the affected accounts.

**Files:** `src/backend/app/routers/games_upload.py`, `src/backend/app/storage.py`,
`src/backend/app/routers/admin.py`, `src/frontend/src/services/uploadManager.js`. No schema
change, no migration. T7470/T7490/T7500 scope explicitly untouched.
