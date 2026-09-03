"""
T8270 -- per-environment Modal app name resolution.

Staging and production must target DIFFERENT Modal apps so a `modal deploy` can be
soaked on staging before it reaches prod's paying users. These are UNIT tests pinning:
  1. staging and production resolve to DIFFERENT, well-known names,
  2. an unrecognized/misconfigured APP_ENV FAILS LOUDLY (RuntimeError) instead of
     silently defaulting to the prod name -- the single most important invariant,
  3. the canonical resolver in `modal_client.py` and the byte-for-byte copy in
     `video_processing.py` agree for every environment (they cannot import each
     other -- the deployed Modal image does not mount the `app` package -- so this
     parity check is the only thing preventing silent drift between the two copies).
"""

import pytest

from app.modal_functions.video_processing import _resolve_modal_app_name as vp_resolve
from app.services.modal_client import resolve_modal_app_name


class TestResolveModalAppName:
    def test_production_name(self):
        assert resolve_modal_app_name("production") == "reel-ballers-video-v2"

    def test_staging_name(self):
        assert resolve_modal_app_name("staging") == "reel-ballers-video-v2-staging"

    def test_staging_and_production_differ(self):
        # AC1: staging and production resolve to DIFFERENT Modal app names.
        assert resolve_modal_app_name("staging") != resolve_modal_app_name("production")

    @pytest.mark.parametrize("env", ["dev", "development", "local", "test"])
    def test_dev_family_gets_distinct_non_prod_name(self, env):
        # Dev must not raise (backend must import in dev / in /dotask containers where
        # APP_ENV defaults to "dev"), but must never collide with the prod name.
        name = resolve_modal_app_name(env)
        assert name == "reel-ballers-video-v2-dev"
        assert name != resolve_modal_app_name("production")

    @pytest.mark.parametrize("bad", ["prod", "stage", "staging ", "", "PRODUCTION", "prd"])
    def test_unrecognized_env_raises_loudly(self, bad):
        # The core invariant: never silently fall back to the shared prod app name.
        with pytest.raises(RuntimeError, match="unrecognized APP_ENV"):
            resolve_modal_app_name(bad)


class TestResolverParity:
    """The two copies (they cannot import each other) must never drift."""

    @pytest.mark.parametrize(
        "env", ["production", "staging", "dev", "development", "local", "test"]
    )
    def test_both_copies_agree(self, env):
        assert resolve_modal_app_name(env) == vp_resolve(env)

    @pytest.mark.parametrize("bad", ["prod", "stage", "", "PRODUCTION"])
    def test_both_copies_raise_on_bad_env(self, bad):
        with pytest.raises(RuntimeError):
            resolve_modal_app_name(bad)
        with pytest.raises(RuntimeError):
            vp_resolve(bad)
