# T2020: On-Machine Log Retention

**Status:** TODO
**Impact:** 6
**Complexity:** 2
**Created:** 2026-04-29
**Updated:** 2026-04-29

## Problem

Fly.io's built-in log buffer retains only ~47 lines. When investigating the "Failed to Fetch" outage on 2026-04-29 (~19:11 UTC), the logs were already gone by the time we checked (~10 hours later). We have `[REQ_TIMING]`, `[SLOW REQUEST]`, `[R2_CALL]`, and cProfile dumps (profiling is enabled on prod at 1000ms threshold), but all of it is lost once the buffer rolls over.

## Fix: File-Based Log Rotation

Write logs to files on the machine with daily rotation. No external services.

1. **Add `TimedRotatingFileHandler`** to Python's logging config in `main.py`
   - Write to `/tmp/logs/app.log`
   - Rotate daily, keep 1 backup (24-48 hours of logs)
   - Same formatter as console output

2. **Add a debug endpoint** to read log files remotely
   - `GET /api/_debug/logs` — list available log files with sizes
   - `GET /api/_debug/logs/{filename}` — read a log file (tail N lines, grep filter)
   - Gated behind `DEBUG_ENDPOINTS_ENABLED` (already true on prod)

3. **Stop clearing `/tmp/profiles/` on startup** — let rotation handle cleanup instead

### Tradeoffs

- Logs are lost on machine restart (ephemeral `/tmp`) — acceptable since we mainly need logs for debugging issues on a running machine, which is the common case (the T2010 outage had no restart)
- No Fly.io volume needed — keeps infra simple
- 24 hours of logs at typical traffic is well under 50MB

## Acceptance Criteria

- [ ] App logs written to `/tmp/logs/app.log` with daily rotation
- [ ] Debug endpoint to read/search log files remotely
- [ ] Profile dumps not cleared on restart
