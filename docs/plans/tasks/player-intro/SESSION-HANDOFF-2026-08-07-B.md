# Session handoff — 2026-08-07 ~06:35 UTC. Supersedes SESSION-HANDOFF-2026-08-07.md

**master @ `bb53188b`** — T6640 merged this session (PR #239, Branch CI green, branch deleted).
Everything below is LIVE STATE, forward-looking only. Prior handoffs are history; do not re-read them.

**Operating mode:** the user tests a container port, gives notes, the supervisor briefs the worker for
another round in the SAME container/session (`claude -p --resume <session-id>`). Workers NEVER push —
the supervisor pushes via `git fetch C:/work/tasks/<slug> <branch>:<branch> && git push origin <branch>`
(works from the shared checkout without switching its branch). **The user merges only noteless branches.**

---

## 1. DO THIS FIRST: deploy-time migration debt

`POST /api/admin/migrate` is REQUIRED after the next deploy — profile_db head is now **v040**
(T6640's backfill). Without it, existing libraries still show no default card and every tile still
offers "Set as default".

## 2. THE MIGRATION NUMBERING TRAP (blocks both remaining merges)

master profile_db head is **v040**. The two unmerged branches hold versions BELOW it:

| Branch | Version held | Must become |
|---|---|---|
| T5215 | v037 (`v037_intro_min_duration.py`) | > 40 (e.g. v041) |
| T6630 | v039 (`v039_text_overlays_regions.py`) | > 40 (e.g. v042) |

The runner applies only versions **greater than** a DB's `user_version`, so once any DB reaches 40
these are skipped **silently and permanently** (the T6345 bug class). **Renumber each before merging**
— file name, class name, `version =`, the `MIGRATIONS` registry entry in
`src/backend/app/migrations/profile_db/__init__.py`, and any test that names the version.

Two guards on master will fail loudly and correctly when you renumber, and must be updated in the same
commit: `test_t5195_migration_v034.py::test_registry_head_is_v040` (it also asserts 37/39 are ABSENT)
and `test_t6030_migration_window_structural_guard.py::HEAD_VERSION_AUDITED`. If the renumbered
migration ADDs a column, also extend `POST_V023_COLUMNS` — neither v038 nor v040 did, so the
deploy→migrate window is currently unchanged.

**Container DBs are already stamped** at 37 (T5215) and 39 (T6630) from local runs, so a renumbered
migration re-applies there — confirm each is idempotent before renumbering, or reset that container's
`user_data/<user_id>`.

---

## 3. WORKERS (containers survive; both sessions resumable)

Resume form — always foreground-redirected, never let a worker wait for a notification:
```
docker exec -d -u dev reel-task-t6630 bash -lc 'cd /workspace && claude -p --resume a2ddc9d9-f812-4798-b248-ff18c45d623f --model sonnet "<prompt>" > /tmp/log 2>&1'
docker exec -d -u dev reel-task-t5215 bash -lc 'cd /workspace && claude -p --resume ea8322fc-4645-45b4-83b8-541467ee09a7 --model sonnet "<prompt>" > /tmp/log 2>&1'
```

### T5215 — intro attachment (`reel-task-t5215`, :5176/:8003) — round 3, item 3 IN FLIGHT
- Pushed: round 1 only. Container-local: `b6d466fa`, `383ad0d7`, `6bbe16fb` (round 2),
  **`32f00a88`** (z-order via zLayers DROPDOWN rung), **`7b991780`** (badges: collection cards get one,
  reel badge appears without reload). Items 1 and 2 of round 3 are DONE.
- **Item 3 unfinished and was RED**: `T5215-intro-attachment.qa.spec.js:197` —
  *"a card click must not close the popup (no commit-on-click)"*. Uncommitted work in
  `IntroCardPicker.jsx`, `IntroCardCarousel.jsx`, and that spec. Brief: `/tmp/round3.md` +
  `/tmp/round3-nudge.md` in-container.
- Wanted: card click SELECTS + plays the T5205 motion preview (reuse it, no second animator), popup
  stays open, explicit **OK** commits (the one surgical write moves to OK), Cancel/X/Esc = no write,
  Enter = OK, both hosts of the shared picker, badge appears immediately after OK.

### T6630 + T6590 — one branch (`reel-task-t6630`, :5175/:8002) — round 4 COMPLETE, awaiting user test
- Pushed: round 1 only (`8946f9ab`). Container-local: rounds 2-3 (`20e1d1ca`, `f0157917`, `5705b476`,
  `d489ef16`), round 4 (`269c13f1`, `0639b6a1`, `bf2948fe`, `463a2cba`, **`ef3d306d`** video error
  banner clears once a later load succeeds, **`0fb3ff57`** evidence spec). Clean tree.
- Round 4 reported: 9 e2e + 56 frontend unit + 47 backend tests pass, lint clean.
- **Must fix before this branch merges:** `0fb3ff57` committed
  `src/frontend/public/e2e-test-only-stale-sw.js`. Anything in `public/` is copied verbatim into the
  production bundle — a test-only service-worker script must not ship. Move it under `e2e/` fixtures.
- Round-4 items the user has NOT yet seen: text REGIONS-contain-ELEMENTS model, default position
  preset, two-column Text tab layout, the error-banner fix. Expect notes.

---

## 4. WHAT LANDED THIS SESSION (do not redo)

- **T6640 merged** (`bb53188b`): measured layout + settle-aware collision fix, inline rename,
  always-one-default invariant, and **v040** backfilling a default for pre-existing libraries.
- **Profile indicator shows the intro photo** (`1ab5b1bb`, on `fix/landing-slider-after-video-freeze`,
  NOT yet merged): `ProfileSportButton` renders `introPhotoUrl` when present, sport emoji otherwise,
  emoji fallback on image error. `introPhotoUrl` already arrives on every profile from bootstrap.
- **T6650 filed** (`f7428aea`, same branch): see §5.
- That branch is `origin/master` + those doc/feature commits — merge or rebase it; nothing else is on it.

## 5. T6650 — intro photo destroyed by card delete (filed, NOT started)

[docs/plans/tasks/T6650-card-delete-destroys-profile-intro-photo.md](../T6650-card-delete-destroys-profile-intro-photo.md).
Root-caused from live evidence; **the previous handoff's "upload didn't prove the object landed" theory
is REFUTED — do not re-derive it.** The upload path already uploads before persisting and
`retry_r2_call` re-raises, so a failed PUT cannot produce a persisted key (proven again when the user's
re-upload landed correctly).

Real cause: one R2 object, two owners. `introCardDefaults.js:57` defaults a card's `image_key` to the
profile's photo key (same key, test-pinned), and `intro_cards.py:331-333` hard-deletes that object on
card delete, leaving `user_settings.intro_photo_key` dangling. Second half: cards hold a SNAPSHOT of
the key, so a profile re-upload never propagates and the card keeps rendering the dead key with no
missing-object state. **User verdict: the Remove → "Use profile photo" recovery is fine, do not
redesign it.** The user's photo currently resolves to a live object again (they re-uploaded).

---

## 6. OPERATIONAL FACTS EARNED THE HARD WAY (do not re-derive)

- **Poll a worker's LAST MESSAGE — finished, quota-dead, auth-dead and rate-limited all look identical**
  (quiet, exit 0). This session saw three distinct deaths: session-limit, transient
  `Server is temporarily limiting requests` (killed both workers seconds after launch — relaunch
  staggered), and **auth death**.
- **Auth death signature: `.credentials.json` drops 508 → 280 bytes** and the worker exits
  `Not logged in · Please run /login`. Cause is refresh-token rotation shared between host and
  containers, so it hits both workers at once. Fix:
  `docker cp C:/Users/imank/.claude/.credentials.json <container>:/tmp/creds.json` then
  `install -o dev -g dev -m 600 /tmp/creds.json /home/dev/.claude/.credentials.json` as root. Expect
  recurrence whenever two workers run.
- **Premature yield still happens**: a worker ended its turn "waiting for the background verification
  run". Headless workers get no notifications. Every brief must say: run foreground, redirected, then
  read the file; never background anything you need the result of.
- **A container backend started without `--reload` serves stale code** — :8001 was 4 hours behind its
  own branch, which would have failed the user's default-card test for the wrong reason. Check process
  start time against the last commit before handing over a port.
- **Verify served code with a real code TOKEN, never a comment** (esbuild strips comments); restart
  Vite after edits (container watcher unreliable), then curl, then tell the user to hard-reload.
- Backends/Vite in containers must bind **0.0.0.0**. Kill sweeps via /proc need a split pattern
  (`P="cla""ude"`) built INSIDE the container, or they match your own exec shell.
- **Multi-container QA on one dev account ⇒ recurring `stale_baseline` CAS freezes.** Recovery: kill
  backend, `rm -rf /workspace/user_data/<user_id>`, restart, re-login. Do not start a host backend on
  :8000 while containers are running — it becomes a fourth writer.
- R2 bucket CORS now includes ports 5174-5176 (persistent fix). The old "video failed to load /
  head fetch threw" on container ports was this, NOT service workers — that theory is withdrawn.
- dev-login on any container port: `POST /api/auth/dev-login {"email":"imankh@gmail.com"}` → real
  account, real R2 data, real writes.

## 7. USER DECISIONS (do not relitigate)

| Decision | Value |
|---|---|
| Overlay text model | REGIONS (time spans) contain ELEMENTS; all elements of a region render together |
| Text management | In the Text tab (list + add/remove + per-element settings); lane = timing only |
| Text positioning | 3×3 preset grid + per-element alignment; stage free-drag removed |
| Overlay tabs | Overlay (default) / Text / Thumbnail; Thumbnail tab is DISPLAY-ONLY |
| "Thumbnail" | Canonical user-facing term |
| Thumbnail marker | TOP of timeline, draggable; solve occlusion at the top, never relocate lower |
| Layer z-order | Text above spotlight/tracking |
| Cards: default | FIRST card is the default, marked by a derived badge; any non-default card can be promoted; delete auto-promotes |
| Duration gating | Already exists (T5215 `intro_min_duration_seconds`, 20s) — do NOT build a second setting |
| Picker commit | SELECT → animation preview → explicit OK commits; no commit-on-click |
| Profile indicator | Intro photo when present, sport emoji otherwise |
| Merge policy | Only noteless branches; the user tests each round on container ports first |

## 8. NEXT, IN ORDER

1. Resume **max 2 workers**: T5215 (finish round-3 item 3) and T6630 only if the user returns notes.
2. Hand the user :5175 (T6630 round 4) to test — **restart Vite and curl-verify a code token first**.
3. When a branch goes noteless: renumber its migration per §2, push, Branch CI, merge, delete branch.
4. **T5220 (prepend at egress) is still the epic's missing end** — nothing built so far plays anywhere
   until it ships. T6460 (CI cancel-on-push) remains open.
5. T6650 is filed and unstarted.

**Kickoff prompt for a fresh session:**
> Read docs/plans/tasks/player-intro/SESSION-HANDOFF-2026-08-07-B.md and continue driving the
> subagents. Respect the quota ceiling (2 workers max), poll workers' last messages before trusting
> silence, and hand the user test links only after curl-verifying served code.
