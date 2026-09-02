# E2E Fixture Contract (T5320)

The E2E suite can run against **local dev** or a **deployed target** (staging CF Pages
+ Fly API — see `playwright.config.js` / `helpers/targetEnv.js`). Data-dependent specs
do not create their own game/clips/framed-project (slow, and on a deployed target the
upload+extract pipeline may be unavailable) — they **log in as a seeded real account**
and rely on the guarantees below.

## The seeded account

| Field | Value |
|-------|-------|
| Email | `imankh@gmail.com` |
| Profile | `9fa7378c` (8-hex profile GUID hint) |
| Auth helper | `loginAsRealUser(context, 'imankh@gmail.com', '9fa7378c')` (`helpers/realAuth.js`) |
| Env override | `E2E_REAL_EMAIL` / `E2E_REAL_PROFILE` |

`loginAsRealUser` POSTs `/api/auth/dev-login`, which runs the real session-init
(R2 download + profile selection) and mints an `rb_session` cookie — so pages see the
account's **real data**, not a blank profile. `dev-login` is gated on
`APP_ENV != production` (works on dev + staging, 404s on prod) and the helper always
sends the `X-Test-Mode` header. The account must exist in the target env's Postgres
(seed it — see below — or `dev-login` 404s).

## Data guarantees (what specs may assume)

When seeded, the account is guaranteed to have, on profile `9fa7378c`:

1. **>= 1 ACTIVE game with raw clips** — a saved game whose card click loads it into
   Annotate (URL `/annotate`, `<video>` + `.clip-marker`s render). Consumed by
   `game-loading`, `annotate-game-clock`, `annotate-*`.
   **Gotcha:** an *expired* game's card click plays its recap / offers extend — it does
   NOT load into Annotate (`ProjectManager` `GameCard.handleClick`). Specs must target an
   ACTIVE game (`storage_status !== 'expired'`), read from `GET /api/games`, not "the
   first card". imankh's dev data currently has a mix (e.g. the most recent game can be
   expired). "Annotate mode" is detected by the `/annotate` URL + a `<video>`/`.clip-marker`,
   NOT the old `.text-green-400` badge (that selector is stale).
2. **>= 1 framed project (reel draft)** — a draft that opens into Framing mode with a
   crop overlay + at least one crop keyframe. Reached via the **Clips** tab ->
   the first framing chip.
   Consumed by `T4550-overlay-transform.qa.spec.js` (crop overlay placement + drag).
   **Chip-title gotcha (T7750):** the framing chip title format is NOT uniformly
   `[tags]: label (click to open)` — only a per-clip segment carries a `[tags]` bracket. A
   framing-complete or multi-clip aggregate draft's Focus segment is untagged
   (`Focus: ... (click to open)`), and a deep-link segment reads `Overlay: ...`. A selector
   that REQUIRES the bracket (`getByTitle(/\[.+\]: .*\(click to open\)/)`) silently matches
   nothing on such an account and hangs. Match any `(click to open)` segment that is NOT the
   trailing `Overlay:` one instead (see `T6190-project-open-fetches.qa.spec.js openFramingChip`).
   **Un-started-draft gap (T7750, NOT guaranteed):** the seed promises a framed project but
   does NOT promise one still in **"Not started"** status. The shared dev account's drafts
   drift past that through ongoing QA use. Specs that need a clean un-edited baseline
   (`T5780-framing-effective-duration`, `T5790-export-credit-cost-estimate` — a de-emphasized
   output-length chip where output == source) therefore **skip loudly** when no "Not started"
   card exists rather than hang. To make them RUN GREEN, re-seed an un-started draft (or leave
   one un-edited); do not write a spec that hard-requires "Not started" until the seed
   guarantees it.
3. **(best-effort, NOT asserted by the seed) >= 1 published reel** — an exported reel
   (final video). Overlay mode is gated on an exported reel. The seed does **not**
   guarantee an exported draft, so specs that need it detect reachability and skip
   **honestly** (logged, never a silent pass) when the draft isn't exported — the layout
   is also covered by Vitest. See `T4550` test 2 (`mode-overlay` gate). Do not write a
   spec that hard-requires a published reel until the seed is extended to produce one.

### Out-of-band DB-fixture specs (T7750 — skip loudly when un-staged)

