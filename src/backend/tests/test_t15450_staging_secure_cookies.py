"""T15450: staging sign-in does not survive a reload in Safari-class browsers.

Staging's frontend (reel-ballers-staging.pages.dev) and backend
(reel-ballers-api-staging.fly.dev) are on different sites, so the rb_session
cookie is cross-site there. `app/utils/cookies.py` only emits the cross-site-safe
`SameSite=None; Secure; Partitioned` cookie when `SECURE_COOKIES=true`; otherwise
it falls back to `SameSite=Lax`, which browsers (notably Safari/WebKit) refuse to
send on cross-site fetch/XHR requests like the reload-time `/auth/me` call --
exactly the reported symptom (401, no rb_session cookie after reload).

fly.staging.toml must set SECURE_COOKIES=true so staging's cookie uses the
cross-site-safe branch, matching how prod's same-site deployment already works
under SameSite=Lax.
"""
import tomllib
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]


def _env(name):
    config = tomllib.loads((BACKEND / name).read_text())
    return config["env"]


def test_staging_sets_secure_cookies_true_for_its_cross_site_deployment():
    env = _env("fly.staging.toml")
    assert env.get("SECURE_COOKIES") == "true", (
        "staging's frontend (pages.dev) and backend (fly.dev) are cross-site, "
        "so SECURE_COOKIES must be true so app/utils/cookies.py emits "
        "SameSite=None; Secure; Partitioned (the cross-site-safe cookie) "
        "instead of SameSite=Lax, which Safari refuses on cross-site fetches"
    )
