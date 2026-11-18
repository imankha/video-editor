# T17380: A failed upload for lack of credits leaves a stuck game

**Status:** STAGING
**Impact:** 7
**Complexity:** 4
**Created:** 2026-11-18
**Updated:** 2026-11-18

## In plain words

When a game upload fails because the parent has too few credits, the upload entry is dropped from the screen but the game it created stays behind in a pending state, so the parent sees a game that never finishes and cannot tell why.

## How we got here

Follow-up to T17280. Bug 62p's logs show the sequence: upload part retried, then 'Upload failed: Insufficient credits: need 2, have 1'. The T17280 worker found that the upload store's insufficient-credits branch retires the entry even when the pending game was kept (T8180).

## Solution

A game whose upload fails for lack of credits is not left half-made: either it is cleaned up, or it shows as a failed upload with a clear way to retry after buying credits.

## Relevant Files

Not investigated. Start from the knowledge doc `.claude/knowledge/annotate.md` and the upload path named above.

## Acceptance Criteria

- [ ] C1: After an upload fails with insufficient credits, Home shows no orphan pending game, or shows it as a failed upload that explains credits and can be retried.
- [ ] C2: Retrying after buying credits completes the upload.
- [ ] C3: A regression test covers the insufficient-credits branch.
