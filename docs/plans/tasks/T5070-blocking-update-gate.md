# T5070: Blocking update gate + guaranteed cache flush + state sync flow

> Split 2026-07-13: JIT migration moved to its own task [T5080](T5080-jit-migration.md), designed against the sync/flush/resync paths this task builds. This task = modal gate + cache flush + frontend state sync.
>
> (Renumbered from T4950 -> T5070 on 2026-07-13: a concurrent session had already claimed T4950-T5060.)

**Status:** TODO
**Impact:** 8
**Complexity:** 7
**Created:** 2026-07-13
**Updated:** 2026-07-13

## Problem

User direction (2026-07-13), three coupled parts around how users move onto a new deploy:

1. **Make the update prompt a blocking modal.** Today a new build surfaces a dismissible toast ("New version available / Refresh") that users can ignore and keep working ([pwaUpdate.js:41-54](../../src/frontend/src/utils/pwaUpdate.js#L41)). The user wants it to be a **modal that blocks login and all interaction** until the user refreshes onto the latest version.

2. **Guarantee the refresh actually flushes every client cache, on every platform.** Confirm and make robust that after this refresh, no stale assets survive on **PWA (installed), iOS Safari/standalone, macOS, Windows, Android**, and that the mechanism *reliably guarantees* users always end up on the latest version. This is a correctness/audit deliverable, not just a code change.

3. **Design the move from bulk migrations to just-in-time (JIT) migrations.** Today versioned DB migrations run as an admin-triggered sweep over **every** user (`run_all_migrations`, [migrations/__init__.py:30-66](../../src/backend/app/migrations/__init__.py#L30)). The user wants to move to JIT migration — a user's DB is migrated as part of *this* update/refresh flow (i.e., when they come online on the new version). The JIT effort must be **fully designed and documented** in this task (implementation may be a scheduled follow-up, but the design is a deliverable here).

These are coupled: the refresh flow is the moment a user lands on new frontend + new backend, which is exactly the natural trigger point for JIT-migrating that user's DBs. Designing them together avoids a second stale-version race (new client, un-migrated DB).

4. **Sync frontend state up before the flush, migrate, then resync down** (user, 2026-07-13). The ordered flow: on the update gesture, the client **flushes its current durable state to the backend**, THEN caches are flushed, THEN JIT migrations run on that user's now-current data, THEN the fresh client **resyncs** the migrated state back down. This makes the destructive flush safe (nothing in-memory is lost) and guarantees the new frontend reads state the migration has already upgraded. See "Update flow (ordered)" below — and the persistence-rule reconciliation it requires.

## Current State (investigation, 2026-07-13)

### Update mechanism (frontend only, today)
- `vite-plugin-pwa` with `registerType: 'prompt'` ([vite.config.js:17-51](../../src/frontend/vite.config.js#L17)). A new build produces a new service worker that **waits**; `pwaUpdate.js` shows a non-blocking toast; clicking Refresh calls `updateSW(true)` (skipWaiting + reload). Re-check rides `visibilitychange` with a 5-min gap (T4150).
- Workbox precaches `**/*.{js,css,html,svg,png,woff2}`; `navigateFallback: index.html`; one runtimeCache (Google avatars, CacheFirst). `cleanupOutdatedCaches` is NOT explicitly set (Workbox default is on — **verify**).
- **Gap — backend deploys trigger nothing.** The prompt fires only on a new *service worker* (frontend asset change). A backend-only deploy produces no new SW, so a stale frontend keeps talking to a new backend with **no update prompt**. There is **no app-version handshake** (no `X-App-Version` header, no `/version` endpoint; `__COMMIT_HASH__` is baked into the bundle and only used for bug-report metadata — [main.jsx:18](../../src/frontend/src/main.jsx#L18), [ReportProblemButton.jsx:126](../../src/frontend/src/components/ReportProblemButton.jsx#L126)). To truly "guarantee latest version" including after backend deploys, the client needs a server-advertised version to compare against.
- Existing blocking-modal pattern to reuse for the gate: `AuthGateModal.jsx`.

### Migration system (bulk, today)
- Three tracks (user_db / profile_db / postgres); migrations do NOT auto-run on deploy/startup; admin triggers `POST /api/admin/migrate` -> `run_all_migrations()` which loops **all** users. See CLAUDE.md Migration System.
- **Key enabler for JIT:** the per-user primitive already exists and is factored out — `_migrate_user(user_id)` migrates one user's `user.sqlite` + all registered profiles ([migrations/__init__.py:85](../../src/backend/app/migrations/__init__.py#L85)); the bulk runner is just a `for user in users: _migrate_user(...)` loop. JIT is largely *relocating* that call to the per-user DB-load seam, not writing new migration logic.
- Natural JIT seam: `ensure_user_database(user_id)` ([user_db.py:122](../../src/backend/app/services/user_db.py#L122)) / session-init, which already R2-restores a user's DB on access. `PRAGMA user_version` (schema) vs R2 `x-amz-meta-db-version` (sync) are independent — JIT must respect both.
- History to honor: T4830 hardened the runner (registry join, force-download canonical R2 copy, verify-at-head, fail-loud) after profiles silently stuck at old versions; JIT must preserve those guarantees per-user (canonical R2 copy, verify at head, loud failure), not regress to optimistic local-only migration.

## Solution

### Update flow (ordered) — ties Parts 1-3 together
The update gate runs a strict, barriered sequence. Each step must fully complete before the next; a failure at any step keeps the gate up and does NOT proceed to the destructive flush (no silent data loss):

1. **Detect** new version (waiting SW or backend-version mismatch) -> blocking gate appears.
2. **User clicks "Update now"** — this click is the *gesture* that authorizes the state flush (see reconciliation below).
3. **Sync up (flush):** client pushes its current durable editing state to the backend and **awaits** confirmation it landed (in the user's DB / R2). Hard barrier — if this fails (offline/error), stay on the gate, retry, surface the error; never continue to flush caches with unsynced state.
4. **Flush client caches:** activate waiting SW (`skipWaiting`+`clients.claim`), delete outdated precache, ensure no stale `index.html`/`sw.js` (Part 2).
5. **Migrate (JIT):** on the first authed request from the reloaded client, `_migrate_user(user_id)` brings that user's `user_db`+`profile_db` to head (Part 3). The state written in step 3 was written by the OLD frontend in the OLD schema; migration upgrades it here — correct ordering, and the reason sync-before-migrate matters.
6. **Resync down:** the fresh client's normal session-init downloads the now-migrated DB from R2. "Resync" is mostly the existing load path; the novel guarantees are the step-3 push and the barrier ordering.

**Persistence-rule reconciliation (CRITICAL — do not skip).** This flow must not violate "Persistence: Gesture-Based, Never Reactive" (CLAUDE.md) or reintroduce the full-state-save corruption class (T350 keyframe-origin, T4020 framing "shadow" empty version):
- The step-3 sync is triggered **BY the update-click gesture**, not a reactive `useEffect` watching state. That is what makes it compliant — it is an explicit user action, like the export-button full-state save.
- It must **NOT blindly serialize all React state.** Runtime fixups (`ensurePermanentKeyframes`, origin normalization) and banned view state (filters/sort/panels) must be excluded. Reuse the existing sanctioned full-state path (`saveCurrentClipState`, [FramingContainer.jsx:266](../../src/frontend/src/containers/FramingContainer.jsx#L266)) semantics — which already carry the T4020 warning — or, preferably, rely on the fact that gesture-based surgical saves already keep committed edits durable and scope step 3 to genuinely pending/in-flight state only. Design must state exactly WHAT is flushed and prove it is not a fixup/view-state dump.
- If, after analysis, every edit is already surgically persisted (nothing in-memory is unsynced), step 3 degrades to a cheap no-op/verify — and that is the ideal outcome, not a reason to skip designing it.

### Part 1 — Blocking update gate
Replace the dismissible toast with a **blocking, non-dismissible modal** (reuse AuthGateModal's full-screen blocking pattern; no backdrop-close per project rule). Requirements:
- Renders above everything, including the auth/login surface — an un-updated client cannot log in or interact.
- Single action: "Update now" -> `updateSW(true)` (skipWaiting + reload). No dismiss, no "later".
- Fires on `onNeedRefresh` (waiting SW) AND on a detected backend-version mismatch (Part 2's handshake).
- In-progress-work is handled by the ordered flow above: the gate's "Update now" click flushes durable state to the backend (step 3) *before* the destructive cache flush + reload, so no in-memory work is lost. This is why `registerType: 'prompt'` (chosen originally to avoid a silent reload nuking editing state) can safely become a hard gate — the reload is no longer silent and is preceded by a synced flush. Design still must identify exactly what step-3 flushes and confirm nothing unsaved is held outside it.

### Part 2 — Guaranteed cache flush + version guarantee (audit + hardening)
Two sub-deliverables:

**(a) App-version handshake so "latest" is guaranteed even for backend deploys.** Add a server-advertised version (e.g. `GET /api/version` or an `X-App-Version` response header carrying the deploy commit/build id) and a lightweight client check (on load + on `visibilitychange`, reusing the existing throttle) that opens the Part 1 gate on mismatch. This closes the backend-only-deploy gap; without it we cannot claim users always get the latest.

**(b) Cross-platform cache-flush audit.** Confirm, per platform, that accepting the update leaves NO stale asset and produces a truly fresh load. Explicitly cover: installed PWA (Android/desktop), iOS Safari + iOS installed/standalone (the hardest — aggressive SW/asset caching, and iOS only swaps a waiting SW on full app termination in some cases), macOS Safari/Chrome, Windows Chrome/Edge, Android Chrome. For each, verify: waiting SW activates, `clients.claim()` takes control, outdated precache is deleted (`cleanupOutdatedCaches` — set it explicitly, don't rely on default), and `index.html` isn't served stale from HTTP cache (check Cloudflare Pages caching headers for `index.html` + `sw.js` — these must be network-first / no-store or the SW never updates). Document findings in a matrix; fix any platform that can retain stale state. iOS standalone is the likeliest failure and needs a real-device check (per T4880 lesson: emulators don't reproduce iOS chrome/SW quirks).

### Part 3 — Frontend state sync (up / flush / resync)
Build the client + backend paths for the ordered flow above: the update-click flushes durable state up (step 3, hard barrier), and the reloaded client resyncs down (step 6). This is the deliverable here — the code paths this task lays down are exactly what the JIT-migration task (T5080) designs against. Specifically:
- A gesture-triggered "flush now" that awaits durable persistence of the well-scoped editing state (NOT a reactive dump; see reconciliation above), with a hard failure barrier before cache flush.
- Confirmation signalling so the gate knows the flush landed before proceeding.
- The resync is the existing session-init load; verify it fully repopulates from R2 post-reload.
- **During T5070, migration still happens the current way** (admin/bulk `run_all_migrations`). Step 5 of the flow is where per-user JIT will slot in — T5070 leaves that seam clean and documented; it does NOT change how migrations run.

> **JIT migration is spun out to [T5080](T5080-jit-migration.md)** (user decision 2026-07-13: two tasks). Rationale: JIT should be designed against the concrete sync/flush/resync paths T5070 establishes, not speculatively. T5070 is the modal + cache-flush + state-sync task; T5080 is the migration-model change. T5080 depends on T5070.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/utils/pwaUpdate.js` — toast -> blocking gate; add version-handshake check
- `src/frontend/src/utils/pwaUpdate.test.js` — update tests
- `src/frontend/vite.config.js` — Workbox: set `cleanupOutdatedCaches`, `clientsClaim`/`skipWaiting` semantics, review precache/runtime caching
- `src/frontend/src/main.jsx` — `setupPwaUpdatePrompt` wiring; `__COMMIT_HASH__`
- `src/frontend/src/components/AuthGateModal.jsx` — blocking-modal pattern to reuse
- `src/frontend/index.html` + Cloudflare Pages headers config — ensure `index.html`/`sw.js` are not HTTP-cached stale
- `src/backend/app/main.py` (or a small router) — new `/api/version` endpoint / `X-App-Version` header; expose deploy commit (there's a `commitHash` in vite; backend needs its own build id)
- `src/frontend/src/containers/FramingContainer.jsx` — `saveCurrentClipState` (existing sanctioned full-state save; step-3 flush reuses/reconciles with it — carries the T4020 shadow-save warning)
- `src/backend/app/services/user_db.py` — `ensure_user_database` (state-sync landing; also the JIT seam T5080 will use)
- `src/backend/app/session_init.py` — session-init resync path
- CLAUDE.md "Persistence: Gesture-Based, Never Reactive" (governs the step-3 flush)
- (T5080 owns `migrations/__init__.py` `_migrate_user`/`run_all_migrations`; T5070 only leaves step-5 seam clean)

### Related Tasks
- Builds on: T4150 (in-session PWA update — the current toast mechanism)
- **Blocks / feeds: T5080 (JIT migration)** — T5080 designs against this task's sync/flush/resync paths and slots into step 5 of the update flow
- Related: T4880/T4930 (mobile/iOS real-device verification discipline — apply to the iOS cache-flush audit)
- Knowledge docs: [backend-services.md](../../.claude/knowledge/backend-services.md), [persistence-sync.md](../../.claude/knowledge/persistence-sync.md)

### Technical Notes
- L-tier: 3+ layers (frontend SW, backend version endpoint, state-sync path), design-gated (Architect). Migration agent NOT needed (this task doesn't touch migration schema or timing — that's T5080).
- Persistence is gesture-based and durable server-side; the step-3 flush must obey that rule (gesture-triggered, scoped, no fixup/view-state dump).
- Version source of truth: backend needs a build/commit id available at runtime (Fly deploy) to advertise; frontend already has `__COMMIT_HASH__`. They deploy independently, so the handshake compares the *frontend's expected* against the *server's actual*, or simpler: server advertises its version and any change from what the client booted with triggers the gate.
- iOS is the known-hard platform for SW updates; plan a real-device pass, not just Playwright.

## Implementation

### Steps
1. [ ] Architect design doc — the ordered flow (gate -> sync up -> flush -> [migrate seam] -> resync), Part 1 gate, Part 2 version handshake + cache-flush strategy, Part 3 state-sync (what exactly is flushed, reconciled with the gesture rule). Leave step-5 migration seam clean + documented for T5080. **User approval gate.**
2. [ ] Part 1: blocking update-gate modal (replace toast; reuse AuthGateModal pattern)
3. [ ] Part 2a: backend `/api/version` (or `X-App-Version`) + client mismatch check feeding the gate
4. [ ] Part 2b: Workbox hardening (`cleanupOutdatedCaches`, cache headers for index.html/sw.js) + cross-platform cache-flush audit matrix (incl. real iOS/PWA device check); fix any platform retaining stale state
5. [ ] Part 3: gesture-triggered state flush (await durable landing, hard barrier before flush) + verified resync on reload
6. [ ] Tests: gate blocks interaction/login until update; version-mismatch opens gate; state flush awaits confirmation and blocks on failure; resync repopulates; pwaUpdate unit tests
7. [ ] Confirm T5080 (JIT migration) is filed with the seam this task leaves

### Progress Log

**2026-07-13**: Task created from user direction (blocking gate + cache flush + JIT migration). Investigation: current update = non-blocking PWA toast (frontend-only trigger, no backend-version detection).

**2026-07-13 (refine)**: User added the sync-up/flush/resync flow (frontend state pushed to backend before flush, migrations run, resync down). Then user split the task: JIT migration -> its own task **T5080**, designed against the paths T5070 lays down; a final batch migration + deletion of the bulk-migration code lives in T5080. T5070 now = gate + cache flush + state sync; it leaves the step-5 migration seam clean but does not change migration timing.

## Acceptance Criteria

- [ ] Update prompt is a blocking, non-dismissible modal — an un-updated client cannot log in or interact until it refreshes
- [ ] Gate also fires on backend-version mismatch (not just new service worker), via a server-advertised version handshake
- [ ] Documented cross-platform cache-flush matrix (PWA, iOS, macOS, Windows, Android) proving no stale assets survive the update; any failing platform fixed; iOS verified on a real device
- [ ] `index.html`/`sw.js` are not served stale from HTTP cache; outdated precache is cleaned
- [ ] On "Update now": durable frontend state is flushed to the backend and confirmed BEFORE caches are flushed; a flush failure keeps the gate up (no data loss); reload resyncs the state back down
- [ ] The step-3 flush is gesture-triggered and scoped (no reactive dump, no runtime-fixup/view-state persistence) — documented and tested
- [ ] Migration timing is unchanged by this task; the step-5 seam is documented for T5080
- [ ] Tests pass
