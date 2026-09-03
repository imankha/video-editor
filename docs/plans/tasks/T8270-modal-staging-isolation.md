# T8270: Give staging its own Modal app (stop sharing GPU render infra with prod)

**Status:** STAGING
**Impact:** 6
**Complexity:** 4
**Created:** 2026-09-01

## Problem

Discovered while shipping Tbug49p's fix (Modal export ignoring source fps, causing
slow/fast-motion output): **staging and production share the exact same Modal app**, so there
is no way to deploy a Modal-side fix "to staging first" to verify it before it goes live for
real paying users.

Confirmed:
- `app = modal.App("reel-ballers-video-v2")` (`app/modal_functions/video_processing.py:28`) —
  one hardcoded name, no environment suffix/parameterization.
- `MODAL_APP_NAME = "reel-ballers-video-v2"` (`app/services/modal_client.py:332`) — the backend
  client's function lookups (`modal.Function.from_name(MODAL_APP_NAME, ...)`) all resolve
  against that same single app, for every `render_overlay`/`process_clips_ai`/
  `process_framing_ai`/detection/compose function.
- Both `reel-ballers-api-staging` and `reel-ballers-api` (prod) have `MODAL_ENABLED=true`
  (confirmed live via `fly ssh console -C "printenv MODAL_ENABLED"` on both apps, 2026-09-01).

Net effect: `modal deploy app/modal_functions/video_processing.py` is NOT a staging-scoped
action — it redeploys the render pipeline for staging AND production simultaneously. Every
Modal-touching fix this project makes has to be treated as a de facto production deploy, with
no lower-risk staging soak period, and this stalls verification (Tbug49p's fix sat unverified
on staging for zero extra time only because the user explicitly accepted deploying straight to
prod-shared infra — that should not be the normal path).

## Solution

Give staging its own Modal app, mirroring how Fly already separates
`reel-ballers-api-staging` / `reel-ballers-api`:

1. Parameterize the Modal app name by environment — e.g.
   `f"reel-ballers-video-v2{'-staging' if APP_ENV == 'staging' else ''}"` — read once at
   import time in `video_processing.py` (mirrors how `fly.staging.toml`/`fly.production.toml`
   already set `APP_ENV`).
2. Update `modal_client.py`'s `MODAL_APP_NAME` to resolve the same way, so `Function.from_name`
   calls target the right app per environment automatically — no per-call-site changes needed
   beyond the one constant.
3. Update the deploy command/docs (`backend/CLAUDE.md`'s "Modal Functions" section, currently
   just `modal deploy app/modal_functions/video_processing.py`) to cover BOTH targets — likely
   two explicit invocations (one per `APP_ENV`, since `modal deploy` deploys whatever `app =
   modal.App(...)` resolves to under the CURRENT environment's env vars) or a thin wrapper
   script that does both with a `--staging-only` flag for the normal case.
4. Decide the default rollout order going forward: staging deploy + verify FIRST (real
   non-30fps upload, ffprobe check — see Tbug49p's task doc for the exact repro pattern that
   worked), THEN prod deploy, instead of one shared deploy covering both.

## Context

### Relevant Files
- `src/backend/app/modal_functions/video_processing.py:28` — `app = modal.App(...)` definition.
- `src/backend/app/modal_functions/video_processing_optimized.py:19` — a SECOND, separate Modal
  app (`reel-ballers-video-optimized`) — check whether it's live/used before deciding if it
  needs the same treatment, or if it's already dead code.
- `src/backend/app/services/modal_client.py:332` — `MODAL_APP_NAME` constant, single source of
  truth for every `Function.from_name` lookup in this file (8 call sites as of 2026-09-01).
- `src/backend/CLAUDE.md` — "Modal Functions" section, the `modal deploy` instruction that
  currently has no staging/prod distinction.
- `src/backend/fly.staging.toml` / `fly.production.toml` — existing `APP_ENV` precedent to
  mirror (`staging` / `production`).

### Technical Notes
- Modal apps are billed/quota'd independently per app name, so this doubles GPU function
  "slots" but each environment's actual usage should be low-volume (staging is test traffic
  only) — worth a quick cost sanity check before landing, not a blocker.
- Don't let this become a silent fallback: if `APP_ENV` is ever unset/misconfigured, name
  resolution should fail loudly (or default to a name that clearly can't collide with prod),
  never silently fall back to the shared prod app name.
- `.claude/knowledge/modal-gpu.md` should get a line about the per-environment app name once
  this lands — the "one Modal app, ask before redeploy" framing throughout that doc and
  `backend/CLAUDE.md` was written under the old shared-app assumption and needs updating in the
  same change (CLAUDE.md: "docs are claims, code is truth").

## Acceptance Criteria

- [ ] Staging and production resolve to DIFFERENT Modal app names (verifiable via `modal app
      list` or the Modal dashboard showing two `reel-ballers-video-v2*` apps).
- [ ] `modal deploy` from a staging-configured environment never touches the prod app, and
      vice versa — confirmed by deploying a trivial no-op change to staging only and checking
      prod's deployed function version is unchanged.
- [ ] `backend/CLAUDE.md` and `.claude/knowledge/modal-gpu.md` updated to describe the
      per-environment deploy flow and the new default rollout order (staging verify -> prod).
- [ ] `video_processing_optimized.py`'s status (live/dead) is resolved as part of this task,
      not left ambiguous.
