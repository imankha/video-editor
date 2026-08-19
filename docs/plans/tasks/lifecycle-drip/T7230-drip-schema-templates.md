# T7230: Drip Schema + Seed Migration (templates, sends, unsubscribes)

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-08-19
**Updated:** 2026-08-19

Epic task 1/5 — see [EPIC.md](EPIC.md) for design decisions: stage model, send windows,
claim idempotency, suppression, content rules.

## Problem

The drip system needs three Postgres tables (templates as editable data, a send log that
doubles as the idempotency guarantee, and an unsubscribe registry) plus seeded starting
copy, before any engine or scheduler code can exist.

## Solution

One postgres-track migration creating all three tables and seeding all 28 template cells,
plus the same DDL added to `_SCHEMA_DDL` in `pg.py` for fresh deployments.

### Schema (exact)

```sql
CREATE TABLE drip_templates (
    id          SERIAL PRIMARY KEY,
    drip_day    INTEGER NOT NULL,              -- 1 | 3 | 7 | 14
    stage       TEXT NOT NULL,                 -- stage key from EPIC.md §2
    subject     TEXT NOT NULL,                 -- plain text, <= 200 chars (BULK_SUBJECT_MAX parity)
    body        TEXT NOT NULL,                 -- plain text, body_text_to_html() format, <= 10000 chars
    enabled     BOOLEAN NOT NULL DEFAULT true,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (drip_day, stage)
);

CREATE TABLE drip_sends (
    id           SERIAL PRIMARY KEY,
    user_id      TEXT NOT NULL,                -- users.user_id
    drip_day     INTEGER NOT NULL,
    stage        TEXT,                         -- stage resolved at claim time (audit only)
    template_id  INTEGER REFERENCES drip_templates(id),
    status       TEXT NOT NULL,                -- 'claimed' | 'sent' | 'failed' | 'skipped'
    detail       TEXT,                         -- failure reason / skip reason
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at      TIMESTAMPTZ,
    UNIQUE (user_id, drip_day)                 -- THE idempotency guarantee (EPIC §4)
);
CREATE INDEX idx_drip_sends_user ON drip_sends (user_id);

CREATE TABLE email_unsubscribes (
    user_id     TEXT NOT NULL,
    scope       TEXT NOT NULL DEFAULT 'lifecycle',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, scope)
);
```

Notes:
- `stage` on `drip_sends` is a **point-in-time audit value** (what stage the user was in
  when emailed), not derivable later — recording it does not violate no-redundant-state.
