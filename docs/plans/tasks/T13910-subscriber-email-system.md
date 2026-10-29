# T13910: Subscriber email system (opt-out, unsubscribe link, release + ad-hoc sends)

**Status:** DONE (deployed 2026-10-29 prod; postgres v037 applied, error None)
**Tier:** L (Postgres schema change; backend, landing, tooling, docs)
**Created:** 2026-10-29

## Problem

We want to email every user who has not opted out: the user-facing improvements of each prod deploy,
and ad-hoc announcements. There was no opt-out, no unsubscribe link, and no all-user send path (the
admin bulk email takes hand-picked user ids). The landing page did not link our socials or tutorial.

## Solution

- Postgres v037: `users.email_opted_out_at` + `users.email_unsubscribe_token` (random per user).
- Public `GET/POST /api/email/unsubscribe?token=` (+ `/resubscribe`), served by the API.
- Subscriber template: tutorial button, Instagram/YouTube/TikTok/Reddit/Discord, unsubscribe link,
  RFC 8058 one-click headers.
- `scripts/email_subscribers.py`: `--preview`, `--test`, `--send --confirm-count N`; a mass send is
  refused unless the exact content was test-sent in the same env.
- Commands `/email-release` (deploy skill step 8) and `/email-announce`; procedure in
  `docs/emails/README.md`.
- Landing: footer socials + tutorial link, homepage tutorial card + hero link, `Organization.sameAs`.

## Links

- Tutorial: https://www.youtube.com/watch?v=ve2kwGGQL1o
- Instagram https://www.instagram.com/reelballers1 · YouTube https://youtube.com/@reelballers1 ·
  TikTok https://www.tiktok.com/@reelballers1 · Reddit https://www.reddit.com/r/Reelballers ·
  Discord https://discord.gg/sXWam8j9QT (replaces the older abmtZacgsD invite in T7610's drafts)

## Acceptance Criteria

- [ ] Clicking the unsubscribe link (no sign-in) sets `email_opted_out_at`; the user is excluded from
      the next send; "subscribe again" clears it.
- [ ] Every subscriber email shows the tutorial, all five social links, and a working unsubscribe link.
- [ ] `--send` is refused without a test send of the exact content, with a wrong count, or twice.
- [ ] Deploy runbook runs `/email-release` after a green deploy, gated on owner approval.
- [ ] reelballers.com shows the socials and the tutorial.

## Follow-ups

- T12610 (welcome email) should reuse `email.py` `TUTORIAL_URL` / `SOCIAL_LINKS`.
- CAN-SPAM requires a physical postal address in commercial email; the template has none yet.
