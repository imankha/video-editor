# T4950: Blocking update gate + guaranteed cache flush + JIT migration design

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

### Part 1 — Blocking update gate
Replace the dismissible toast with a **blocking, non-dismissible modal** (reuse AuthGateModal's full-screen blocking pattern; no backdrop-close per project rule). Requirements:
- Renders above everything, including the auth/login surface — an un-updated client cannot log in or interact.
- Single action: "Update now" -> `updateSW(true)` (skipWaiting + reload). No dismiss, no "later".
- Fires on `onNeedRefresh` (waiting SW) AND on a detected backend-version mismatch (Part 2's handshake).
- In-progress-work consideration: `registerType: 'prompt'` was chosen originally so a silent reload wouldn't nuke in-memory editing state (vite.config comment). A hard blocking gate reintroduces that risk. Design must state the stance: since persistence is gesture-based (already durable server-side), a reload should be safe — VERIFY there's no unsaved in-memory-only state that a forced reload would lose (e.g., an export mid-configure). If any exists, the gate must let the current durable gesture complete, or the reload is acceptable because nothing unsaved is held. Document the decision.

### Part 2 — Guaranteed cache flush + version guarantee (audit + hardening)
Two sub-deliverables:

**(a) App-version handshake so "latest" is guaranteed even for backend deploys.** Add a server-advertised version (e.g. `GET /api/version` or an `X-App-Version` response header carrying the deploy commit/build id) and a lightweight client check (on load + on `visibilitychange`, reusing the existing throttle) that opens the Part 1 gate on mismatch. This closes the backend-only-deploy gap; without it we cannot claim users always get the latest.

**(b) Cross-platform cache-flush audit.** Confirm, per platform, that accepting the update leaves NO stale asset and produces a truly fresh load. Explicitly cover: installed PWA (Android/desktop), iOS Safari + iOS installed/standalone (the hardest — aggressive SW/asset caching, and iOS only swaps a waiting SW on full app termination in some cases), macOS Safari/Chrome, Windows Chrome/Edge, Android Chrome. For each, verify: waiting SW activates, `clients.claim()` takes control, outdated precache is deleted (`cleanupOutdatedCaches` — set it explicitly, don't rely on default), and `index.html` isn't served stale from HTTP cache (check Cloudflare Pages caching headers for `index.html` + `sw.js` — these must be network-first / no-store or the SW never updates). Document findings in a matrix; fix any platform that can retain stale state. iOS standalone is the likeliest failure and needs a real-device check (per T4880 lesson: emulators don't reproduce iOS chrome/SW quirks).

### Part 3 — JIT migration design (DESIGN + DOC DELIVERABLE)
Produce a full design doc (`docs/plans/tasks/T4950-jit-migration-design.md` or the standard `docs/plans/tasks/T{id}-design.md`) covering the move from bulk `run_all_migrations` to per-user JIT. Must specify:
- **Trigger & seam:** call `_migrate_user(user_id)` (the existing primitive) at the per-user DB-load path (`ensure_user_database` / session-init) so a user is migrated to head the first time they touch the backend on the new deploy. Define exactly where (before first DB read), and how it composes with the refresh gate (client on new version -> first authed request migrates their DB).
- **Concurrency & idempotency:** two concurrent requests from the same user, or overlapping profiles, must not double-migrate or corrupt R2 (per-user lock? advisory lock? the migration is already idempotent at the SQL level — confirm and rely on that). Postgres (shared, once) can't be per-user — keep Postgres on deploy-time/admin trigger; JIT applies to user_db + profile_db only. State this split clearly.
- **Failure handling:** a failing JIT migration must fail loud (T4830), block that user's data access rather than serve a half-migrated DB, and surface a clear error — NOT silently fall back to unmigrated data (project no-silent-fallback rule). Define the user-facing behavior when their migration fails.
- **Performance:** migration on the hot request path adds latency on the first post-deploy request per user. Quantify (usually just a version check + no-op when already at head), ensure the at-head check is cheap, and decide whether to gate behind the refresh flow so it's expected/one-time rather than surprising.
- **Backfill / long-tail:** users who never return still need migrating eventually (e.g., before an expiry sweep touches their data). Keep the admin bulk sweep available as a backstop for inactive users; JIT covers active users. Define the coexistence.
- **Rollout:** how to flip from bulk to JIT safely (both can run during transition; JIT is additive). No data migration of its own.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/utils/pwaUpdate.js` — toast -> blocking gate; add version-handshake check
- `src/frontend/src/utils/pwaUpdate.test.js` — update tests
- `src/frontend/vite.config.js` — Workbox: set `cleanupOutdatedCaches`, `clientsClaim`/`skipWaiting` semantics, review precache/runtime caching
- `src/frontend/src/main.jsx` — `setupPwaUpdatePrompt` wiring; `__COMMIT_HASH__`
- `src/frontend/src/components/AuthGateModal.jsx` — blocking-modal pattern to reuse
- `src/frontend/index.html` + Cloudflare Pages headers config — ensure `index.html`/`sw.js` are not HTTP-cached stale
- `src/backend/app/main.py` (or a small router) — new `/api/version` endpoint / `X-App-Version` header; expose deploy commit (there's a `commitHash` in vite; backend needs its own build id)
- `src/backend/app/migrations/__init__.py` — `_migrate_user` (JIT primitive), `run_all_migrations` (bulk backstop)
- `src/backend/app/services/user_db.py` — `ensure_user_database` (JIT seam)
- `src/backend/app/session_init.py` — session-init path (alternate/adjacent seam)
- CLAUDE.md "Migration System" + [running-migrations reference](../../.claude/knowledge/backend-services.md)

### Related Tasks
- Builds on: T4150 (in-session PWA update — the current toast mechanism), T4830 (hardened migration runner — JIT must preserve its guarantees)
- Related: T4880/T4930 (mobile/iOS real-device verification discipline — apply to the iOS cache-flush audit)
- Knowledge docs: [backend-services.md](../../.claude/knowledge/backend-services.md), [persistence-sync.md](../../.claude/knowledge/persistence-sync.md)

### Technical Notes
- L-tier: 3+ layers (frontend SW, backend version endpoint, migration seam), a new pattern (JIT migration), design-gated. Architect design gate required (esp. Part 3). Migration agent NOT needed (no new schema migration; this changes *when/how* existing migrations run).
- Persistence is gesture-based and durable server-side, which is what makes a forced reload tolerable — but Part 1 must verify no unsaved in-memory-only state is lost.
- Version source of truth: backend needs a build/commit id available at runtime (Fly deploy) to advertise; frontend already has `__COMMIT_HASH__`. They deploy independently, so the handshake compares the *frontend's expected* against the *server's actual*, or simpler: server advertises its version and any change from what the client booted with triggers the gate.
- iOS is the known-hard platform for SW updates; plan a real-device pass, not just Playwright.

## Implementation

### Steps
1. [ ] Architect design doc — all three parts, with Part 3 (JIT migration) fully specified (trigger/seam, concurrency, failure, perf, backfill, rollout). **User approval gate.**
2. [ ] Part 1: blocking update-gate modal (replace toast; reuse AuthGateModal pattern; verify no unsaved-state loss)
3. [ ] Part 2a: backend `/api/version` (or `X-App-Version`) + client mismatch check feeding the gate
4. [ ] Part 2b: Workbox hardening (`cleanupOutdatedCaches`, cache headers for index.html/sw.js) + cross-platform cache-flush audit matrix (incl. real iOS/PWA device check); fix any platform retaining stale state
5. [ ] Part 3 implementation (may be a scheduled follow-up if design gate defers it) OR file the follow-up task with the approved design
6. [ ] Tests: gate blocks interaction/login until update; version-mismatch opens gate; pwaUpdate unit tests; JIT migration (if implemented) idempotency + fail-loud + at-head no-op

### Progress Log

**2026-07-13**: Task created from user direction. Investigation done: current update = non-blocking PWA toast (frontend-only trigger, no backend-version detection); JIT primitive `_migrate_user` already exists (bulk runner just loops it); natural seam is `ensure_user_database`. Coupled because the refresh flow is the JIT migration trigger point.

## Acceptance Criteria

- [ ] Update prompt is a blocking, non-dismissible modal — an un-updated client cannot log in or interact until it refreshes
- [ ] Gate also fires on backend-version mismatch (not just new service worker), via a server-advertised version handshake
- [ ] Documented cross-platform cache-flush matrix (PWA, iOS, macOS, Windows, Android) proving no stale assets survive the update; any failing platform fixed; iOS verified on a real device
- [ ] `index.html`/`sw.js` are not served stale from HTTP cache; outdated precache is cleaned
- [ ] JIT migration is fully designed and documented (approved design doc): trigger/seam, concurrency/idempotency, fail-loud handling, performance, inactive-user backstop, rollout — Postgres stays deploy-triggered, user_db/profile_db go JIT
- [ ] No unsaved in-memory state lost by the forced reload (verified/documented)
- [ ] Tests pass
