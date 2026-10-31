# T14180: Per-IP limits on OTP sends and signups

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Tier:** S
**Created:** 2026-10-31
**Updated:** 2026-10-31

Source: 10K-user readiness audit, 2026-10-31 (expert agent, claims spot-checked in code). Assumed load at 10K registered: ~1,000 daily actives, ~100 concurrent sessions at evening/weekend peak, bursts of concurrent uploads and exports after games.

## Problem

OTP sends are limited only per email (`routers/auth.py` ~640-649); the problem-report limiter is in-memory and per-process (~913); there is no general rate limiter. Every signup gets 88 free credits. One IP can trigger OTP emails to thousands of addresses (Resend quota and sender reputation) and farm free GPU through repeated signups.

## Solution

Add a per-IP limit on OTP send and account creation, backed by Postgres (works across restarts and a future second machine) or a Cloudflare edge rule. Becomes a prerequisite if paid acquisition starts.

## Context

### Relevant Files
- `src/backend/app/routers/auth.py`
- `src/backend/app/services/pg.py` (if a Postgres-backed counter; needs the Migration agent and _SCHEMA_DDL)
- `edge` rule config if Cloudflare

### Notes
Load: backend-services.md. Schema change if Postgres-backed: postgres-track migration + admin migrate-postgres after deploy.

## Acceptance Criteria

- [ ] Test: the Nth OTP request from one IP within the window is refused with a clear 429; other IPs unaffected
- [ ] Limit survives a process restart
