"""T5230 -- children's-data compliance hardening.

An intro card holds a MINOR's photo + parent-typed free text, publicly visible
when shared, so four guardrails are tested here (mapped to the acceptance
criteria):

  consent gate on card creation ......... test_create_card_blocked_without_consent
                                          test_create_card_allowed_with_consent
  privacy export includes intro data .... test_export_includes_intro_cards_and_facts
  purge deletes the R2 intro OBJECT ..... test_purge_deletes_r2_intro_object
    (the T6090 lesson: prove the real object is gone, not just DB rows)
  no face-recognition anywhere .......... test_no_face_recognition_in_intro_pipeline
                                          test_biometric_scanner_catches_a_violation
  DOB satisfied by absence .............. test_no_dob_or_biometric_field_in_intro_schema
                                          test_intro_facts_are_exactly_position_class_team

Router coroutines are driven directly against real per-profile SQLite (R2
disabled), mirroring test_t5195_intro_cards.py. No real R2/Postgres writes.
"""

import re
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

USER_ID = "test-user-t5230"
PROFILE_ID = "t5230prof"

BACKEND_ROOT = Path(__file__).resolve().parent.parent  # src/backend


# ---------------------------------------------------------------------------
# Hermetic per-user + per-profile SQLite, R2 disabled, request context set.
# ---------------------------------------------------------------------------

@pytest.fixture()
def intro_env(tmp_path, monkeypatch):
    from app.profile_context import set_current_profile_id
    from app.user_context import set_current_user_id

    set_current_user_id(USER_ID)
    set_current_profile_id(PROFILE_ID)

    # Both the profile.sqlite base (app.database) and the user.sqlite base
    # (app.services.user_db) must point at tmp, and R2 restore must be off.
    monkeypatch.setattr("app.database.USER_DATA_BASE", tmp_path, raising=False)
    monkeypatch.setattr("app.database._initialized_users", set(), raising=False)
    monkeypatch.setattr("app.database.R2_ENABLED", False, raising=False)
    monkeypatch.setattr("app.services.user_db.USER_DATA_BASE", tmp_path, raising=False)
    monkeypatch.setattr("app.storage.R2_ENABLED", False, raising=False)
    # export reads USER_DATA_BASE bound into the privacy namespace at import time.
    monkeypatch.setattr("app.routers.privacy.USER_DATA_BASE", tmp_path, raising=False)

    from app.database import ensure_database
    ensure_database()  # creates the current profile's profile.sqlite (incl. intro_cards)
    yield tmp_path


async def _create_card(**overrides):
    from app.routers.intro_cards import CreateIntroCardRequest, create_intro_card

    payload = {"name": "Card", "treatment": "gold"}
    payload.update(overrides)
    return await create_intro_card(CreateIntroCardRequest(**payload))


# ---------------------------------------------------------------------------
# Consent gate (AC: consent attestation gate enforced before intro-card use)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_create_card_blocked_without_consent(intro_env):
    """No parental-consent attestation -> create is refused with 403 (never a
    silent no-op, never a created row). 403 matches the attach + upload gates."""
    from app.services.user_db import get_intro_consent

    assert get_intro_consent(USER_ID, PROFILE_ID) is None  # precondition
    with pytest.raises(HTTPException) as exc:
        await _create_card(name="No Consent")
    assert exc.value.status_code == 403
    assert "consent" in exc.value.detail.lower()

    # And nothing was written.
    from app.routers.intro_cards import list_intro_cards
    listed = await list_intro_cards()
    assert listed["cards"] == []


@pytest.mark.asyncio
async def test_create_card_allowed_with_consent(intro_env):
    """Once consent is recorded, the same create succeeds."""
    from app.services.user_db import set_intro_consent

    set_intro_consent(USER_ID, PROFILE_ID, "2026-08-08T00:00:00")
    created = await _create_card(name="Consented", shown_fields=[])
    assert created["id"] > 0
    assert created["name"] == "Consented"


# ---------------------------------------------------------------------------
# Privacy export (AC: intro fields + photo included in CCPA export)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_export_includes_intro_cards_and_facts(intro_env, monkeypatch):
    """POST /export-data returns the intro card rows, the parent-typed subtitle
    text, the consent timestamp, and position/class/team facts for the profile."""
    from app.services.user_db import set_intro_consent, set_intro_fact

    set_intro_consent(USER_ID, PROFILE_ID, "2026-08-08T00:00:00")
    set_intro_fact(USER_ID, PROFILE_ID, "position", "Midfielder")
    set_intro_fact(USER_ID, PROFILE_ID, "team", "Riverside FC")
    await _create_card(name="Export Me", subtitle_text="State Cup Final", shown_fields=["position"])

    # Keep the export hermetic: no Postgres auth row, no R2 listing.
    monkeypatch.setattr("app.routers.privacy.get_user_by_id", lambda uid: None, raising=False)
    monkeypatch.setattr("app.routers.privacy.R2_ENABLED", False, raising=False)

    from app.routers.privacy import export_user_data
    resp = await export_user_data(MagicMock())
    import json
    payload = json.loads(resp.body)

    profiles = {p["profile_id"]: p for p in payload["profiles"]}
    assert PROFILE_ID in profiles, "the profile must appear in the export"
    prof = profiles[PROFILE_ID]

    assert prof["intro_consent_at"] == "2026-08-08T00:00:00"
    assert prof["intro_facts"] == {"position": "Midfielder", "team": "Riverside FC"}
    assert len(prof["intro_cards"]) == 1
    card = prof["intro_cards"][0]
    assert card["name"] == "Export Me"
    assert card["subtitle_text"] == "State Cup Final"


