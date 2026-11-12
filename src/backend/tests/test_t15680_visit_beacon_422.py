"""T15680: visit beacon POST /api/t returned 422 on some page loads.

Root cause (expert-confirmed, 2026-11-12): `report_visit` took `payload:
VisitBeaconReport` as a FastAPI-parsed parameter, so FastAPI decides whether to
JSON-decode the body from the request's Content-Type header. A `navigator.
sendBeacon(url, new Blob([body], {type: 'application/json'}))` call is a
cross-origin request whose Blob type isn't CORS-safelisted, and some mobile
browser contexts resend it with a different/rewritten Content-Type (e.g.
`text/plain`) rather than `application/json`. FastAPI then hands the RAW BYTES
to Pydantic instead of parsing them as JSON first, and Pydantic v2 cannot build
`VisitBeaconReport` from bytes -- 422 `model_attributes_type`, even though the
JSON body itself was perfectly well-formed (valid, non-empty page_class).

Fix: read the raw body ourselves and decode it with `model_validate_json`,
which is independent of the Content-Type header, instead of letting FastAPI's
automatic header-driven decoding run. This also makes truly malformed/missing
bodies (empty payload, invalid JSON) fall through to a logged 204 drop rather
than a 422, matching this endpoint's "always 204" fire-and-forget contract.
"""

from fastapi.testclient import TestClient


def _client():
    from app.main import app
    return TestClient(app, raise_server_exceptions=True)


def test_visit_beacon_returns_204_for_valid_json_with_non_json_content_type():
    """The exact mechanism: well-formed JSON body, but Content-Type isn't
    application/json -- reproduces the mobile-tester's observed 422."""
    client = _client()
    resp = client.post(
        "/api/t",
        content=b'{"page_class": "app"}',
        headers={"Content-Type": "text/plain;charset=UTF-8"},
    )
    assert resp.status_code == 204


def test_visit_beacon_returns_204_for_valid_json_with_no_content_type():
    client = _client()
    resp = client.post(
        "/api/t",
        content=b'{"page_class": "app"}',
        headers={"Content-Type": ""},
    )
    assert resp.status_code == 204


def test_visit_beacon_returns_204_for_truly_empty_body():
    client = _client()
    resp = client.post("/api/t", content=b"")
    assert resp.status_code == 204


def test_visit_beacon_returns_204_for_malformed_json_body():
    client = _client()
    resp = client.post(
        "/api/t",
        content=b"not json at all",
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 204


def test_visit_beacon_still_returns_204_and_records_for_well_formed_request():
    """Regression: the normal path (real JSON content-type, full payload)
    still works after the parsing change."""
    client = _client()
    resp = client.post(
        "/api/t",
        json={
            "page_class": "landing",
            "ref": None,
            "utm_campaign": None,
            "click_id": "fbclid",
            "referrer_host": None,
        },
    )
    assert resp.status_code == 204
