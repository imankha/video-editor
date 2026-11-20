# T16204: One-click spotlight from AI boxes

## In plain words

To finish a highlight (a finished short clip) today, the parent goes through the Spotlight step: they find their athlete in the opening frames and place the spotlight by hand. For a play that came from AI Coach we already hold four boxes showing where each noted player is during the play's first two seconds (T16150). We will use them to fill the spotlight in: the Spotlight step opens with the spotlight already on the athlete, and the parent confirms with one click or adjusts it as today. Parents asked to click their kid once, not once per play; this is the part of that we can deliver now. Done when a play with boxes reaches a finished spotlight in one click, and a play without boxes goes through the Spotlight step exactly as today.

**Status:** TODO
**Impact:** 8
**Complexity:** 5
**Tier:** M (Spotlight step; no new stored data beyond what the confirm click already writes)
**Created:** 2026-11-20

Epic: [mark-plays-with-ai/EPIC.md](EPIC.md). Runs after T16203. Owner request 2026-11-20.

## Problem

The Spotlight step is manual, and it sits between a marked play and a shareable highlight. AI Coach removes the scrubbing but leaves this step untouched, so a parent with forty AI plays still places forty spotlights.

## Solution

1. **Offer, do not write.** When the Spotlight step opens on a play whose athlete mention has at least two visible boxes, the four boxes are turned into spotlight keyframes in memory and shown as a proposal. Nothing is saved by opening the step.
2. **One click.** "Use this spotlight" saves the proposed keyframes with the same call the manual flow uses for its keyframes. That click is the gesture; there is no other write.
3. **Adjust or discard.** The parent can drag any proposed keyframe before or after accepting, exactly as with keyframes they placed themselves, or clear the proposal and place the spotlight by hand.
4. **No boxes, no change.** A play without boxes, or whose athlete is not marked, opens the Spotlight step as today.
5. **Measure.** `spotlight_proposed`, `spotlight_accepted` (unchanged or adjusted) and `spotlight_discarded`, so we know whether the boxes are good enough to remove the step entirely later.

## Why this and not something else

Applying the spotlight with no click at all was considered. It was left for later because the prototype has not yet shown how often a box lands on the wrong player, and a saved spotlight on the wrong child is worse than one extra click. The accepted and discarded counts from this task are what that later decision needs. Following the athlete for the whole clip, not only its first two seconds, needs tracking, which the 2026-11-20 prototype showed is not reliable enough yet.

## For the implementer

### Relevant Files (REQUIRED)
- `src/frontend/src/modes/overlay/` (Spotlight step, highlight keyframes), `src/frontend/src/api/overlayActions.js`
- `.claude/knowledge/keyframes-framing.md` (keyframe identity and origin rules; read first)
- `raw_clips.ai_source` (boxes per mention, from T16190)
- `src/backend/app/analytics.py` (three events)

### Technical Notes
- Proposed keyframes are a runtime value. They are never persisted until the accept click; loading the step must not trigger any write.
- Convert each box to the spotlight's own shape and coordinate space (centre and size, in the play's framed crop). A box outside the crop is dropped from the proposal.
- Keyframes are frame-based, not time-based: convert 0, 2/3, 1 1/3 and 2 s with the clip's real frame rate; never assume one.
- The accept click sends only the highlight keyframes, through the existing action.

### Related Tasks
- Depends on: T16150, T16190, T16200. Related: T16203 (same boxes, playback highlight).

## Acceptance Criteria

- [ ] On a play whose athlete mention has boxes, the Spotlight step opens with a proposed spotlight on the athlete over the first two seconds, and no request that writes is sent until the parent clicks.
- [ ] "Use this spotlight" saves the keyframes in one call; the saved spotlight plays back on the athlete.
- [ ] The parent can adjust a proposed keyframe or discard the proposal and place the spotlight by hand.
- [ ] A play without boxes, or with no marked athlete, opens the Spotlight step exactly as today.
- [ ] `spotlight_proposed`, `spotlight_accepted` and `spotlight_discarded` appear in the admin Journey inspector.
