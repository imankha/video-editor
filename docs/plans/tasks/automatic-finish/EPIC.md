# Epic: Automatic finish

## In plain words

A highlight is a finished short clip. Frame is the step where the parent crops around their athlete and pays to sharpen the result. Today, when sharpening ends, the highlight is not finished: it waits on a "Your highlight is ready" panel until the parent taps Finish, and only then does it appear in the Highlights tab where it can be downloaded and shared. That wait was meant as a holding place for a parent who watches the result and wants to redo it. On 2026-11-14 a read of every production account found that it mostly loses highlights instead: 33 parents paid to sharpen a highlight and have nothing in Highlights, against 17 who finished at least one. This epic removes the holding place. A highlight is finished the moment sharpening ends, and redoing it becomes something the parent does to a finished highlight.

**Status:** TODO
**Filed:** 2026-11-14
**Started:** not started
**Impact:** 9 **Complexity:** 6 **Priority:** 1.5
**Placement:** runs before Mark plays with AI (owner, 2026-11-14).
**Evidence:** [finish-step-evidence-2026-11-14.md](../../bi/finish-step-evidence-2026-11-14.md)
**Design:** the server-side finish (T16520) needs an architecture review and the Finished screen changes (T16530) need a design review before they are built.

## Goal

Every highlight a parent pays to sharpen reaches the Highlights tab without a further tap, whether or not they are still looking at the screen, and the parent can still change the crop or the spotlight afterwards.

## Owner decisions (2026-11-14)

1. **The holding place can go.** The owner said the step between exported and finished was only ever meant as a temporary stop for a redo, and that skipping it entirely was acceptable depending on how many parents redo from it.
2. **This runs before Mark plays with AI.**

## What the evidence says

- **Where highlights are lost.** Of 72 exported highlights, 30 are finished, 31 were sharpened and went no further, and 11 had a spotlight rendered but Finish was never pressed.
- **Leaving during the wait.** Sharpening takes a median of 3.5 minutes. 12 of the 31 parents had left before it ended, and today nothing finishes a highlight unless the browser is still open.
- **The panel reads as done.** The headline says the highlight is ready and the exit says "Done for now". At least 12 parents saw the panel and none tapped "Finish without spotlight".
- **Coming back does not help.** 14 stranded highlights had their owner return later and none was finished. Home shows the highlight as "In progress" with no Finish button, and tapping it opens the Spotlight editor.
- **Redo is real but immediate.** 13% of highlights were sharpened a second time, nearly all within 25 minutes. Finished highlights were held about 45 seconds before Finish was pressed. Nobody parks a highlight to reconsider it later.

## How it works (locked unless a task file says otherwise)

- **Finishing happens on the server.** When sharpening completes, the server puts the highlight in Highlights. A closed browser no longer loses it.
- **Nothing is taken away.** Changing the crop and adding or redoing a spotlight stay available, from the Finished screen. A redo replaces the finished video and keeps any share link working.
- **Spotlight is still offered next.** A parent who is still on the screen when sharpening ends is offered Spotlight as now; the difference is that leaving at that point leaves a finished highlight behind.
- **Finished still means private.** A finished highlight is seen only by the parent until they share a link. This epic does not change sharing.
- **The loss is measured first.** The first task records the moment a highlight is finished, so the before and after can be read on the admin Journey.

## Tasks (dependency order)

| ID | Task | Status |
|----|------|--------|
| T16510 | [Record the finish](T16510-record-the-finish.md) | TODO |
| T16520 | [Finish when sharpening ends](T16520-finish-when-sharpening-ends.md) | TODO |
| T16530 | [Redo from the Finished screen](T16530-redo-from-finished-screen.md) | TODO |
| T16540 | [Finish the stranded highlights](T16540-finish-stranded-highlights.md) | TODO |

## Related work outside this epic

- **Spotlight becomes a step (T15800)** makes Spotlight the next screen after sharpening. It builds on this epic: with the highlight already finished, skipping Spotlight costs the parent nothing.
- **Finished screen hub (T15810)** adds Download, Share and Make the next play to the Finished screen. T16530 adds the redo choices to the same screen; whichever lands second fits around the first.

## Completion criteria

- [ ] All four tasks complete.
- [ ] On the admin Journey, finished highlights out of sharpened highlights is at least 95 of 100 for sign-ups after release, against 30 of 72 before.
- [ ] A parent can still change the crop and the spotlight of a finished highlight on phone and desktop.
