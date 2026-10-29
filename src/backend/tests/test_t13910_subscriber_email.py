"""T13910 -- subscriber email: opt-out on the users row, unsubscribe endpoint,
subscriber template (socials + tutorial + unsubscribe), and the send script's
test-before-mass-send gate.

Covered:
  - v037 adds users.email_opted_out_at + a distinct unsubscribe token per
    EXISTING user, and is idempotent
  - get_subscribed_recipients() excludes opted-out and test accounts
  - GET /api/email/unsubscribe works with NO session and opts the user out
  - POST (RFC 8058 one-click) opts out; /resubscribe clears it
  - an unknown token is a 404 and changes nothing
  - the subscriber email carries every social link, the tutorial, the
    unsubscribe link, and List-Unsubscribe headers + an Idempotency-Key
  - body_markdown_to_html escapes raw HTML and renders bullets/links
  - scripts/email_subscribers.py refuses a mass send whose exact content was
    never test-sent, or whose --confirm-count does not match
"""

import importlib.util
import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

_SCRIPT = Path(__file__).resolve().parents[3] / "scripts" / "email_subscribers.py"


@pytest.fixture()
def users(pg_conn):
    from app.services.auth_db import create_user
    from app.services.pg import get_pg
    create_user("user-a", email="sub-a@test.local")
    create_user("user-b", email="sub-b@test.local")
    create_user("user-c", email="sub-c@test.local")
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("UPDATE users SET is_test_account = true WHERE user_id = 'user-c'")


@pytest.fixture()
def client(users, tmp_path):
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db._initialized_user_dbs", set()):
        from app.main import app
        return TestClient(app, raise_server_exceptions=True)


def _token(user_id):
    from app.services.pg import get_pg
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT email_unsubscribe_token FROM users WHERE user_id = %s", (user_id,))
        return cur.fetchone()["email_unsubscribe_token"]


def _opted_out_at(user_id):
    from app.services.pg import get_pg
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT email_opted_out_at FROM users WHERE user_id = %s", (user_id,))
        return cur.fetchone()["email_opted_out_at"]


# ---------------------------------------------------------------------------
# Migration
# ---------------------------------------------------------------------------

def test_v037_backfills_distinct_tokens_and_is_idempotent(users):
    from app.migrations.postgres.v037_email_subscription import V037EmailSubscription
    from app.services.pg import get_pg
    with get_pg() as conn:
        cur = conn.cursor()
        # Simulate a pre-v037 DB holding real users.
        cur.execute("ALTER TABLE users DROP COLUMN IF EXISTS email_unsubscribe_token")
        cur.execute("ALTER TABLE users DROP COLUMN IF EXISTS email_opted_out_at")
        V037EmailSubscription().up(conn)
        V037EmailSubscription().up(conn)  # idempotent
        cur.execute(
            "SELECT user_id, email_unsubscribe_token, email_opted_out_at FROM users "
            "WHERE user_id IN ('user-a', 'user-b', 'user-c')"
        )
        rows = cur.fetchall()
    tokens = [r["email_unsubscribe_token"] for r in rows]
    assert len(rows) == 3
    assert all(tokens) and len(set(tokens)) == 3
    assert all(r["email_opted_out_at"] is None for r in rows)


def test_v037_registered_in_runner():
    from app.migrations.postgres import RUNNER
    assert RUNNER.latest_version >= 37


# ---------------------------------------------------------------------------
# Recipients
# ---------------------------------------------------------------------------

def test_subscribed_recipients_exclude_opted_out_and_test_accounts(users):
    from app.services.auth_db import get_subscribed_recipients, set_email_opt_out_by_token
    set_email_opt_out_by_token(_token("user-b"), True)
    ids = {r["user_id"] for r in get_subscribed_recipients()}
    assert "user-a" in ids
    assert "user-b" not in ids  # opted out
    assert "user-c" not in ids  # test account


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

def test_get_unsubscribe_without_session_opts_out(client):
    resp = client.get(f"/api/email/unsubscribe?token={_token('user-a')}")
    assert resp.status_code == 200
    assert "text/html" in resp.headers["content-type"]
    assert "unsubscribed" in resp.text.lower()
    assert "sub-a@test.local" in resp.text
    assert _opted_out_at("user-a") is not None
    assert _opted_out_at("user-b") is None