- No FK from `drip_sends.user_id` to `users` — a deleted account must not cascade away the
  send log (and `delete_user.py` flows shouldn't fail on it). Same reasoning as
  `user_actions`.

### Seed copy

Seed **all 28 cells**. Defaults: every row `enabled = true` EXCEPT `(1, completed)` and
`(3, completed)` (someone who shared in their first days needs no nudge). Copy drafts follow
the tone matrix below; the four fully-drafted examples define the voice — remaining cells
are drafted at implementation following the same pattern and reviewed by the user in the
admin editor (T7270) before prod enable (EPIC rollout step 3).

Tone matrix (EPIC §8): day 1 = helpful nudge with tutorial; day 3 = value-prop reminder
("what the finished reel looks like"); day 7 = direct support ask ("what blocked you? reply
and tell us"); day 14 = last touch, short, pure reply invitation.

Every body MUST contain the support line (memory `feedback_winback_email_support_framing`):
a variant of *"reply and tell us exactly where you got stuck — we'll walk you through it or
fix it."*

Drafted examples (final copy, seed verbatim):

**(1, `uploaded`)** — subject: `Your game is in — here's the 60-second next step`
```
Hi there,

Your game "{{game_name}}" is uploaded and ready on Reel Ballers. The next step is the fun
part: skimming the video and marking the plays worth keeping. It takes about a minute to
learn: https://assets.reelballers.com/tutorials/annotate.mp4

If anything was confusing or something didn't work, just reply and tell us exactly where you
got stuck -- we'll walk you through it or fix it.

-- Iman, Reel Ballers
```

**(1, `not_uploaded`)** — subject: `One upload turns your sideline video into a highlight reel`
```
Hi there,

You created your Reel Ballers account but haven't uploaded a game yet -- so you haven't seen
what it actually does: turn raw phone footage into a highlight reel your kid will rewatch.

All it takes is one game video from your phone. Here's the first step, under a minute:
https://assets.reelballers.com/tutorials/annotate.mp4

Stuck or unsure about anything? Reply and tell us where -- we're here to help, and we'd
rather fix a problem than send another email.

-- Iman, Reel Ballers
```

**(7, `clipped`)** — subject: `You did the hard part -- framing takes two minutes`
```
Hi there,

You've marked up {{clip_count}} plays on Reel Ballers -- that's the slow part, and it's
done. Framing (cropping the video to follow the action) is the quick part, and it's where
the reel starts looking professional: https://assets.reelballers.com/tutorials/framing.mp4

If framing is where you stopped, something probably wasn't obvious -- reply and tell us
exactly where you got stuck and we'll walk you through it, or fix it.

-- Iman, Reel Ballers
```

**(14, `not_uploaded`)** — subject: `Should we keep your Reel Ballers spot?`
```
Hi there,

Two weeks ago you signed up for Reel Ballers, and it looks like it never clicked into place.
That's on us to fix, not you.

If you've got 30 seconds: what got in the way? Just reply -- one sentence is plenty. And if
you'd still like to see what it does, this is the whole first step:
https://assets.reelballers.com/tutorials/annotate.mp4

-- Iman, Reel Ballers
```

Variable whitelist per stage (renderer contract, enforced in T7240): `not_uploaded` — none;
`uploaded`+ — `{{game_name}}` (most recent game); `clipped`+ — `{{clip_count}}`. Seeds must
not use a variable outside their stage's whitelist.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/migrations/postgres/v0NN_drip_emails.py` — NEW migration (all 3 tables + seeds)
- `src/backend/app/services/pg.py` — `_SCHEMA_DDL` gains the same tables (fresh-deploy parity)

### Migration number
Head on master is **v022** (`v022_user_usage_daily.py`). Number this head+1 **at
implementation time** and check sibling unmerged branches first (memory
`project_migration_version_collision_across_branches`).

### Related Tasks
- Blocks: T7240, T7250, T7260, T7270 (everything reads these tables)

### Technical Notes
- Migration `up(conn)` receives TUPLE rows — index positionally (memory
  `reference_migration_runner_rowfactory`).
- Migrations do NOT auto-run: applied post-deploy via `POST /api/admin/migrate`.
- Seed INSERTs must be idempotent (`ON CONFLICT (drip_day, stage) DO NOTHING`) so a re-run
  never clobbers admin-edited copy.
- Subject/body length caps mirror the bulk-email constants (`BULK_SUBJECT_MAX=200`,
  `BULK_BODY_MAX=10000` in `routers/admin.py`) — enforced at the API layer (T7270), not as
  DB constraints.

## Implementation

### Steps
1. [ ] Confirm migration head incl. sibling branches; create `v0NN_drip_emails.py`
2. [ ] Add tables to `_SCHEMA_DDL` in `pg.py`
3. [ ] Write all 28 seed cells (4 drafted above verbatim; rest per tone matrix + content rules)
4. [ ] Backend tests: migration applies on a fresh DB; seeds idempotent; unique constraints hold
5. [ ] Run migration on dev via admin endpoint; verify rows

### Progress Log

## Acceptance Criteria

- [ ] Fresh `init_pg_schema()` and migrated existing DB produce identical drip tables
- [ ] 28 template rows seeded; `(1|3, completed)` disabled; re-running the migration changes nothing
- [ ] Every seeded body contains the support-framing line and at most one CTA link
- [ ] `UNIQUE(user_id, drip_day)` and `UNIQUE(drip_day, stage)` verified by test
- [ ] Tests pass (relevant set)