A handful of local-only specs need a precondition staged OUTSIDE the standard seed — a QA
harness DB flip, a dedicated test user's profile SQLite, or an admin seed script. A bulk
unattended `npx playwright test` sweep does not stage these, and a **shared** dev container
must NOT create them (mutating game state / Postgres that concurrent specs read). Each now
**skips loudly** (a `test.skip` naming the missing fixture) instead of hard-failing or hanging
to a timeout, and still runs its assertions when the fixture IS staged via its documented harness:

- **`bug27p-expired-annotations.spec.js`** — needs a game whose `game_storage.storage_expires_at`
  is flipped into the past (QA harness). Skips when no expired game is present. Expired-render
  path is unit-covered (`src/modes/AnnotateModeView.expired.test.jsx`).
- **`t4800-orphan-drafts.qa.spec.js`** — needs the `t4800_livedrive` test user's profile SQLite
  seeded with the "Exported Draft A" / "Published Reel C" rows. Skips when they're absent.
- **`T5770-admin-weekly-usage.spec.js`** — needs `scripts/_t5770_qa_seed.py`'s deterministic QA
  user. Now paginates the whole admin list (no email-search param; the user need not be on
  page 1) and skips when the seed row is absent.

### Published-reel + shareable-collection guarantees (T5420 — the `@staging-gate` derisk specs)

The `@staging-gate` derisk specs key on these. On the current staging copy of imankh they
hold (27 published reels via `/api/downloads`, 5 non-empty game collections via
`/api/collections/summary`), so the specs run **green**; if a re-seed drops them the specs
**skip loudly** (never a silent pass):

- **`derisk-staging-endcard-copylink.qa.spec.js`** needs (a) `>= 1` published reel
  (`/api/downloads` non-empty) to mint a public reel share, and (b) `>= 1` non-empty game
  collection (a `/api/collections/summary` game with a `ratio_counts[ratio] > 0`) to mint a
  collection share **and** to expand a My Reels game group with `[data-testid="reel-card"]`s.
  The collection end card is driven to appear by dispatching a native `ended` per reel on
  the story player (deterministic; real-time playback is too slow/flaky on a deployed
  target), so the group's reel count must match `ratio_counts[ratio]`.

- **`derisk-staging-export.qa.spec.js`** needs a draft that can reach **overlay-export**.
  **T6120 correction of the earlier T5420 diagnosis:** the overlay Export button is gated on
  OverlayScreen's `effectiveOverlayVideoUrl = workingVideo?.url` for a pre-framed draft, so
  the panel mounts iff the working video actually **loads**. The earlier claim that a
  pre-framed single-clip draft "does not hydrate `framingVideoUrl`" was a **misdiagnosis**:
  `framingVideoUrl` is a pass-through source used only for un-framed / multi-clip / edited
  drafts and is irrelevant when a working video exists. The REAL cause of the observed
  mount failures on staging is a **missing working-video R2 object** — the DB reports
  `has_working_video=true` (row + `working_video_url` present) but the `working_videos/…mp4`
  object returns **NoSuchKey/404** (a dangling ref, e.g. after a staging wipe that dropped
  `working_videos/` objects while keeping the profile SQLite and `final_videos/` objects).
  `workingVideo` never hydrates → `effectiveOverlayVideoUrl` stays null → panel never mounts.
  A draft whose working-video R2 object is **intact DOES mount the panel** (verified T6120 on
  staging drafts 37/54). So this is a **staging-data (dangling-ref) issue, not a mount-logic
  product bug.** The spec now (a) probes candidates and prefers a draft whose working video
  actually loads, and (b) on a mount failure logs the ACTUAL cause (missing R2 object vs.
  un-framed) before skipping loudly. To make this spec **run green**, re-seed imankh
  (`copy_user_between_envs.py`) so at least one framed draft has a present working-video R2
  object, or leave an un-finalized un-framed draft so Phase 1 renders a fresh one.

### Framed-project position note (T5320)

The framed project's crop keyframe may sit anywhere in the frame. A spec that drags the
crop box must drag **toward the video center** (compute the sign from the box's position
relative to the video rect) so the move always has headroom — a blind fixed-direction
drag can land on `constrainCrop`'s clamp when the fixture crop is near an edge and read
as a false `moved 0` failure. This is a **spec-robustness** requirement, not a fixture
guarantee: the contract does not promise a centered crop.

## The gate alias accounts (T7800 — lanes B and C)