def test_post_one_click_unsubscribe_opts_out(client):
    resp = client.post(
        f"/api/email/unsubscribe?token={_token('user-a')}",
        data={"List-Unsubscribe": "One-Click"},
    )
    assert resp.status_code == 200
    assert _opted_out_at("user-a") is not None


def test_resubscribe_clears_opt_out(client):
    token = _token("user-a")
    client.get(f"/api/email/unsubscribe?token={token}")
    resp = client.post(f"/api/email/resubscribe?token={token}")
    assert resp.status_code == 200
    assert _opted_out_at("user-a") is None


def test_unknown_token_is_404_and_changes_nothing(client):
    resp = client.get("/api/email/unsubscribe?token=not-a-real-token")
    assert resp.status_code == 404
    assert _opted_out_at("user-a") is None


# ---------------------------------------------------------------------------
# Template + send
# ---------------------------------------------------------------------------

_SOCIALS = [
    "https://www.youtube.com/watch?v=ve2kwGGQL1o",
    "https://www.instagram.com/reelballers1",
    "https://youtube.com/@reelballers1",
    "https://www.tiktok.com/@reelballers1",
    "https://www.reddit.com/r/Reelballers",
    "https://discord.gg/sXWam8j9QT",
]


def test_subscriber_template_has_socials_tutorial_and_unsubscribe():
    from app.services.email import _build_update_email, body_markdown_to_html
    html = _build_update_email(
        "What's new", body_markdown_to_html("Hello"),
        unsubscribe_url="https://api.example/api/email/unsubscribe?token=tok123",
    )
    for url in _SOCIALS:
        assert url in html
    assert "https://api.example/api/email/unsubscribe?token=tok123" in html


def test_admin_update_email_has_no_unsubscribe_block():
    """The admin/reconciliation shell is unchanged when no unsubscribe_url."""
    from app.services.email import _build_update_email, body_text_to_html
    html = _build_update_email("Alert", body_text_to_html("x"))
    assert "unsubscribe" not in html.lower()


def test_body_markdown_escapes_html_and_renders_bullets_and_links():
    from app.services.email import body_markdown_to_html
    html = body_markdown_to_html(
        "Intro <script>x</script> **bold**\n\n- one\n- [Guide](https://reelballers.com/guides)"
    )
    assert "<script>" not in html
    assert "&lt;script&gt;" in html
    assert "<strong>bold</strong>" in html
    assert html.count("<li") == 2
    assert 'href="https://reelballers.com/guides"' in html


def test_markdown_link_rejects_non_http_scheme():
    from app.services.email import body_markdown_to_html
    html = body_markdown_to_html("[x](javascript:alert(1))")
    assert "href" not in html


