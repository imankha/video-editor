# Auto-Export Reliability

**Status:** TODO
**Started:** 2026-05-04

## Goal

Make auto-export (brilliant clips + recap video) complete reliably on Fly.io. Currently it fails 100% of the time on large games because the 3GB download takes 20+ minutes, Fly.io auto-suspends the machine mid-download, and the `pending` status prevents retry on restart.

## Root Causes (discovered 2026-05-04)

1. **Full video download** — `auto_export.py` downloads the entire game video to local disk before extracting short clips. FFmpeg can work directly with HTTP URLs via presigned R2 URLs, needing only the clip segments.

2. **`pending` status deadlock** — `auto_export_game()` sets `auto_export_status = 'pending'` immediately (line 50-53), then checks for it on re-entry (line 47-48). If the machine dies mid-export, the status stays `pending` forever — no retry on restart.

3. **Auto-suspend during background work** — Fly.io's autosuspend monitors incoming HTTP traffic. The sweep scheduler runs as a background asyncio task with no HTTP requests, so the machine looks idle and gets suspended mid-download.

## Tasks

| ID | Task | Status |
|----|------|--------|
| T2450 | [Presigned URL for FFmpeg](T2450-auto-export-presigned-url.md) | TODO |
| T2460 | [Pending Status Recovery](T2460-pending-status-recovery.md) | TODO |
| T2470 | [Sweep Keepalive](T2470-sweep-keepalive.md) | TODO |

## Implementation Order

1. **T2460 first** — fixes the deadlock so we can retry. Tiny change, immediate value.
2. **T2450 second** — eliminates the download entirely. This is the big win.
3. **T2470 last** — belt-and-suspenders. With T2450, exports finish in seconds so auto-suspend rarely matters. But the keepalive protects against edge cases (very large recap re-encodes).

## Completion Criteria

- [ ] Auto-export completes reliably for a 3GB game on Fly.io without manual intervention
- [ ] `pending` status doesn't block retry after machine restart
- [ ] Machine stays alive during active sweep work
