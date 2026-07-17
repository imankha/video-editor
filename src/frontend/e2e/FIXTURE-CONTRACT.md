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
   crop overlay + at least one crop keyframe. Reached via the **Reel Drafts** tab ->
   the first framing chip (`getByTitle(/\[.+\]: .*\(click to open\)/)`).
   Consumed by `T4550-overlay-transform.qa.spec.js` (crop overlay placement + drag).
3. **(best-effort, NOT asserted by the seed) >= 1 published reel** — an exported reel
   (final video). Overlay mode is gated on an exported reel. The seed does **not**
   guarantee an exported draft, so specs that need it detect reachability and skip
   **honestly** (logged, never a silent pass) when the draft isn't exported — the layout
   is also covered by Vitest. See `T4550` test 2 (`mode-overlay` gate). Do not write a
   spec that hard-requires a published reel until the seed is extended to produce one.

### Framed-project position note (T5320)

The framed project's crop keyframe may sit anywhere in the frame. A spec that drags the
crop box must drag **toward the video center** (compute the sign from the box's position
relative to the video rect) so the move always has headroom — a blind fixed-direction
drag can land on `constrainCrop`'s clamp when the fixture crop is near an edge and read
as a false `moved 0` failure. This is a **spec-robustness** requirement, not a fixture
guarantee: the contract does not promise a centered crop.

## Seeding (SUPERVISOR-run — not in a dev container)

The staging seed copies imankh's dev account (incl. profile `9fa7378c` + its framed
project) into staging. It needs cross-env creds + a staging Postgres proxy a dev
container cannot open, so the **supervisor** runs it, not the worker:

```bash
# From the host, with Fly proxies up for both source + destination Postgres and
# .env / .env.staging present at the project root:
cd src/backend && .venv/Scripts/python.exe ../../scripts/copy_user_between_envs.py \
    --email imankh@gmail.com --from dev --to staging
```

Copies Postgres rows (`users` + `game_storage_refs`) and R2 objects (profile.sqlite,
user.sqlite, media) for that user.

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
