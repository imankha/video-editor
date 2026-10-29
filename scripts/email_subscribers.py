"""
T13910: email every subscribed user (no opt-out, not a test account).

One message file per campaign under docs/emails/ (see docs/emails/README.md):

    ---
    subject: What's new in ReelBallers
    kind: release        (release | adhoc)
    ---
    Markdown-ish body: paragraphs, "- " bullets, **bold**, [label](https://...).

The branded template adds the tutorial button, every social link, and a
per-user unsubscribe link (users.email_unsubscribe_token).

Three steps, always in this order:

    cd src/backend
    .venv/Scripts/python.exe ../../scripts/email_subscribers.py docs/emails/<file>.md --env prod --preview
    .venv/Scripts/python.exe ../../scripts/email_subscribers.py docs/emails/<file>.md --env prod --test [--to EMAIL]
    # ...the human reads the test email and explicitly approves...
    .venv/Scripts/python.exe ../../scripts/email_subscribers.py docs/emails/<file>.md --env prod --send --confirm-count N

Gate (enforced here, not by convention): --send refuses unless --test already
went out in the SAME env for the EXACT current subject+body (the test stamps a
content hash into the file's frontmatter; any edit invalidates it), unless
--confirm-count equals the live recipient count, and once the file is stamped
sent_at. A crashed or partial send is safe to re-run within 24h: every send
carries a Resend Idempotency-Key of <campaign>/<user_id>.

Remote envs need the Postgres proxy running (DATABASE_URL in .env.<env>):
    fly proxy 15433:5432 -a reel-ballers-db-prod
    fly proxy 15432:5432 -a reel-ballers-db-staging
"""

import argparse
import asyncio
import hashlib
import os
import sys
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = PROJECT_ROOT / "src" / "backend"
DEFAULT_TEST_TO = "imankh@gmail.com"
APP_ENV_FOR = {"dev": "dev", "staging": "staging", "prod": "production"}
KINDS = ("release", "adhoc")
# segment -> get_subscribed_recipients(exported=...); "has exported" = the
# export_completed analytics action.
SEGMENTS = {"all": None, "exported": True, "not_exported": False}
YES_NO = {"yes": True, "no": False}
# Resend's default team rate limit is 2 requests/second.
SEND_INTERVAL_S = 0.6


class SendRefused(Exception):
    pass


@dataclass
class Message:
    path: Path
    meta: dict
    body: str

    @property
    def subject(self) -> str:
        return self.meta["subject"]

    @property
    def segment(self) -> str:
        return self.meta.get("segment", "all")

    @property
    def from_name(self) -> str | None:
        return self.meta.get("from_name") or None

    @property
    def show_heading(self) -> bool:
        return YES_NO[self.meta.get("show_heading", "yes")]

    @property
    def content_hash(self) -> str:
        """Covers everything the recipient sees AND who receives it, so any
        retargeting or restyling after a test send needs a new test send."""
        key = f"{self.subject}\n{self.segment}\n{self.from_name}\n{self.show_heading}\n{self.body}"
        return hashlib.sha256(key.encode()).hexdigest()[:16]

    @property
    def campaign(self) -> str:
        return f"{self.path.stem}-{self.content_hash}"


def _split(text: str) -> tuple[list[str], str]:
    text = text.replace("\r\n", "\n")
    if not text.startswith("---\n"):
        raise SendRefused("message file must start with a '---' frontmatter block")
    end = text.find("\n---\n", 4)
    if end == -1:
        raise SendRefused("message file frontmatter is not closed with '---'")
    return text[4:end].split("\n"), text[end + 5:]


def load_message(path: Path) -> Message:
    header, body = _split(Path(path).read_text(encoding="utf-8"))
    meta = {}
    for line in header:
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        key, sep, value = line.partition(":")
        if not sep:
            raise SendRefused(f"bad frontmatter line: {line!r}")
        meta[key.strip()] = value.strip()
    if not meta.get("subject"):
        raise SendRefused("frontmatter needs a non-empty 'subject'")
    if meta.get("kind") not in KINDS:
        raise SendRefused(f"frontmatter 'kind' must be one of {KINDS}")
    if meta.get("segment", "all") not in SEGMENTS:
        raise SendRefused(f"frontmatter 'segment' must be one of {tuple(SEGMENTS)}")
    if meta.get("show_heading", "yes") not in YES_NO:
        raise SendRefused("frontmatter 'show_heading' must be yes or no")
    if not body.strip():
        raise SendRefused("message body is empty")
    return Message(Path(path), meta, body.strip("\n"))


