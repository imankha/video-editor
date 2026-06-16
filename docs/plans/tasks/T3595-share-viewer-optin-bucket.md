# T3595: Share Viewer Opt-In & Viewer Analytics Bucket

**Status:** TODO
**Impact:** 7
**Complexity:** 6
**Created:** 2026-06-16
**Updated:** 2026-06-16

## Problem

People who open the share/materialized links we send (a teammate, a coach, a grandparent) are **not tracked as themselves**. The `share_viewed` event ([shares.py:324/347](../../../src/backend/app/routers/shares.py#L324)) is attributed to the **sharer's** `user_id` — it records "a share was viewed," not who viewed it. Anonymous viewers have no identity, no email, no record, and no analytics bucket; they only ever appear in `user_segments` if they sign up.

Two consequences:
1. **No way to separate viewers from prospective users.** Many viewers are viewers-by-nature (grandma will never upload). Lumping their activity in with real prospects pollutes our read on who might actually convert/monetize.
2. **No gentle, consent-based path to convert the viewers who *are* interested.** We don't want to cold-email everyone who opened a link (we don't know they're our kind of user). But if a viewer raises their hand — "yes, show me how to make these" — we should capture that and help them.

## Solution

On the public share viewer pages, add an **opt-in CTA**: *"Want to learn how you can turn game video into clips like this?"* If the viewer opts in (enters their email), we:
- Store them as a **viewer lead** (a bucket distinct from signed-up users), and
- Send them a one-time **how-to email** explaining how to use Reel Ballers to do it.

Passive viewers (viewed, didn't opt in) are **never emailed** and sit in their own clearly-labeled analytics bucket. Opted-in viewer leads are a separate bucket. Neither is counted as a signed-up user, and neither is targeted by the lifecycle emails (T3580/T3590 key off `user_segments`, which these leads are not in).

### Buckets (the analytics goal)
- **Passive viewer** — opened ≥1 share, did not opt in. Counted via the existing `share_viewed` activity; never emailed.
- **Viewer lead (opted-in)** — gave an email asking to learn how. Gets the how-to email; tracked separately as a soft lead.
- **Converted** — a viewer lead who later signs up. Links back to their lead row; their `user_segments.origin` already reflects share/viral via `_determine_origin` (continuity, not a new mechanism).

These three are explicitly NOT the same as a normal signed-up `user_segments` user. The point: keep viewers in a clear bucket so they don't inflate "users who might monetize."

## Context

### Relevant Files (REQUIRED)
- **Viewer pages (add the CTA):**
  - `src/frontend/src/components/SharedVideoOverlay.jsx` (route `/shared/:shareToken`)
  - `src/frontend/src/components/SharedAnnotationView.jsx` (route `/shared/teammate/:shareToken`; already has a "Sign in to watch" CTA ~line 194 — the opt-in is a lighter, non-account ask alongside it)
  - `src/frontend/src/components/SharedCollectionView.jsx` (route `/shared/collection/:shareToken`)
  - A small shared `ViewerOptInCTA` component is preferable to duplicating across the three.
- **Backend share view endpoints (where `share_viewed` fires):** `src/backend/app/routers/shares.py` — `GET /api/shared/{token}` (~334), `/api/shared/teammate/{token}` (~250), `/api/shared/collection/{token}` (~307).
- **New opt-in endpoint:** `POST /api/shared/{share_token}/opt-in` (body: `{ email }`) in `shares.py` — public (no auth), stores a viewer lead and triggers the how-to email.
- **New table** (Postgres) + migration: see schema below. DDL into `_SCHEMA_DDL` (`src/backend/app/services/pg.py`) + versioned migration `src/backend/app/migrations/postgres/v0NN_share_viewer_leads.py` (Migration agent).
- **Email:** `src/backend/app/services/email.py` — add `send_viewer_howto_email(viewer_email, share_context, sender_name)` reusing `_build_share_email` (line 33) / design system. Set `reply_to` if T3580 has landed that support; otherwise just send (independent of T3580).
- **Analytics:** `src/backend/app/analytics.py` FLOW_EVENTS — add viewer-side events (`viewer_opted_in`, optionally `viewer_optin_shown`, `viewer_howto_sent`). Admin surfacing in `src/backend/app/routers/admin.py` analytics endpoints + `src/frontend/src/components/admin/` (show viewer / lead counts distinct from users).

### `share_viewer_leads` schema
```sql
CREATE TABLE IF NOT EXISTS share_viewer_leads (
    id SERIAL PRIMARY KEY,
    viewer_email TEXT NOT NULL,
    share_token TEXT,                  -- first opt-in source
    share_type TEXT,                   -- 'video' | 'game' | 'annotation_playback' | 'collection'
    sharer_user_id TEXT REFERENCES users(user_id),
    source_origin TEXT,                -- inherited from sharer's segment, for attribution continuity
    opted_in_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    howto_sent_at TIMESTAMPTZ,
    converted_user_id TEXT REFERENCES users(user_id),  -- set if/when they sign up with this email
    UNIQUE(viewer_email)
);
CREATE INDEX IF NOT EXISTS idx_viewer_leads_sharer ON share_viewer_leads(sharer_user_id);
```
- `UNIQUE(viewer_email)` + `ON CONFLICT DO NOTHING` so re-opting-in doesn't duplicate or re-spam; how-to email sends once (guard on `howto_sent_at IS NULL`).
- On signup, set `converted_user_id` by matching email (hook into the existing signup/segment-creation path in `analytics.py` `create_user_segment`).

### Related Tasks
- **Must not be emailed by lifecycle emails (T3580/T3590):** those target `user_segments`; viewer leads live in `share_viewer_leads` and are excluded by construction. Note this explicitly so the two email systems don't overlap.
- Builds on the share model: `shares` / `share_games` / `share_videos` (`pg.py:98+`), materialization (T2830/T2840), collection shares (T3620).
- Complements T3550 (uploaded vs accessible games) and T3560 (attribution graph) — viewer leads could later feed the attribution graph as a pre-account node, but that's out of scope here.

### Technical Notes
- **Consent-first:** no email is captured or sent unless the viewer explicitly submits it via the CTA. Passive viewing never triggers email. Honor a simple unsubscribe/CAN-SPAM footer on the how-to email.
- **Anonymous passive viewers** can't be a per-person bucket (no identity) — represent them via the existing `share_viewed` counts, reported in admin as "viewers" separate from users. Only opted-in viewers become individual lead rows.
- **Don't fabricate identity:** do not try to fingerprint anonymous viewers. The bucket boundary is "gave us an email or not."
- **Origin continuity:** when a lead converts, their account origin should already resolve to share/viral via `_determine_origin`; just link `converted_user_id` so we can measure viewer->user conversion rate.
- Migration rules per CLAUDE.md (update `_SCHEMA_DDL` + versioned migration; triggered manually).

## Implementation

### Steps
1. [ ] Backend: `share_viewer_leads` table + DDL + migration.
2. [ ] Backend: `POST /api/shared/{token}/opt-in` — validate email, upsert lead (ON CONFLICT DO NOTHING), record `viewer_opted_in`, send how-to email once (set `howto_sent_at`).
3. [ ] Backend: `send_viewer_howto_email()` in `email.py` (reuse design system; explains annotate -> clip -> reel -> share).
4. [ ] Backend: link `converted_user_id` on signup when email matches a lead.
5. [ ] Frontend: `ViewerOptInCTA` component ("Want to learn how you can turn game video into clips like this?" + email field) added to the three shared viewer pages.
6. [ ] Analytics: add viewer events; surface passive-viewer and viewer-lead counts in admin, clearly separate from signed-up users.
7. [ ] Tests: opt-in stores a lead + sends one email; re-opt-in doesn't duplicate/re-send; passive view sends nothing; lifecycle emails (T3580) do not target viewer leads; conversion linkage on signup.

## Acceptance Criteria
- [ ] Public share viewer pages show an opt-in CTA asking if they want to learn how to make clips like this
- [ ] Opting in (email submitted) creates a `share_viewer_leads` row and sends exactly one how-to email
- [ ] Passive viewers (no opt-in) are never emailed
- [ ] Viewers are a clear, separate analytics bucket (passive viewer vs opted-in lead) — distinct from signed-up users and excluded from lifecycle emails
- [ ] A viewer lead who later signs up is linked via `converted_user_id` (viewer->user conversion measurable)
- [ ] Migration written; `_SCHEMA_DDL` updated
- [ ] Tests pass
