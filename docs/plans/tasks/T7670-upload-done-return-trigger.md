# T7670: Upload-complete email: turn the long wait into a return trigger

**Status:** TODO (post-P1; user 2026-08-24: not a priority vs blocking bugs)
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

## Acceptance Criteria

- [ ] Email fires exactly once per game at durable-ready, with a working deep link
- [ ] No email on failed/pending uploads (those get the T7490 UI, and beacon-informed
      failure handling, not a false "ready")
- [ ] Verified on staging end to end
