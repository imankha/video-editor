# T16690: A game upload can go through without charging its credits

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-11-16
**Updated:** 2026-11-16

## In plain words

Uploading a game shows "Cost: 2 credits" (1 credit to store it for 30 days, 1 for the automatic highlight). On 2026-11-16 a full walk of staging uploaded a 4.6 MB game and the balance stayed at 848 afterwards, so the game was kept without being paid for. We think the cause is how the charge is made safe to repeat: each charge is stored under a key made from the game's number (`game_upload:<game id>`), and the ledger refuses to charge the same key twice for the same account. Game numbers only count up inside one profile, so two different games can share a number: game 4 in one profile and game 4 in another profile of the same account, or a game made after the account's data was reset while the old ledger kept its keys. The second game then finds its key already used, is treated as "already charged", and is not charged. Done when uploading a game always charges its cost once, whichever profile it is in and however many games the account had before.

## How we got here

The charge is made when the upload is activated (`activate_game` in `src/backend/app/routers/games.py`, `deduct_credits(user_id, upload_cost, source="game_upload", reference_id=str(game_id))`). The ledger turns that into a key `game_upload:<game id>` (`credit_key` in `src/backend/app/services/credit_ledger.py`) and `debit` skips a key it has already seen for that user, so a retried request never charges twice. The same shape is used by game video adds (`game_video_add`) and storage extensions. The ledger lives in the shared database per user, while games and their numbers live in each profile's own database.

The staging account has several profiles and had earlier games and resets, so a collision is plausible. This is a suspicion from reading the code, not yet shown: the first job is to prove or disprove it.

## The problem

If the suspicion is right, a parent with a second profile (or a reset account) gets free storage for any game whose number was used before, and our own staging checks and credit numbers are wrong. If it is wrong, the balance not moving is a different bug and we need to find it.

## Solution

1. Reproduce: on a stack, make two profiles on one account, upload a game in each, and read the credit history. Record whether the second upload was charged. Also read the staging account's credit history for the upload on 2026-11-16 (a charge row for that game, or its absence).
2. If confirmed, make the key unique per game across profiles (for example include the profile in the reference) without double-charging a genuine retry of the same game, and cover game video adds and storage extensions if they share the problem.
3. If not confirmed, find why the balance did not move (a free first upload, a stale balance in the app, a missing charge row) and fix that instead.

## Why

Credits are what we sell. A path that stores a parent's game for free is a silent loss, and it hides behind a message that says the upload costs 2 credits.

## Relevant Files

- `src/backend/app/routers/games.py` (activate_game, game video add, storage extension)
- `src/backend/app/services/credit_ledger.py` (credit_key, debit, KEY_PREFIX)
- `src/backend/app/services/storage_credits.py` (calculate_upload_cost)
- Knowledge docs: `persistence-sync.md`, `backend-services.md`

## Acceptance Criteria

- [ ] C1: A test uploads a game in each of two profiles of one account (the same game number in both) and shows both are charged.
- [ ] C2: Retrying the activation of the same game charges it once.
- [ ] C3: After the fix, a game uploaded on a stack lowers the balance by the cost the upload dialog showed.
