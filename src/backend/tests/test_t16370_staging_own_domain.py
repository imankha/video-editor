"""T16370: staging is served from reelballers.com so Safari keeps the session cookie.

Staging used to run its app on a pages.dev host and its API on a fly.dev host. Those
are two different sites, so the rb_session cookie the API set was a third-party cookie
and Safari dropped it. Staging now has the same shape as production: the app at
staging.reelballers.com and the API at api-staging.reelballers.com.

The Fly app name (reel-ballers-api-staging) and the Pages project name
(reel-ballers-staging) are identifiers, not hosts, and stay.
"""
import subprocess
import tomllib
from pathlib import Path

from app.services import email

BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parents[1]

STAGING_APP = "https://staging.reelballers.com"
STAGING_API = "https://api-staging.reelballers.com"

# Split so this file never matches its own scan.
OLD_HOSTS = r"reel-ballers-staging\.pages" + r"\.dev|reel-ballers-(api-)?staging\.fly" + r"\.dev"

# Dated records of past work: they describe what was true then and are not rewritten.
HISTORY = [":!docs/plans", ":!docs/testing/staging-verification-*"]


def test_staging_api_allows_only_the_reelballers_staging_app():
    env = tomllib.loads((BACKEND / "fly.staging.toml").read_text())["env"]
    assert env["CORS_ORIGINS"] == STAGING_APP


def test_staging_email_links_use_the_reelballers_hosts():
    assert email.API_BASE_MAP["staging"] == STAGING_API
    assert email.DOMAIN_MAP["staging"] == "staging.reelballers.com"


def test_no_code_workflow_or_doc_names_the_old_staging_hosts():
    found = subprocess.run(
        ["git", "grep", "-n", "-I", "-E", OLD_HOSTS, "--", ".", *HISTORY],
        cwd=REPO, capture_output=True, text=True,
    )
    assert found.returncode == 1, f"old staging hosts still named:\n{found.stdout}{found.stderr}"