def stamp(path: Path, updates: dict) -> None:
    """Merge `updates` into the frontmatter; the body is rewritten byte-for-byte."""
    header, body = _split(Path(path).read_text(encoding="utf-8"))
    lines = []
    seen = set()
    for line in header:
        key = line.partition(":")[0].strip()
        if key in updates:
            lines.append(f"{key}: {updates[key]}")
            seen.add(key)
        else:
            lines.append(line)
    lines += [f"{k}: {v}" for k, v in updates.items() if k not in seen]
    Path(path).write_text("---\n" + "\n".join(lines) + "\n---\n" + body, encoding="utf-8")


def check_send_allowed(msg: Message, recipient_count: int, confirm_count: int | None, env: str | None = None) -> None:
    if msg.meta.get("sent_at"):
        raise SendRefused(f"already sent at {msg.meta['sent_at']}; copy it to a new file for a new campaign")
    tested = msg.meta.get("tested_hash")
    if not tested:
        raise SendRefused("this message was never test-sent; run --test first and get approval")
    if tested != msg.content_hash:
        raise SendRefused("subject/body changed since the test send; run --test again and get approval")
    if env is not None and msg.meta.get("tested_env") != env:
        raise SendRefused(f"the test send was in env {msg.meta.get('tested_env')!r}, not {env!r}; run --test in {env}")
    if confirm_count != recipient_count:
        raise SendRefused(f"--confirm-count {confirm_count} does not match the {recipient_count} live recipients")


def _now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _load_env(env: str) -> None:
    """Point the backend modules at the target env before importing them."""
    from dotenv import dotenv_values

    env_file = PROJECT_ROOT / (".env" if env == "dev" else f".env.{env}")
    if not env_file.exists():
        sys.exit(f"ERROR: {env_file} not found")
    values = dotenv_values(env_file)
    for key in ("DATABASE_URL", "RESEND_API_KEY"):
        if values.get(key):
            os.environ[key] = values[key]
        else:
            os.environ.pop(key, None)
    if not os.environ.get("DATABASE_URL"):
        sys.exit(f"ERROR: DATABASE_URL missing from {env_file}")
    if env != "dev" and not os.environ.get("RESEND_API_KEY"):
        sys.exit(f"ERROR: RESEND_API_KEY missing from {env_file}; refusing a dev-mode (log-only) send to {env}")
    os.environ["APP_ENV"] = APP_ENV_FOR[env]
    sys.path.insert(0, str(BACKEND_DIR))


def _connect() -> None:
    from app.services import pg
    try:
        pg.init_pg_pool()
    except RuntimeError as e:
        sys.exit(
            f"ERROR: cannot reach Postgres ({e}).\n"
            "  prod:    fly proxy 15433:5432 -a reel-ballers-db-prod\n"
            "  staging: fly proxy 15432:5432 -a reel-ballers-db-staging"
        )


def cmd_preview(msg: Message, env: str) -> None:
    from app.services.auth_db import get_subscribed_recipients
    from app.services.email import _build_update_email, body_markdown_to_html, build_unsubscribe_url

    html = _build_update_email(
        msg.subject, body_markdown_to_html(msg.body),
        unsubscribe_url=build_unsubscribe_url("PREVIEW-TOKEN", APP_ENV_FOR[env]),
        show_heading=msg.show_heading,
    )
    out = msg.path.with_suffix(".preview.html")
    out.write_text(html, encoding="utf-8")
    recipients = get_subscribed_recipients(exported=SEGMENTS[msg.segment])
    print(f"Subject:    {msg.subject}")
    print(f"Preview:    {out}  (gitignored; open it in a browser)")
    print(f"Recipients: {len(recipients)} subscribed users in {env} (segment: {msg.segment})")