@pytest.mark.asyncio
async def test_send_subscriber_email_sets_list_unsubscribe_and_idempotency(monkeypatch):
    from app.services import email as email_mod
    monkeypatch.setenv("RESEND_API_KEY", "re_test")
    resp = MagicMock(status_code=200, text="ok")
    post = AsyncMock(return_value=resp)
    fake_client = MagicMock()
    fake_client.__aenter__ = AsyncMock(return_value=MagicMock(post=post))
    fake_client.__aexit__ = AsyncMock(return_value=False)
    with patch.object(email_mod.httpx, "AsyncClient", return_value=fake_client):
        ok = await email_mod.send_subscriber_email(
            "sub-a@test.local", "Subj", "<p>b</p>",
            unsubscribe_url="https://api.example/api/email/unsubscribe?token=t",
            idempotency_key="camp/user-a",
        )
    assert ok is True
    kwargs = post.call_args.kwargs
    assert kwargs["headers"]["Idempotency-Key"] == "camp/user-a"
    payload = kwargs["json"]
    assert payload["to"] == ["sub-a@test.local"]
    assert payload["headers"]["List-Unsubscribe"] == "<https://api.example/api/email/unsubscribe?token=t>"
    assert payload["headers"]["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"


# ---------------------------------------------------------------------------
# Script gate
# ---------------------------------------------------------------------------

def _load_script():
    spec = importlib.util.spec_from_file_location("email_subscribers", _SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _message(tmp_path, body="Hello subscribers"):
    path = tmp_path / "2026-10-29-release.md"
    path.write_text(f"---\nsubject: What's new\nkind: release\n---\n{body}\n", encoding="utf-8")
    return path


def test_script_refuses_mass_send_without_test_send(tmp_path):
    mod = _load_script()
    msg = mod.load_message(_message(tmp_path))
    with pytest.raises(mod.SendRefused, match="test"):
        mod.check_send_allowed(msg, recipient_count=5, confirm_count=5)


def test_script_refuses_mass_send_after_content_edit(tmp_path):
    mod = _load_script()
    path = _message(tmp_path)
    mod.stamp(path, {"tested_hash": mod.load_message(path).content_hash, "tested_to": "x@test.local"})
    path.write_text(path.read_text(encoding="utf-8").replace("Hello", "Edited"), encoding="utf-8")
    with pytest.raises(mod.SendRefused, match="changed"):
        mod.check_send_allowed(mod.load_message(path), recipient_count=5, confirm_count=5)


def test_script_refuses_wrong_confirm_count_and_already_sent(tmp_path):
    mod = _load_script()
    path = _message(tmp_path)
    mod.stamp(path, {"tested_hash": mod.load_message(path).content_hash, "tested_to": "x@test.local"})
    msg = mod.load_message(path)
    with pytest.raises(mod.SendRefused, match="confirm"):
        mod.check_send_allowed(msg, recipient_count=5, confirm_count=4)
    mod.check_send_allowed(msg, recipient_count=5, confirm_count=5)  # allowed
    mod.stamp(path, {"sent_at": "2026-10-29T00:00:00Z"})
    with pytest.raises(mod.SendRefused, match="already"):
        mod.check_send_allowed(mod.load_message(path), recipient_count=5, confirm_count=5)


def test_script_stamp_preserves_body_and_hash(tmp_path):
    mod = _load_script()
    path = _message(tmp_path, body="Line 1\n\n- bullet")
    before = mod.load_message(path)
    mod.stamp(path, {"tested_hash": before.content_hash})
    after = mod.load_message(path)
    assert after.body == before.body
    assert after.subject == before.subject
    assert after.content_hash == before.content_hash
    assert after.meta["tested_hash"] == before.content_hash
    json.dumps(after.meta)  # plain strings only


# ---------------------------------------------------------------------------
# Review fixes
# ---------------------------------------------------------------------------

def test_bare_url_in_quotes_does_not_swallow_quote_entity():
    from app.services.email import body_markdown_to_html
    html = body_markdown_to_html('See "https://x.com" now')
    assert 'href="https://x.com"' in html


def test_url_with_balanced_parens_keeps_closing_paren():
    from app.services.email import body_markdown_to_html
    html = body_markdown_to_html("Read https://en.wikipedia.org/wiki/Foo_(bar).")
    assert 'href="https://en.wikipedia.org/wiki/Foo_(bar)"' in html


def test_bold_markers_never_land_inside_href():
    from app.services.email import body_markdown_to_html
    html = body_markdown_to_html("Go https://x.com/a**b**c and **bold**")
    assert "<strong>" not in html.split("</a>")[0].split('href="')[1].split('"')[0]
    assert "<strong>bold</strong>" in html


def test_non_http_markdown_link_leaves_no_stray_paren():
    from app.services.email import body_markdown_to_html
    html = body_markdown_to_html("[a](javascript:alert(1)) b")
    assert "href" not in html
    assert "a b" in html


def test_unsubscribe_page_sends_no_referrer(client):
    resp = client.get(f"/api/email/unsubscribe?token={_token('user-a')}")
    assert '<meta name="referrer" content="no-referrer">' in resp.text


@pytest.mark.asyncio
async def test_test_send_refuses_non_admin_recipient(users, tmp_path):
    mod = _load_script()
    msg = mod.load_message(_message(tmp_path))
    with pytest.raises(mod.SendRefused, match="admin"):
        await mod.cmd_test(msg, "dev", "sub-a@test.local")


@pytest.mark.asyncio
async def test_rehearsal_send_does_not_block_prod_send(users, tmp_path, monkeypatch):
    """A staging/dev --send stamps a rehearsal, never sent_at."""
    mod = _load_script()
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    monkeypatch.setattr(mod, "SEND_INTERVAL_S", 0)
    path = _message(tmp_path)
    msg = mod.load_message(path)
    mod.stamp(path, {"tested_hash": msg.content_hash, "tested_env": "dev", "tested_to": "x@test.local"})
    from app.services.auth_db import get_subscribed_recipients
    n = len(get_subscribed_recipients())
    await mod.cmd_send(mod.load_message(path), "dev", n)
    after = mod.load_message(path)
    assert "sent_at" not in after.meta
    assert after.meta.get("rehearsal_sent_at")
    mod.stamp(path, {"tested_env": "prod"})
    mod.check_send_allowed(mod.load_message(path), n, n, "prod")  # still allowed


def test_unsubscribe_page_shows_brand_logo(client):
    resp = client.get(f"/api/email/unsubscribe?token={_token('user-a')}")
    assert 'src="https://app.reelballers.com/icon-email.png"' in resp.text
    assert ">Reel<" in resp.text and ">Ballers<" in resp.text


# ---------------------------------------------------------------------------
# Letter-style emails: sender name, no heading, export segments
# ---------------------------------------------------------------------------

def test_template_can_omit_subject_heading():
    from app.services.email import _build_update_email, body_markdown_to_html
    html = _build_update_email(
        "Unique Subject Line", body_markdown_to_html("Hi there"),
        unsubscribe_url="https://api.example/u?token=t", show_heading=False,
    )
    assert "<h2" not in html
    assert "<title>Unique Subject Line</title>" in html


@pytest.mark.asyncio
async def test_send_subscriber_email_uses_from_name(monkeypatch):
    from app.services import email as email_mod
    monkeypatch.setenv("RESEND_API_KEY", "re_test")
    post = AsyncMock(return_value=MagicMock(status_code=200, text="ok"))
    fake_client = MagicMock()
    fake_client.__aenter__ = AsyncMock(return_value=MagicMock(post=post))
    fake_client.__aexit__ = AsyncMock(return_value=False)
    with patch.object(email_mod.httpx, "AsyncClient", return_value=fake_client):
        await email_mod.send_subscriber_email(
            "sub-a@test.local", "Subj", "<p>b</p>",
            unsubscribe_url="https://api.example/u?token=t", idempotency_key="k",
            from_name="Iman at ReelBallers",
        )
    assert post.call_args.kwargs["json"]["from"] == "Iman at ReelBallers <hello@reelballers.com>"


def test_subscribed_recipients_filter_by_export(users):
    from app.services.auth_db import get_subscribed_recipients
    from app.services.pg import get_pg
    with get_pg() as conn:
        conn.cursor().execute(
            "INSERT INTO user_actions (user_id, action, platform, count) VALUES ('user-a', 'export_completed', 'desktop', 2)"
        )
    exported = {r["user_id"] for r in get_subscribed_recipients(exported=True)}
    not_exported = {r["user_id"] for r in get_subscribed_recipients(exported=False)}
    assert "user-a" in exported and "user-a" not in not_exported
    assert "user-b" in not_exported and "user-b" not in exported


def test_script_parses_letter_options_and_hashes_them(tmp_path):
    mod = _load_script()
    path = tmp_path / "m.md"
    path.write_text(
        "---\nsubject: S\nkind: adhoc\nsegment: exported\nfrom_name: Iman at ReelBallers\nshow_heading: no\n---\nBody\n",
        encoding="utf-8",
    )
    msg = mod.load_message(path)
    assert msg.segment == "exported"
    assert msg.from_name == "Iman at ReelBallers"
    assert msg.show_heading is False
    other = mod.load_message(path)
    other.meta["segment"] = "not_exported"
    assert other.content_hash != msg.content_hash  # retargeting needs a new test send


def test_script_rejects_unknown_segment(tmp_path):
    mod = _load_script()
    path = tmp_path / "m.md"
    path.write_text("---\nsubject: S\nkind: adhoc\nsegment: vips\n---\nBody\n", encoding="utf-8")
    with pytest.raises(mod.SendRefused, match="segment"):
        mod.load_message(path)


def test_markdown_inline_image_https_only():
    from app.services.email import body_markdown_to_html
    html = body_markdown_to_html(
        "Click ![Report a problem](https://app.reelballers.com/email/report-problem.png) here"
    )
    assert '<img src="https://app.reelballers.com/email/report-problem.png" alt="Report a problem"' in html
    assert "Click <img" in html and "> here" in html
    bad = body_markdown_to_html("![x](http://evil.example/p.png) and ![y](javascript:1)")
    assert "<img" not in bad
