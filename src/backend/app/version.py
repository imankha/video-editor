"""
T5070: backend deploy version, advertised via X-App-Version header + GET /api/version
so the frontend update-gate handshake can detect a backend-only deploy (one that
produces no new service worker, so the PWA update prompt would otherwise never fire).

Sourced from the COMMIT_SHA build-arg baked into the Docker image at deploy time
(see Dockerfile, .github/workflows/deploy-backend.yml, scripts/deploy_production.sh).
Falls back to "dev" for local/uvicorn runs where no image build occurred.
"""

import os

APP_VERSION = os.getenv("COMMIT_SHA", "dev")
