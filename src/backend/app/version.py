"""
Backend deploy version, advertised via X-App-Version + X-App-Build headers and
GET /api/version so the frontend update gate can tell whether the running client
is behind the deployed server.

- APP_VERSION (commit sha): human/log correlation, bug-report attribution. NOT
  orderable (git shas have no < relation), so it is NOT used for the gate decision.
- APP_BUILD (Tbug40p): a MONOTONIC, orderable integer = `git rev-list --count HEAD`,
  identical for the frontend and the backend built from the same commit. This is the
  truth the gate compares: the client gates only when serverBuild > its own baked
  __APP_BUILD__ (strictly). A straggler machine on an older build advertises a LOWER
  number and so can never falsely trigger a gate (mixed-fleet safe).

Both are sourced from build-args baked into the Docker image at deploy time (see
Dockerfile, .github/workflows/deploy-backend.yml, scripts/deploy_production.sh).
Local/uvicorn runs get APP_VERSION="dev" and APP_BUILD=0 — and 0 > N is always false,
so a dev server never gates a real client (a missing/unset build is inert, never a
false gate).
"""

import os

APP_VERSION = os.getenv("COMMIT_SHA", "dev")
APP_BUILD = int(os.getenv("APP_BUILD", "0"))