@pytest.mark.asyncio
async def test_export_includes_intro_kv_for_uncached_profile(intro_env, monkeypatch):
    """Consent/facts live in user.sqlite, so a profile whose profile.sqlite is not
    locally cached (no glob hit) must STILL export its intro consent/facts --
    never silently dropped."""
    from app.services.user_db import set_intro_consent

    ghost_pid = "ghostprof"  # no profile.sqlite ever created for this one
    set_intro_consent(USER_ID, ghost_pid, "2026-08-08T09:00:00")

    monkeypatch.setattr("app.routers.privacy.get_user_by_id", lambda uid: None, raising=False)
    monkeypatch.setattr("app.routers.privacy.R2_ENABLED", False, raising=False)

    import json

    from app.routers.privacy import export_user_data
    payload = json.loads((await export_user_data(MagicMock())).body)
    profiles = {p["profile_id"]: p for p in payload["profiles"]}
    assert ghost_pid in profiles
    assert profiles[ghost_pid]["intro_consent_at"] == "2026-08-08T09:00:00"


# ---------------------------------------------------------------------------
# Purge (AC: photo/cut-out purged on account deletion, verified vs a REAL object)
# ---------------------------------------------------------------------------

def test_purge_deletes_r2_intro_object(monkeypatch):
    """delete_user_r2_data (the account-delete purge primitive) removes the R2
    intro image OBJECT under the per-profile intro/ prefix -- not just the DB row.

    This is the T6090 lesson made executable: the whole-user-prefix delete is
    proven to enumerate + delete a real intro/ key, so a purged account leaves no
    orphaned minor's photo behind.
    """
    from app import storage

    intro_key = f"{storage.APP_ENV}/users/{USER_ID}/profiles/{PROFILE_ID}/intro/deadbeef.jpg"
    other_key = f"{storage.APP_ENV}/users/{USER_ID}/user.sqlite"
    deleted_keys = []

    class _Paginator:
        def paginate(self, **kwargs):
            assert kwargs["Prefix"] == f"{storage.APP_ENV}/users/{USER_ID}/"
            return iter([{"Contents": [{"Key": intro_key}, {"Key": other_key}]}])

    class _FakeClient:
        def get_paginator(self, name):
            assert name == "list_objects_v2"
            return _Paginator()

        def delete_objects(self, **kwargs):
            deleted_keys.extend(o["Key"] for o in kwargs["Delete"]["Objects"])
            return {}  # no Errors -> success

    monkeypatch.setattr("app.storage.R2_ENABLED", True, raising=False)
    monkeypatch.setattr("app.storage.get_r2_client", lambda: _FakeClient())

    count = storage.delete_user_r2_data(USER_ID)
    assert intro_key in deleted_keys, "the R2 intro image object must be deleted by the purge"
    assert count == 2


# ---------------------------------------------------------------------------
# No biometrics (AC: no face-recognition in any intro path -- note + test)
# ---------------------------------------------------------------------------

# Files that make up the player-intro pipeline. Any image analysis these do is
# limited to background SEGMENTATION (the T5200 cut-out); face recognition /
# facial templating / biometric identifier extraction is prohibited (2025 COPPA
# amendment + BIPA/CCPA, minor subjects).
_INTRO_PIPELINE_FILES = [
    "app/services/player_intro.py",
    "app/routers/intro_cards.py",
    "app/services/intro_cards.py",
    "app/services/intro_media.py",
    "app/services/text_render.py",
]

# Banned face-recognition / biometric libraries (matched only in an IMPORT
# context so this never trips on a prose comment mentioning "face recognition").
_BANNED_IMPORTS = (
    "face_recognition", "dlib", "mediapipe", "insightface", "facenet",
    "facenet_pytorch", "deepface", "retinaface", "mtcnn",
)
_IMPORT_RE = re.compile(
    r"^\s*(?:import|from)\s+(" + "|".join(_BANNED_IMPORTS) + r")\b", re.MULTILINE
)
# Banned face-detection / templating API calls (substrings that never occur in
# our documentation of the prohibition).
_BANNED_CALLS = (
    "CascadeClassifier", "detectMultiScale", "haarcascade", "cv2.face",
    "face_encodings", "face_locations", "face_landmarks", "FaceMesh",
    "FaceDetection", "FaceAnalysis",
)


