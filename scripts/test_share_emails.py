"""Send all 8 share email variants to a test address for visual QA.

Usage:
    cd src/backend && .venv/Scripts/python.exe ../../scripts/test_share_emails.py
"""

import asyncio
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

project_root = Path(__file__).parent.parent
load_dotenv(project_root / ".env.staging")
load_dotenv(project_root / ".env", override=False)

sys.path.insert(0, str(Path(__file__).parent.parent / "src" / "backend"))

from app.services.email import (
    send_share_email,
    send_teammate_share_email,
    send_game_share_email,
    send_playback_share_email,
)

TO = "imankh@gmail.com"
SENDER_NAME = "Sarah Jones"
SENDER_EMAIL = "sarah.jones@gmail.com"
GAME_NAME = "Vs LA Breakers May 9"
VIDEO_NAME = "Jack's Best Saves"
TAG_NAME = "Jack"
FAKE_TOKEN = "test-preview-token-do-not-click"


async def main():
    if not os.getenv("RESEND_API_KEY"):
        print("ERROR: RESEND_API_KEY not set. Check .env file.")
        sys.exit(1)

    variants = [
        (
            "Teammate clips (first-touch)",
            send_teammate_share_email(TO, SENDER_EMAIL, TAG_NAME, GAME_NAME, 3,
                                      share_token=FAKE_TOKEN,
                                      sender_name=SENDER_NAME, is_first_touch=True),
        ),
    ]

    print(f"Sending {len(variants)} email(s) to {TO}...\n")
    for label, coro in variants:
        result = await coro
        status = "OK" if result else "FAILED"
        print(f"  [{status}] {label}")

    print("\nDone. Check your inbox.")


if __name__ == "__main__":
    asyncio.run(main())