The parallel staging gate (see `STAGING-GATE.md` § Lanes) gives EVERY lane its own
account so no two concurrent sessions share one (concurrent write sessions on one
account cause `stale_baseline` R2 CAS freezes, and even a light-write/read pairing is
only safe on a single-machine staging, which is not guaranteed). Lanes B and C are
**alias clones** of imankh (`--to-email`, below): same profile GUID `9fa7378c`, same
data guarantees as this contract, distinct email + derived user_id, globally-unique
identity columns (`google_id`, `invite_code`) neutralized/re-derived.

| Lane | Email | Profile |
|------|-------|---------|
| B | `e2e-gate@test.local` (runner override: `GATE2_EMAIL`) | `9fa7378c` (`GATE2_PROFILE`) |
| C | `e2e-gate2@test.local` (runner override: `GATE3_EMAIL`) | `9fa7378c` (`GATE3_PROFILE`) |

Because the clones mirror imankh at seed time, every guarantee in this contract holds
for them exactly as of the last seed. Re-seed ALL THREE accounts together (runbook step
0) so they do not drift apart.

## Seeding (SUPERVISOR-run — not in a dev container)

The staging seed copies imankh's dev account (incl. profile `9fa7378c` + its framed
project) into staging. It needs cross-env creds + a staging Postgres proxy a dev
container cannot open, so the **supervisor** runs it, not the worker:

```bash
# From the host, with Fly proxies up for both source + destination Postgres and
# .env / .env.staging present at the project root (stop the staging machines first,
# then restart them after — see the --dest-machines-stopped guard):
cd src/backend && .venv/Scripts/python.exe ../../scripts/copy_user_between_envs.py \
    --email imankh@gmail.com --from dev --to staging --dest-machines-stopped

# T7800: the gate alias accounts are the SAME copy with --to-email (alias clone:
# distinct deterministic user_id, google_id nulled, invite_code re-derived, R2
# mirrored under the alias id) — run once per lane account:
cd src/backend && .venv/Scripts/python.exe ../../scripts/copy_user_between_envs.py \
    --email imankh@gmail.com --from dev --to staging --dest-machines-stopped \
    --to-email e2e-gate@test.local
cd src/backend && .venv/Scripts/python.exe ../../scripts/copy_user_between_envs.py \
    --email imankh@gmail.com --from dev --to staging --dest-machines-stopped \
    --to-email e2e-gate2@test.local
```

Copies Postgres rows (`users` + `game_storage_refs`) and R2 objects (profile.sqlite,
user.sqlite, media) for that user. Alias-clone caveats (e2e-only, never for a real
user): the copied SQLite DBs still carry source-internal data — display email, plus
`user.sqlite` rows keyed by the SOURCE user_id (`credits`, `credit_transactions`,
`stripe_customers`, `user_activity`), which the alias simply reads as empty
(`WHERE user_id = ?` misses them; harmless — credits live in Postgres since v019, and
not inheriting a Stripe customer is desirable). Backend routing keys on Postgres
email -> user_id, so the fixture works.

> **Admin visibility:** `copy_user_between_envs.py` does not copy `user_segments`, so a
> freshly-copied account can be invisible in the admin UI until a segment row exists.
> This does not affect `dev-login` / the specs (they key on email + profile), only admin
> listing.

## Idempotency & prod-guard

- **Re-runnable.** The copy purges the destination user's R2 prefix before re-mirroring,
  so re-running converges to the source state (no orphan/stale objects) rather than
  duplicating. Postgres rows upsert by user id.
- **Refuses to wipe on empty source.** If the source R2 prefix is empty it aborts before
  touching the destination (`Source prefix ... is EMPTY -- aborting`), so a mis-pointed
  run can't blank the target.
- **Env is explicit, choices-constrained.** `--from` / `--to` accept only
  `dev|staging|production` and must differ; each resolves to its own `.env{,.staging,.prod}`.
- **Do NOT write a prod-touching seed in a container.** The seed is a supervisor/host
  operation. A dev container has no prod creds and must never target prod. The existing
  copy script is the seam; there is no in-container seed of prod data.

## Deployed-target timeout

`playwright.config.js` sets a **60s** per-test timeout on a deployed target (local stays
at 5m). With the fixture seeded, nothing legitimately takes minutes, so a data/config
miss (fixture not seeded / wrong profile) fails fast instead of hanging to a 5m timeout —
keeping a full staging run under an hour and usable as a pre-deploy gate. Override with
`E2E_TIMEOUT_MS` for a slower target.