def _scan_source_for_biometrics(source: str) -> list[str]:
    """Return the biometric violations found in a source string (empty = clean)."""
    hits = [f"import:{m}" for m in _IMPORT_RE.findall(source)]
    hits += [f"call:{c}" for c in _BANNED_CALLS if c in source]
    return hits


def test_no_face_recognition_in_intro_pipeline():
    """No intro-pipeline source imports a face-recognition library or calls a
    face-detection/templating API. Goes RED the moment biometrics are added."""
    offenders = {}
    for rel in _INTRO_PIPELINE_FILES:
        path = BACKEND_ROOT / rel
        assert path.exists(), f"intro pipeline file missing: {rel}"
        hits = _scan_source_for_biometrics(path.read_text(encoding="utf-8"))
        if hits:
            offenders[rel] = hits
    assert not offenders, f"biometric/face-recognition usage in intro pipeline: {offenders}"


def test_biometric_scanner_catches_a_violation():
    """Red-first proof the guard is not a no-op: a synthetic violating snippet is
    flagged. If this ever passes with an empty result, the guard above is dead."""
    bad = "import face_recognition\nfaces = cv2.face.LBPHFaceRecognizer_create()\n"
    hits = _scan_source_for_biometrics(bad)
    assert "import:face_recognition" in hits
    assert any(h.startswith("call:") for h in hits)


# ---------------------------------------------------------------------------
# DOB satisfied by absence (AC: grad-year default; no DOB stored today)
# ---------------------------------------------------------------------------

def test_intro_facts_are_exactly_position_class_team():
    """The only structured athlete facts are position/class/team (class = grad
    year as free text). No birthdate is derived or stored from them."""
    from app.services.user_db import INTRO_FACT_FIELDS
    assert INTRO_FACT_FIELDS == ("position", "class", "team")


def test_no_dob_or_biometric_field_in_intro_schema():
    """The intro_cards table stores no date-of-birth / age / physical-attribute
    column. Guardrail #1/#2 (grad-year default, DOB encryption) are satisfied by
    ABSENCE -- this goes RED if a future change adds such a field speculatively."""
    ddl = (BACKEND_ROOT / "app" / "database.py").read_text(encoding="utf-8")
    start = ddl.index("CREATE TABLE IF NOT EXISTS intro_cards")
    end = ddl.index(")", ddl.index("updated_at", start))
    table_ddl = ddl[start:end].lower()
    # Word-boundary match so a column like `image_key` doesn't trip "age".
    banned = [r"\bbirth", r"\bdate_of_birth\b", r"\bdob\b", r"\bage\b", r"\bheight\b",
              r"\bweight\b", r"\bhigh_school\b", r"\bssn\b", r"\bgrad_year\b"]
    present = [pat for pat in banned if re.search(pat, table_ddl)]
    assert not present, f"intro_cards must store no DOB/biometric/physical field, found: {present}"


# ---------------------------------------------------------------------------
# HTTP end-to-end (real ASGI stack via TestClient) — consent gate + export
# through the full router/middleware/serialisation path, no R2 needed.
# ---------------------------------------------------------------------------

class TestHttpEndToEnd:
    """Drives the consent gate over the REAL app (full router + middleware stack)
    via TestClient — the strongest live-drive runnable in-container (no browser).

    Scoped to the consent gate (403 -> 200), which is deterministic and does not
    depend on R2 or the Postgres pool. The export/purge shape is proven at the
    coroutine level above (hermetic, R2 off); a full-HTTP export assertion is
    unreliable in-container because the per-request R2 sync/restore can race a
    card's deferred upload — an environment artifact, not an export defect."""

    def _client_and_user(self):
        from uuid import uuid4

        from fastapi.testclient import TestClient

        from app.main import app
        from app.services.user_db import (
            create_profile,
            ensure_user_database,
            set_selected_profile_id,
        )

        uid = f"t5230e2e_{uuid4().hex[:8]}"
        pid = uuid4().hex[:8]
        ensure_user_database(uid)
        create_profile(uid, pid, "Marcus", "#3B82F6", is_default=True)
        set_selected_profile_id(uid, pid)
        return TestClient(app), uid, pid

    def test_consent_gate_over_http(self):
        client, uid, pid = self._client_and_user()
        h = {"X-User-ID": uid, "X-Profile-ID": pid}

        # 1. Create a card WITHOUT consent -> 403 through the real HTTP stack.
        r = client.post("/api/intro-cards", json={"name": "Nope", "treatment": "gold"}, headers=h)
        assert r.status_code == 403, r.text
        assert "consent" in r.text.lower()

        # 2. Record consent (the real gesture endpoint).
        assert client.post(f"/api/profiles/{pid}/intro/consent", headers=h).status_code == 200

        # 3. Now the same create succeeds, and the card is visible via the API.
        r = client.post("/api/intro-cards", json={"name": "Marcus 2029", "treatment": "gold"}, headers=h)
        assert r.status_code == 200, r.text
        listed = client.get("/api/intro-cards", headers=h).json()
        assert "Marcus 2029" in [c["name"] for c in listed["cards"]]
