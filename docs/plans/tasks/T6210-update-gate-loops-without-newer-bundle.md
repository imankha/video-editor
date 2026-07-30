# T6210 (Tbug41s): Update gate loops forever when the server is ahead but no newer bundle exists

**Status:** STAGING — fixed in `65841559`, deployed to staging 2026-07-30.

## Symptom

Staging showed the blocking "A new version is ready" modal in an unescapable loop:
clicking **Update now** reloaded the page and the modal immediately returned. Prod
was unaffected. Reported by user 2026-07-30.

## Root cause

Tbug40p made the gate a pure truth comparison: raise iff `serverBuild > clientBuild`
(`appVersion.checkServerVersion`). That proves the **server** moved — it does NOT
prove a newer **client bundle** exists to load.

The two halves deploy independently. Both workflows are path-filtered:

- `.github/workflows/deploy-backend.yml` → `paths: src/backend/**`
- `.github/workflows/deploy-frontend.yml` → `paths: src/frontend/**`

So a backend-only commit raises the server's build number with no matching bundle
published. The gate's exit condition — "reload onto a higher `__APP_BUILD__`" — is
then unreachable, and because the modal *never auto-closes by design*, the user is
stranded.

**Measured on staging 2026-07-30:**

| | build | commit |
|---|---|---|
| staging frontend bundle | 3163 | `b130803b` |
| staging backend | 3165 | `a442ad49` |
| prod frontend | 3166 | `9098ad5b` |
| prod backend | 3166 | `9098ad5b` |

`git diff --name-only b130803b..a442ad49 | grep -c "^src/frontend/"` → **0**. Commits
3164 (`c00db98c`, T6090 — scripts + backend tests) and 3165 (a merge) touched no
frontend files, so `deploy-frontend.yml` never ran and 3163 was the newest bundle in
existence.

Prod escaped only because `deploy_production.sh --all` ships both halves from one
commit (3166 == 3166). **This was latent on prod**: any
`deploy_production.sh --backend-only` would have stranded every production user the
same way.

## Fix (`65841559`)

Gate iff `serverBuild > clientBuild` **AND** a probe confirms a real waiting bundle.

- `utils/appVersion.js` — new bundle-probe seam (same shape as `updateGateStore`'s
  `_swReloader`: mechanics live in `pwaUpdate`, the decision lives here). Throttled
  (5 min) and de-duplicated, because the failing state leaves the server permanently
  ahead while `checkServerVersion` runs on *every* API response — unthrottled that is
  one `registration.update()` per response. Early-returns once the gate is already up.
- `utils/pwaUpdate.js` — registers the probe (it owns the `ServiceWorkerRegistration`):
  `registration.update()`, then require `registration.waiting` **specifically**. A
  first-ever install activates directly with nothing to supersede; counting that as an
  update would re-create the loop.
- `utils/sessionInit.js` — the interceptor call is now async; deliberately not awaited
  (the response path must not wait on a gate decision) with a trailing `.catch()`.

**Deliberate tradeoff:** no probe registered (SW unsupported, private mode, failed or
pending registration, dev server) means **no gate**. Gating on an unprovable claim is
exactly what strands users, and those clients self-heal — with no precache, any
ordinary reload already fetches the newest `index.html`. Warns rather than failing
silently. Cost: such clients are no longer force-prompted (pre-T5070 status quo).

## Verification

- 8 new regression pins in `appVersion.test.js`, including the exact 3163/3165 repro
  and a 5-iteration reload loop that must never gate.
- Full frontend suite: 1440 passed. Production build clean.
- Deployed staging bundle verified by fetching the artifact: `#3169 @ 65841559`,
  probe logic present. Staging frontend 3169 > backend 3165 → gate cannot fire.

## Residual risk / follow-ups

- **The ServiceWorker path has no real-browser test.** Unit tests pin the *decision*
  with a stubbed probe; `probeForWaitingBundle`'s real `update()` / `waiting` /
  `installing` behavior is jsdom-mocked — the same false-confidence class as T5380.
  Watch the next FRONTEND-ONLY staging deploy: the gate must still appear *promptly*.
  The fix could over-correct into never gating, which unit tests cannot catch.
- Deploy alignment was considered and NOT done (dropping the `paths:` filters so both
  halves always ship together, plus blocking `--backend-only`). The structural fix
  makes the loop impossible regardless, but lockstep deploys would additionally keep
  the numbers accurate so the gate fires promptly. Open if desired.
