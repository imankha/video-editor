"""The app's public origin, for links the backend hands out.

In dev: localhost:5173; in staging/prod: the first CORS_ORIGINS entry.
"""

import os

from .storage import APP_ENV

_cors = os.getenv("CORS_ORIGINS", "")
FRONTEND_URL = _cors.split(",")[0].strip() if _cors else "http://localhost:5173"

# T13980: campaign links point at the marketing site on prod (it relays ?ref=
# into the app); dev/staging links go straight to that env's app so a campaign
# created there attributes there.
CAMPAIGN_LINK_BASE = "https://reelballers.com" if APP_ENV == "production" else FRONTEND_URL
