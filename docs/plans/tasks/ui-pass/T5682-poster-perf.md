# T5682: Poster serving performance (thumbs, cache, TTFB)

**Status:** IN PROGRESS
**Impact:** 6
**Complexity:** 3
**Created:** 2026-07-24
**Epic:** [UI Pass](EPIC.md) — added from a HAR analysis during wave-3 integration testing

## Problem

HAR capture of the Games tab showed poster GETs with 800–1155ms TTFB (even 404s ~800ms),
307–351KB payloads for ~200px cards, `max-age=300` with no ETag, and `no-cache` 404s —
posters "popped in" slowly on every visit.

## Root cause (measured + code-confirmed)

Each request opened a fresh `httpx.AsyncClient()` (full TLS handshake to R2 per request —
the T4773 landmine repeated), md5-hashed the full JPEG to synthesize an ETag, and served
the un-resized full-size frame.

## Fix (all three owner-facing poster endpoints: drafts, reels, games)

- Card-size generation: 480px-wide JPEG thumbs on SEPARATE card keys (`.card.jpg` for
  reels/games, `.v2.jpg` for drafts); og:image/share paths keep their untouched full-size
  keys (`shares.py` verified).
- Pooled keepalive R2 client (`get_poster_r2_client`); R2's own ETag reused (no hashing).
- `Cache-Control: private, max-age=86400` + ETag on 200s; `If-None-Match` honored via a
  single HEAD → 304. 404s negative-cached (`max-age=60`).
- T5681's source-frame path generates at card size through the same shared helpers
  (`extract_first_frame_jpeg(seek=, resize_width=)`); positional-arg hazard in the
  clearest-frame fallback fixed to keyword args.

## Measured (live, merged branch, real account)

| Scenario | Before | After |
|---|---|---|
| Warm poster load | ~1,100ms / 307–351KB | ~190ms / 14–42KB |
| Revalidation | full re-download | 304 @ ~146ms; nothing for 24h |
| Recap-less game first hit | 404 (no poster) | 200; one-time gen 1.7–2.3s, cached |

Known trade-off: the single largest desktop draft tile (~300px CSS) renders a 480px thumb
at ~1.6× DPR — marginally soft, accepted for the TTFB win.

## Acceptance Criteria

- [x] Measured warm TTFB ≤ 400ms and 304 path ≤ 150ms on all three endpoints
- [x] Payloads ≤ ~50KB for card surfaces; full-size share/og:image paths unaffected
- [x] Poster test suites green (137 across t5090/t5180/t5270/t5671/t5673/t5681)
