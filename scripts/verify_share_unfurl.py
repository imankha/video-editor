#!/usr/bin/env python
"""Verify a share link unfurls correctly, the way a preview crawler sees it.

Simulates what iMessage/WhatsApp/preview tools actually do: fetch the page
HTML with a crawler User-Agent and NO JavaScript, parse the og:* meta tags,
then fetch og:image and og:video and assert they respond. Run it several
times (cold + warm) because the edge function falls back to the SPA when the
API misses its upstream timeout - a crawler that hits a cold backend gets a
tagless page.

Usage:
    python scripts/verify_share_unfurl.py <share_url> [--attempts N]
"""
import argparse
import re
import sys
import time
import urllib.request

CRAWLER_UA = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"


def fetch(url: str, timeout: float = 20.0, ua: str = CRAWLER_UA) -> tuple[int, dict, bytes]:
    req = urllib.request.Request(url, headers={"User-Agent": ua})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, dict(resp.headers), resp.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def parse_meta(html: str) -> dict:
    tags = {}
    for prop, content in re.findall(
        r'<meta (?:property|name)="((?:og|twitter):[^"]+)" content="([^"]*)"', html
    ):
        tags[prop] = content.replace("&amp;", "&")
    return tags


def check_once(share_url: str, attempt: int) -> tuple[bool, list[str]]:
    problems = []
    t0 = time.monotonic()
    status, headers, body = fetch(share_url)
    page_ms = int((time.monotonic() - t0) * 1000)
    html = body.decode("utf-8", errors="replace")
    tags = parse_meta(html)

    print(f"\n--- attempt {attempt}: page {status} in {page_ms}ms, "
          f"{len(body)} bytes, {len(tags)} og/twitter tags")

    if status != 200:
        return False, [f"page returned {status}"]
    if not tags.get("og:title"):
        problems.append("NO og:title -> crawler got the SPA fallback, not the edge page "
                        "(edge upstream timeout / cold API?)")
        return False, problems

    print(f"    og:title       = {tags.get('og:title', '')[:70]}")
    print(f"    og:description = {tags.get('og:description', '')[:70]}")

    for key in ("og:image", "og:video"):
        url = tags.get(key)
        if not url:
            problems.append(f"missing {key}")
            continue
        if not url.startswith("https://"):
            problems.append(f"{key} is not absolute: {url[:80]}")
            continue
        if key == "og:image" and ("X-Amz-Signature" in url or "sig=" in url):
            problems.append(f"{key} is a PRESIGNED URL (expires!): {url[:80]}...")
        t0 = time.monotonic()
        a_status, a_headers, a_body = fetch(url)
        ms = int((time.monotonic() - t0) * 1000)
        ctype = a_headers.get("Content-Type", "?")
        print(f"    {key:9} -> {a_status} {ctype} {len(a_body)} bytes in {ms}ms  "
              f"[{url[:70]}...]")
        if a_status != 200:
            problems.append(f"{key} fetch failed: {a_status}")
        if key == "og:image" and "image" not in ctype:
            problems.append(f"og:image wrong content-type: {ctype}")

    if tags.get("og:image") and not (
        tags.get("og:image:width") and tags.get("og:image:height")
    ):
        print("    note: og:image dims absent (optional)")

    return not problems, problems


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("share_url")
    ap.add_argument("--attempts", type=int, default=3)
    args = ap.parse_args()

    results = []
    for i in range(1, args.attempts + 1):
        ok, problems = check_once(args.share_url, i)
        results.append(ok)
        for p in problems:
            print(f"    PROBLEM: {p}")
        if i < args.attempts:
            time.sleep(2)

    passed = sum(results)
    print(f"\n=== {passed}/{len(results)} attempts unfurl-clean ===")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    main() or sys.exit(0)
    sys.exit(1)
