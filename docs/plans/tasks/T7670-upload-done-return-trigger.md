# T7670: Upload-complete email: turn the long wait into a return trigger

**Status:** STAGING (post-P1; user 2026-08-24: not a priority vs blocking bugs)
**Impact:** 6
**Complexity:** 2
**Created:** 2026-08-24

## Problem

A full-game upload takes tens of minutes to over an hour (jordark: 110-minute game,
1.23GB; cschwartz: 3.9GB/65min). Users leave mid-wait and nothing calls them back:
jordark opened Add Clip 28 seconds after his upload landed and was gone minutes later;
eticatch never pressed play at all. The 2026-08-24 research review flagged the missing
return trigger: a completion email converts the forced wait into a re-entry path on any
device (and doubles as the phone->desktop handoff for users who prefer editing on a
computer: "your game is ready, pick up right here").

## Solution

Email on upload+processing completion: "Your game [name] is ready - start clipping"
with a direct link to the game. Send only when the game reaches genuinely READY state
(post-finalize/activate, durable), never on intent. Reuse the existing transactional
email mechanism. One email per game, deduped. Respect an opt-out (same preference
surface as other notification emails, if any exists; else this is the first, keep it
minimal). Backend-triggered at the same durable completion point T7510 defines for
upload success - coordinate so the event and the email share one emission site.

## Progress Log

**2026-08-27**: Implemented via dotask container, merged [PR #289](https://github.com/imankha/video-editor/pull/289).
Emission site is `activate_game`'s pending->ready transition (not `finalize_upload`, which
only makes R2 bytes durable, before a game_id/ready state exist). Dedup via a rowcount-gated
`UPDATE ... WHERE status != 'ready'` — race-safe against two concurrent activate calls, unlike
a read-then-write check. Guards: impersonation, opt-out (new `notification_email_optout` flag
in the existing user_settings KV — first notification-email preference surface, no migration,
no UI toggle yet since none existed to reuse). Fire-and-forget, never blocks/fails activation.
Deep link `?game=<id>&profile=<id>` stashed to sessionStorage before auth reload, consumed
post-bootstrap. Reviewer caught and fixed a real race: the deep-link poll originally cleared on
the first non-empty games list rather than waiting for the specific target game (matters because
`switchProfile`'s background refetch can transiently show a different profile's list first).
11/11 new backend tests + 18/18 activate-regression tests pass (independently re-verified).
**Not verified**: a real end-to-end send on staging — the container has no mailbox access, only
dev-mode log assertions. Recommend a spot-check: upload a game to READY, confirm exactly one
email with a working deep link, re-activate and confirm no resend.

## Acceptance Criteria

- [x] Email fires exactly once per game at durable-ready, with a working deep link
- [x] No email on failed/pending uploads (those get the T7490 UI, and beacon-informed
      failure handling, not a false "ready")
- [ ] Verified on staging end to end — pending a real-mailbox spot-check (see Progress Log)
