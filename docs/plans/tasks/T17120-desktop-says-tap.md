# T17120: Desktop wording says tap

**Status:** TODO
**Impact:** 2
**Complexity:** 2
**Created:** 2026-11-17
**Updated:** 2026-11-17

## In plain words

On a desktop computer, where the parent uses a mouse, several sentences say "tap": the coach says "Tap Upload game. You can start marking plays while it uploads." and "Tap Play to watch the game...", the play editor says "How good was this play? Tap to change", the credit chip's hint says "83 credits. Tap to buy more", and the shared highlight page says "Tap to unmute". It reads as if the app was built only for phones. Desktop wording should say "click" (or a word that fits both).

## How we got here

Found by the full QA pass on 2026-11-17 on staging (build 1e4e0998f), as imankh+qa-2026-11-17b@gmail.com and e2e@test.local, at desktop 1440x900.

## Repro steps

1. Sign in on desktop 1440x900 with Guidance on.
2. Open "Upload game" and pick a file; read the coach. Open a game; read the coach. Mark a play; read the line above the rating. Hover the credit chip. Open any shared highlight link.

**Expected:** desktop wording does not say "tap".
**Actual:** the five sentences above say "Tap".
**Repeats:** always
**Also checked at:** phone and iPad, where "tap" is correct.

## Evidence

- Screenshots: `.playwright-mcp/np-72-desktop-annotate.png`, `np-67-shared-desktop.png` (local, not in git)
- Console, network, server log: nothing relevant.

## Solution

No sentence shown on a mouse-driven desktop says "tap".

## Relevant Files

Not investigated.

## Acceptance Criteria

- [ ] C1: At 1440x900, the five sentences listed above do not say "tap".
- [ ] C2: At 390x844 touch they still read naturally.
