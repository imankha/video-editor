# Referral programme: 50% of revenue for two months, no codes

**Status:** BLOCKED (starts when T14910 reads every funnel gate settled green; owner rule 2026-11-05: no prep before the funnel is fixed)
**Started:** not started
**Filed:** 2026-11-05

## Goal

Turn the people who already like the product, parents, coaches and clubs, into the acquisition
channel, paid on results. A referrer gets **50% of the revenue** from every user they bring in, for
**two months from that user's sign-up**. The referrer sees what they are owed on a simple page and
spreads one link. The owner emails that offer to a bank of existing users first and, in time, to
thousands of clubs.

Owner directives (2026-11-05): no codes anywhere; keep it simple; the mass email carries the share
link and the dashboard link; tracking of paid ads and of the referral programme stay separate in
the admin.

## Why it fits the model

The 2026-11-03 ROI model found every paid channel loses money because contribution per sign-up
($0.15 to $1.56) is far under any cost per sign-up. A revenue share is the one channel whose cost
is a fraction of the revenue it brings, so it is GO by construction as long as variable cost stays
under half of revenue (it is about $0.05 against $0.20 per sign-up today). Its risk is not unit
economics; it is K: whether referrers spread the link at all (0.008 measured; T15070's end-card
code is the first read).

## Mechanism (locked unless a task file says otherwise)

- **Link, not code.** The share link is the referrer's existing invite link (`/?ref=<invite_code>`,
  `users.invite_code`, resolved at sign-up by `resolve_invite_code` into `referrals` and
  `user_segments.referrer_id`). Nobody types anything; the code lives in the URL only.
- **Accrual.** 50% of net purchase revenue (`payments` ledger: purchases minus refunds and lost
  disputes) from each referred user, for purchases dated within 60 days of that user's sign-up.
  Computed from existing tables; nothing is counted twice; test accounts excluded; self-referral
  excluded.
- **Payout.** Owed amounts are paid by the owner, recorded by a gesture; whether Stripe Connect
  handles transfers is decided in T15180 from measured owed totals, not up front.
- **Clubs.** A club is a referrer like anyone else: the outreach email invites the contact to claim
  their link; claiming is a sign-up (OTP or Google), which creates the invite code. No separate
  partner identity.

## Tasks (dependency order)

| ID | Task | Status |
|----|------|--------|
| T15150 | [Referral earnings read model + payouts ledger](T15150-referral-earnings-and-payouts-ledger.md) | TODO |
| T15160 | [Referrer page: your link, your referrals, what you are owed](T15160-referrer-page.md) | TODO |
| T15170 | [Outreach list and mass send, sized for thousands of clubs](T15170-outreach-list-and-mass-send.md) | TODO |
| T15180 | [Admin payouts: owed per referrer, mark paid, Stripe Connect decision](T15180-admin-payouts.md) | TODO |
| T15190 | [Programme terms and abuse rules](T15190-programme-terms-and-abuse-rules.md) | TODO |

Related, outside the epic: T15200 (Paid-ads tracking kept separate from the referral programme in
the admin; registry spend entry; live-campaign block), in the Spend readiness milestone.

## Completion criteria

- [ ] A referred user's purchase within 60 days shows on the referrer's page as owed within a day
- [ ] The owner can send the offer to a list of thousands of contacts in batches, with unsubscribe
      and bounce handling, and see per-contact status
- [ ] Owed, paid and outstanding totals agree between the referrer page and the admin view
- [ ] The admin's channel and spend-readiness views show the programme as its own channel, never
      mixed with paid ads
- [ ] Terms published; self-referral and refund clawback enforced by tests
