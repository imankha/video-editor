# T17670: A retried storage extension charges twice

**Status:** WIP
**Impact:** 6
**Complexity:** 2
**Created:** 2026-11-18
**Updated:** 2026-11-18

## In plain words

When a parent extends a game's storage, we charge credits. T17620 fixed a hole where a second extension in the same second was free, by giving every charge a random key. Now nothing stops one tap from being charged twice if the same request is sent again (a double tap, or the browser or network resending it). One tap should charge once; two real taps should charge twice.

## How we got here

Follow-up to T17620 (PR from group g-t17620-1, approved by the owner 2026-11-18 with this follow-up). Before T17620 the charge key in `extend_game_storage` (`src/backend/app/routers/games.py`) was `{profile_id}:{game_id}_{YYYYmmddHHMMSS}`, which deduplicated a resend only within the same second and made a second real extension in that second free. T17620 appended `uuid4().hex[:8]`, so every request is a new charge.

## Solution

The client creates one request id per Extend tap (in `StorageExtensionModal.jsx`) and sends it with the request; the server uses it as the charge's `reference_id`, so a resend of the same tap replays the same debit (no second charge, no second extension) and a new tap is a new charge. A missing request id is a client bug: reject it loudly (400), no silent fallback to a random key.

## Relevant Files

- `src/backend/app/routers/games.py` (`ExtendStorageRequest`, `extend_game_storage`)
- `src/frontend/src/components/StorageExtensionModal.jsx` and its test
- `src/backend/tests/test_shared_game_extension.py` (T17620's test)
- Knowledge doc: `.claude/knowledge/backend-services.md`

## Acceptance Criteria

- [ ] C1: Sending the same extend request twice (same request id) charges once and extends once.
- [ ] C2: Two separate taps (different request ids), even in the same second, charge twice and extend twice.
- [ ] C3: A request without a request id is rejected with a clear 400 and charges nothing.
- [ ] C4: The Extend storage dialog sends one request id per tap; a double tap on the button does not produce two charges.
