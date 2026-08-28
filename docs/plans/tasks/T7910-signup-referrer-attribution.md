# T7910: Signup attribution: referrer fallback + end-to-end pipeline verification

**Status:** WAITING ON USER
**Impact:** 8
**Complexity:** 3
**Created:** 2026-08-27 (from the 2026-08-27 drop-off report refresh)

## Problem

14 signups arrived in 3 days (Aug 24-27) — as many as the previous 3 months combined — and
every single one is `origin=organic` with all UTM fields NULL. The only growth spike on
record is completely unattributable: it cannot be identified, repeated, or funded.

Root cause is a capture gap, not (necessarily) a broken pipeline:

1. `App.jsx:139-171` persists `campaignParams` ONLY when `ref`, `utm_*`, or a click-ID is
   present. **`document.referrer` is never captured**, so a user arriving from a Reddit
   thread, a TikTok bio link, or Google search carries a perfectly good referrer that is
   thrown away, and `_determine_origin` buckets them `organic`.
2. The landing -> app hop destroys the signal even when it exists: `PageLayout.astro:41-64`
   relays `utm_*`/`ref` params onto CTA links, but the app's `document.referrer` then reads
   `reelballers.com` — the ORIGINAL external referrer is lost at the hop.
3. Nobody has ever proven the UTM pipeline works end to end on prod (every historical row
   is NULL — consistent with "no campaigns ever ran" but never verified).

## Solution

Three parts, no new Postgres columns (better population of EXISTING `user_segments.origin`):

1. **Landing relays its referrer.** In the same PageLayout script that relays `utm_*`/`ref`,
   add the landing page's `document.referrer` host as a param on CTA links (e.g.
   `lref=<host>`), only when external and non-empty.
2. **App captures a referrer hint.** `App.jsx` stores `lref` (or, absent that, its own
   external `document.referrer` host) into `campaignParams` — hostname only, never the full
   URL (no query strings, no paths — privacy stance). Signup sends it with the existing
   campaign payload.
3. **Server buckets it.** `_determine_origin` (analytics.py:235) gains a lowest-priority
   referrer branch — existing priority order unchanged (invite > referral > click-ID > UTM >
   ...), referrer only breaks the `organic` fallback into `seo` (search-engine hosts),
   `social-<network>`, `community`, else `organic`. Put the host->bucket mapping in ONE
   server-side constant — T7410 (first-party visit beacon) is specced to use the same
   mapping, so this task creates the shared constant and T7410 reuses it, not a fork.
4. **Verification (do this FIRST, it is cheap):** drive a synthetic signup on staging with
   `?utm_source=t7910test` through the real Google/OTP flow and confirm the
   `user_segments` row carries it. If it does NOT, the pipeline is broken and that becomes
   the task's first fix. Record the evidence either way.

## Context

### Relevant Files (REQUIRED)
- `src/landing/src/layouts/PageLayout.astro` (lines ~41-64) — param relay + `lref`
- `src/frontend/src/App.jsx` (lines ~139-171) — campaignParams capture
- `src/backend/app/analytics.py` — `_determine_origin` (~line 235) + shared host->bucket constant
- `src/backend/app/routers/auth.py` — signup call sites (392, 652) pass-through
- Landing deploys separately: `deploy-landing` skill

### Related Tasks
- Shares the bucket constant with: investor-analytics T7410 (visit beacon) — build here, reuse there
- Feeds: T7440 (organic growth report), the drop-off report's channel split

### Technical Notes
- Referrer is a HINT, not truth (privacy settings strip it, `Referrer-Policy` matters —
  check what the landing currently sends; `strict-origin-when-cross-origin` still yields
  the origin, which is all we need).
- Store hostname only. No new PG state: `origin` is an existing column; the analytics
  no-new-PG directive is satisfied.
- Do not backfill history — the surge users are gone; this is forward-looking. (Their
  absence from attribution is already recorded in the drop-off report.)

## Implementation

### Steps
1. [ ] Staging UTM end-to-end verification with evidence (before any code)
2. [ ] Landing `lref` relay + Referrer-Policy check
3. [ ] App referrer-hint capture into campaignParams
4. [ ] `_determine_origin` referrer branch + shared bucket constant + tests (priority order proven by test)
5. [ ] Deploy landing + app; verify a real staging signup from an external referrer buckets correctly

## Acceptance Criteria

- [ ] Synthetic `?utm_source=t7910test` staging signup lands in `user_segments` (or the broken pipeline is found and fixed)
- [ ] A signup arriving via an external referrer with no UTM buckets as seo/social/community, not organic
- [ ] Existing priority order (invite > referral > click-ID > UTM) unchanged, proven by tests
- [ ] Only hostnames stored; bucket mapping lives in one shared server-side constant
