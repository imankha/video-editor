# T5660: Admin "Usage" time is measured wrong (asymmetric cap) + switch display to hours

**Status:** TODO
**Type:** Bug (admin analytics correctness) + small UX
**Reported:** imankh, 2026-07-20 — "I don't understand the 'days' in the admin panel for usage. Can we just keep it hours? Not sure if days mean 24 hours. Not sure why arshia has over a day and sarkarati doesn't even have a day when he has been using it much longer and more consistently."

---

## TL;DR

Two separate things:

1. **Display (trivial, do this):** `1d` **does** mean 24h — the formatter is arithmetically correct
   (`fmtDuration`, [UserTable.jsx:16-28](../../../src/frontend/src/components/admin/UserTable.jsx#L16)):
   `86400s = 1d`, `3600s = 1h`. But the user wants hours-only to remove the ambiguity. Change
   `fmtDuration` to render hours instead of days (e.g. `26h` not `1d 2h`).

2. **The real bug (the reason the numbers look wrong):** `total_usage_seconds` does **not** measure
   time-engaged. It's accumulated by an **asymmetric, banking-dependent** model where historical
   sessions are counted **uncapped** but the current/most-recent session is either not counted at all
   or **capped at 30 minutes** at read time. This can **invert** two users' totals — exactly the
   arshia > sarkarati inversion reported. This is the part that needs a design decision.

---

## How usage is measured today

`total_usage_seconds` lives on the Postgres `user_segments` row (per user). Three functions touch the
timing fields:

| Function | Called from | `last_active_at` | `current_session_start` | Banks into `total_usage_seconds`? |
|---|---|---|---|---|
| `update_session` | `/me` (auth.py:452, once per **page load** — `initSession` caches its promise, [sessionInit.js:198](../../../src/frontend/src/utils/sessionInit.js#L197)) | bumps to `now()` | set on new session / first ever | **only** on new-session transition; banks `last_active_at − current_session_start`, **UNCAPPED** ([analytics.py:321-333](../../../src/backend/app/analytics.py#L321)) |
| `record_milestone` | every tracked action (game_created, clip_created, export_completed, share…) [analytics.py:252](../../../src/backend/app/analytics.py#L252) | bumps to `now()` | untouched | never |
| `close_session` | `/logout` **only** (auth.py:701) | `now()` | → NULL | banks `last_active − current_session_start`, **UNCAPPED** ([analytics.py:426-437](../../../src/backend/app/analytics.py#L426)) |

A "session" = a run of pings (page loads **or** milestone actions) each within **30 min** of the
previous. Its duration = the wall-clock span from the first ping to the last ping.

The admin endpoint then adds an estimate for the **still-open** session at read time, but **capped at
1800s (30 min)** ([admin.py:190-199](../../../src/backend/app/routers/admin.py#L190)):

```python
effective_usage = row["total_usage_seconds"] or 0
if row["current_session_start"] and row["last_active_at"]:
    if (now - last_active_at) < 1800:          # session still "live"
        effective_usage += min(unclosed, 1800) # <-- CAP 30 min
    else:                                       # expired but never banked
        effective_usage += min(expired_duration, 1800)  # <-- CAP 30 min
```

## The defects

**D1 — Asymmetric cap (the inversion cause).** Banked (historical) sessions are counted **uncapped**
(update_session / close_session), but the current-or-unbanked session is **capped at 30 min** at read
time. So two users with identical real engagement get very different totals depending purely on
*whether their sessions got banked*:

- **arshia:** comes and goes → each return trips the 30-min-gap → the *prior* session banks in full,
  uncapped, repeatedly → large `total_usage_seconds`.
- **sarkarati:** heavier, more continuous use → his activity keeps extending `last_active_at` (every
  clip/export/`/me` resets the 30-min window), so his big session stays **current/unbanked**. It's
  never banked (see D2) and the admin read-side clamps it to **≤30 min**. A day of real use shows as
  minutes.

**D2 — Banking depends on return/logout, not usage.** `total_usage_seconds` only grows on a *new
session start* or an explicit `/logout`. `close_session` fires **only** from the logout endpoint — most
users just close the tab (no logout, no beacon), so their most recent (often largest) session is banked
**only if they come back later**. Users who churn, or who stay in one long continuous session, never
bank it → chronic under-count.

**D3 — Read-time-only estimate that never persists.** admin.py:191-199 adds the unbanked span only in
the response; the PG value stays stale. The number depends on *when you look* and is inconsistent with
the banked model.

**D4 — No idle-gap trimming on banked spans.** A banked span counts up to ~30 min of pure idle per
gap between pings as "active" (a session survives any gap < 30 min). Over a long come-and-go session
this over-counts — inflating arshia further.

Net: the metric rewards *coming back after gaps* and penalizes *long continuous focused use* — the
opposite of what "usage" should mean, and the direct cause of arshia > sarkarati.

---

## Classification

**Tier:** M (backend measurement fix + 1-line frontend display change). Promote to L only if the
design lands a new client heartbeat (new pattern).
**Stack Layers:** Backend (analytics.py, admin.py), Frontend (UserTable.jsx display; possibly a
heartbeat), Database (no schema change — reuses existing columns).
**Files Affected:** ~3-4
**LOC Estimate:** ~40-80
**Test Scope:** Backend (extend [test_analytics.py](../../../src/backend/tests/test_analytics.py) session-duration cases)
**Knowledge Docs:** backend-services.md (analytics/Postgres). No dedicated analytics doc exists yet.

| Agent | Include? | Justification |
|-------|----------|---------------|
| Code Expert | No | Data flow already mapped in this file. |
| Architect | Yes (light) | One design call: how to make the metric measure engaged time (heartbeat vs symmetric capping vs both) — see Open Questions. Gate on the user before implementing a heartbeat. |
| Tester | Yes | test_analytics.py already pins the banking arithmetic; add cases for symmetric capping + idle-gap trimming. |
| Reviewer | Yes | Standard M-tier diff review. |
| Migration | No | No schema change. If a backfill/recompute of existing `total_usage_seconds` is wanted, that's a data-repair migration — decide in design. |

---

## Fix direction (for design — not prescriptive)

The metric should approximate **foreground engaged time**. Candidate pieces, pick per design:

1. **Symmetric capping (cheapest, no client change).** Apply the same per-gap cap on **both** the
   write side (bank `min(span, CAP)` per session, and trim idle gaps) and the read side. Use one
   named constant (e.g. `SESSION_IDLE_CAP_SECONDS = 1800`) shared by analytics.py and admin.py — no
   magic `1800` in two places. This alone removes the asymmetry (D1) and idle over-count (D4).
2. **Bank on tab-close, not just logout (fixes D2).** Add a `navigator.sendBeacon` on `pagehide`/
   `visibilitychange→hidden` that calls a close-session endpoint, so the last session is banked without
   requiring a return or a logout. (gamesDataStore already has pagehide/visibilitychange handlers —
   [gamesDataStore.js:390](../../../src/frontend/src/stores/gamesDataStore.js#L390) — reuse that seam,
   don't add a parallel one.)
3. **Optional heartbeat (best fidelity, biggest change).** A visibility-gated interval (e.g. 60s while
   the tab is foreground) that pings a lightweight endpoint bumping `last_active_at`, with per-tick gap
   capped so a backgrounded/idle tab can't inflate. Makes span ≈ real foreground time. **New pattern —
   user-gate before building.**
4. **Persist the estimate or drop the read-time patch (D3).** Either recompute+persist on a schedule,
   or keep the read-time estimate but make it consistent with the capped write model.

**Do NOT** just clamp everything to 30 min at read time and call it fixed — that hides D2 (unbanked
sessions) and still under-counts heavy users.

Honor the coding standards: no silent fallbacks / no defensive read-time patches masking the model.
Fix the accounting at the source.

## Display change (independent, small)

In `fmtDuration` ([UserTable.jsx:16](../../../src/frontend/src/components/admin/UserTable.jsx#L16)),
drop the `days` branch and render hours (keep `<1m` / `Nm` for small values, then `Nh` / `Nh Mm`).
This is orthogonal to the measurement fix and can ship independently.

## Open questions for the user / design

1. **Heartbeat yes/no?** True engaged-time needs a client heartbeat (option 3). Are we OK adding one,
   or is symmetric capping + tab-close beacon (options 1+2) good enough for an internal admin metric?
2. **Backfill existing data?** Current `total_usage_seconds` values are already skewed. Recompute is
   only possible from `user_actions`/session history if we have enough granularity — likely we don't,
   so existing totals stay skewed until they re-accumulate under the new model. Accept that, or wipe to
   0 and let it rebuild? (Data-repair migration if we recompute.)
3. **What window does "Usage" mean?** All-time cumulative (today) vs last-30-days? All-time keeps
   growing forever and buries recent activity — worth deciding while we're here.

## Verification

- Backend unit tests in test_analytics.py: add cases proving (a) a banked session and the live-session
  estimate use the **same** cap, (b) idle gaps beyond the cap are trimmed, (c) tab-close banks the last
  session if the beacon lands.
- Drive the admin panel as a real admin (drive-app-as-user) and confirm a known heavy continuous user
  no longer shows minutes, and a come-and-go user is no longer inflated.
- Confirm the "Usage" column renders hours (no `d`).
