"""Cookie helpers with CHIPS (Partitioned) support.

Chrome 114+ blocks cross-site cookies unless they include the Partitioned
attribute. Production (app.reelballers.com -> reel-ballers-api.fly.dev) is
cross-site, so session cookies need Partitioned to be stored by the browser.

Starlette's set_cookie() doesn't support Partitioned, so we build the
Set-Cookie header manually.
"""

import os

_SECURE_COOKIES = os.getenv("SECURE_COOKIES", "false").lower() == "true"

_30_DAYS = 30 * 24 * 60 * 60


def set_cookie(response, key, value, max_age=_30_DAYS, httponly=True, path="/"):
    parts = [f"{key}={value}", f"Max-Age={max_age}", f"Path={path}"]
    if httponly:
        parts.append("HttpOnly")
    if _SECURE_COOKIES:
        parts.extend(["Secure", "SameSite=None", "Partitioned"])
    else:
        parts.append("SameSite=Lax")
    response.headers.append("set-cookie", "; ".join(parts))


def delete_cookie(response, key, path="/"):
    parts = [f"{key}=", "Max-Age=0", f"Path={path}"]
    if _SECURE_COOKIES:
        parts.extend(["Secure", "SameSite=None", "Partitioned"])
    else:
        parts.append("SameSite=Lax")
    response.headers.append("set-cookie", "; ".join(parts))
