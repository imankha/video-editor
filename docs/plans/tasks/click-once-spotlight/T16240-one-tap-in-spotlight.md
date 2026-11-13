# T16240: One tap in Spotlight

## In plain words

Today, in Spotlight (the step that draws a circle that follows the athlete), the parent is walked through four frames and taps their athlete on each one. On a phone that is four precise taps on small boxes, and the circle still only glides between them. With this change the parent taps their athlete once, on the first frame. The screen says truthfully that it is following the athlete and how far it has got, then plays the spotlight back with the circle on them. The other three frames no longer ask for anything. If following is unavailable or fails, the screen carries on with today's four taps and one plain line saying why. Done when a parent on a phone gets a followed spotlight from one tap, and a forced failure lands them in the four-tap flow without an error screen.

**Status:** TODO
**Impact:** 9
**Complexity:** 6
**Created:** 2026-11-12
**Updated:** 2026-11-12
**Milestone:** Click-once Spotlight (see [EPIC.md](EPIC.md)). Task 3 of 6. Needs a design review of the screen states before it is built.

## How we got here

Parents who finish Spotlight are the ones who come back: 5 of 22 parents who exported a spotlight returned and all 5 payers were among them, against 2 of 30 who did not. The four-tap guide was added in 2026 to make picking the athlete discoverable; it works, but it is still four taps, and the epic's prototype showed one is enough on most highlights.

## The problem

Every extra tap in Spotlight is a chance to stop, most of all on a phone. And the result of four taps is worse than following: the circle cuts the corner when the athlete turns between two of them.

## What we will do

1. The guide asks for one tap: "Tap your athlete" on the first frame.
2. On that tap the app starts following and shows a short, honest state on the video: following, with real progress, and a way to carry on by hand instead of waiting.
3. When the result arrives the spotlight plays once from the start so the parent sees the circle on their athlete, and the guide shows it as complete.
4. The remaining frame markers stop asking for a tap. The parent can still open any of them and tap a different person to correct the path from there (T16250 builds the correction properly).
5. If following fails, is switched off, or passes a time limit, the guide continues with the next frame as it does today, with one line: "We couldn't follow your athlete here. Tap them on each frame."
6. Every existing gesture stays: dragging the circle, resizing it, deleting a spotlight, adding one.

## Why this and not something else

Following could start with no tap at all, guessing the athlete. Today's guess is often wrong when several players are in view, and a wrong circle that looks confident is worse than one tap. Keeping the tap also keeps the fallback simple: it is the first tap of today's flow.

## How we will know it worked

- [ ] On a phone and on desktop, one tap on the athlete on the first frame produces a spotlight that follows them for the whole spotlight, with no further prompt.
- [ ] The progress shown matches the server's real progress; nothing is shown as done before it is.
- [ ] With the follower forced to fail, the parent sees one plain line and the four-tap flow continues from the second frame; no error screen, no lost tap.
- [ ] Choosing to carry on by hand while following is running cancels the wait and discards its result.
- [ ] A spotlight made by following exports and re-opens like any other.
- [ ] Reduced-motion settings are respected by the new states.

## For the implementer

### Design notes
- L tier with a design gate: the UX designer defines every state and string (waiting, progress, done, failed, switched off, carry on by hand) at phone and desktop widths before implementation. The strings above are placeholders for that review.
- The tap is the existing `handlePlayerSelect` gesture; the follow request, and the save of its result, hang off that gesture (no `useEffect` persistence).
- `useGuidedAthletePick` and `detectionAssignmentStates` decide which markers still need a pick: a region with a completed follow must count as fully picked. Use the following marker from T16230, not `fromDetection`.
- Late results: if the parent has moved or edited the region while waiting, drop the result rather than overwrite their edit.
- Guide copy and pulse targets follow `.claude/knowledge/guidance.md`.

### Related Tasks
T16220 (the job and its progress), T16230 (the points it saves), T16250 (corrections), T15800 (Spotlight becomes a step), T15470 and T15740 (phone Spotlight layout bugs), T9620 and the guided-pick work recorded in `keyframes-framing.md`.

### Relevant Files (REQUIRED)
- `src/frontend/src/screens/OverlayScreen.jsx`
- `src/frontend/src/modes/overlay/hooks/useGuidedAthletePick.js`
- `src/frontend/src/modes/overlay/components/SpotlightPickGuide.jsx`
- `src/frontend/src/modes/overlay/utils/detectionAssignment.js`
- `src/frontend/src/modes/overlay/overlays/PlayerDetectionOverlay.jsx`
- `src/frontend/src/modes/overlay/layers/DetectionMarkerLayer.jsx`
- `src/frontend/src/modes/overlay/hooks/usePlayerDetection.js`
- `src/frontend/src/config/displayNames.js`
- `.claude/knowledge/keyframes-framing.md`, `.claude/knowledge/guidance.md`