async def cmd_test(msg: Message, env: str, to: str) -> None:
    from app.services.auth_db import get_admin_emails, get_email_subscription_by_email
    from app.services.email import body_markdown_to_html, build_unsubscribe_url, send_subscriber_email

    if to.lower().strip() not in {e.lower() for e in get_admin_emails()}:
        raise SendRefused(f"{to} is not an admin in {env}; a [TEST] copy only ever goes to an admin_users address")
    user = get_email_subscription_by_email(to)
    if not user:
        raise SendRefused(f"{to} is not a user in {env}; the test must use a real account so its unsubscribe link works")
    ok = await send_subscriber_email(
        to, f"[TEST] {msg.subject}", body_markdown_to_html(msg.body),
        unsubscribe_url=build_unsubscribe_url(user["email_unsubscribe_token"], APP_ENV_FOR[env]),
        idempotency_key=f"test-{msg.campaign}-{int(time.time())}",
        from_name=msg.from_name, show_heading=msg.show_heading,
    )
    if not ok:
        sys.exit("ERROR: test send failed (see log above); nothing stamped")
    stamp(msg.path, {"tested_hash": msg.content_hash, "tested_env": env, "tested_to": to, "tested_at": _now()})
    print(f"Test email sent to {to} ({env}). Stamped tested_hash={msg.content_hash}.")
    print("Waiting on human approval before --send. Any edit to subject/body requires a new --test.")


async def cmd_send(msg: Message, env: str, confirm_count: int | None) -> None:
    from app.services.auth_db import get_subscribed_recipients
    from app.services.email import body_markdown_to_html, build_unsubscribe_url, send_subscriber_email

    recipients = get_subscribed_recipients(exported=SEGMENTS[msg.segment])
    check_send_allowed(msg, len(recipients), confirm_count, env)
    body_html = body_markdown_to_html(msg.body)
    failed = []
    print(f"Sending '{msg.subject}' to {len(recipients)} subscribers in {env} (campaign {msg.campaign})")
    for i, r in enumerate(recipients, 1):
        ok = await send_subscriber_email(
            r["email"], msg.subject, body_html,
            unsubscribe_url=build_unsubscribe_url(r["email_unsubscribe_token"], APP_ENV_FOR[env]),
            idempotency_key=f"{msg.campaign}/{r['user_id']}",
            from_name=msg.from_name, show_heading=msg.show_heading,
        )
        if not ok:
            failed.append(r["email"])
        if i % 25 == 0 or i == len(recipients):
            print(f"  {i}/{len(recipients)} processed, {len(failed)} failed")
        time.sleep(SEND_INTERVAL_S)

    sent = len(recipients) - len(failed)
    if failed:
        stamp(msg.path, {"partial_send_at": _now(), "partial_sent_count": sent, "partial_failed_count": len(failed)})
        print(f"\n{len(failed)} FAILED: {', '.join(failed)}")
        print("Re-run the same --send command WITHIN 24h: Resend's Idempotency-Key skips everyone already delivered.")
        sys.exit(1)
    if env != "prod":
        # A staging/dev run is a rehearsal: it must never block the real prod send.
        stamp(msg.path, {"rehearsal_sent_at": _now(), "rehearsal_env": env, "rehearsal_count": sent})
        print(f"\nRehearsal done in {env}: {sent} sent. The prod send still needs --test --env prod first.")
        return
    stamp(msg.path, {"sent_at": _now(), "sent_env": env, "sent_count": sent})
    print(f"\nDone: {sent} sent, 0 failed. Stamped sent_at. Commit the message file as the send record.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("message", type=Path, help="docs/emails/<date>-<slug>.md")
    parser.add_argument("--env", required=True, choices=sorted(APP_ENV_FOR))
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--preview", action="store_true", help="render HTML locally + print recipient count")
    mode.add_argument("--test", action="store_true", help=f"send ONE [TEST] copy (default to {DEFAULT_TEST_TO})")
    mode.add_argument("--send", action="store_true", help="mass send to every subscriber (after approval)")
    parser.add_argument("--to", default=DEFAULT_TEST_TO, help="test recipient (must be an admin_users address in --env)")
    parser.add_argument("--confirm-count", type=int, help="required with --send: the recipient count from --preview")
    args = parser.parse_args()

    path = args.message if args.message.is_absolute() else (Path.cwd() / args.message)
    if not path.exists():
        path = PROJECT_ROOT / args.message
    try:
        msg = load_message(path)
        _load_env(args.env)
        _connect()
        if args.preview:
            cmd_preview(msg, args.env)
        elif args.test:
            asyncio.run(cmd_test(msg, args.env, args.to))
        else:
            asyncio.run(cmd_send(msg, args.env, args.confirm_count))
    except SendRefused as e:
        sys.exit(f"REFUSED: {e}")


if __name__ == "__main__":
    main()
