# T16210: Remaining small touch targets on phone and iPad

**Status:** WIP
**Impact:** 4
**Complexity:** 3
**Created:** 2026-11-12
**Updated:** 2026-11-12

## In plain words

**Today.** On a phone or iPad, ten buttons and links are now at least 44 by 44 pixels, the size Apple and the web accessibility rules call the minimum for a finger: the five sign-in controls, the Share and Download buttons on a shared highlight, the REEL BALLERS link, the logo link on a shared annotation page, and the 1x speed chip in Annotate (task T15600, 2026-11).

**The problem and how we got here.** The 2026-11-09 staging QA measured about twenty controls under 44 pixels. T15600 fixed them in the shared button, but its browser check could only reach ten of them. The other eleven were never measured after the fix, so we do not know whether they are still too small. The owner agreed on 2026-11-12 to land T15600 on the ten it proves and file the rest here. They are: Annotate's play-count chip, the time labels and fullscreen Mark play; the Plays list's View details, Jump to play and Hide plays; Frame's Portrait/Landscape chip; Spotlight's number chips, Delete spotlight and the toast's View and Dismiss; the Gallery header; Open ReelBallers on the share page; and Tap to unmute.

**What we will do.** Measure each of the eleven on an iPhone 14 and an iPad, fix any under 44 pixels, and write a browser check that reaches each one the way a parent does.

**Why.** A parent trimming a clip on a phone mis-taps small controls. Some of these (the Plays list buttons and Spotlight chips) sit on the main editing path.

**How we will know it worked.** A browser check measures each of the eleven at both sizes and passes, on the dev stack and on staging.

## Implementer details

- Known blockers from T15600's check (`src/frontend/e2e/checks/T15600.check.spec.js` header): the Plays-list buttons render only in the wide sidebar, not in the coarse-pointer mobile layout; the Frame chip needs a draft with crop positions that the seeded fixture lacks; Spotlight chips and toasts need a highlight region set up; Tap to unmute uses its own padding in VideoControls.
- Original measurements are in T15600's Problem section.

## Acceptance criteria

- [ ] C1: Each of the eleven listed controls measures at least 44x44 px on iPhone 14 and iPad, proven by a browser check that reaches it as a parent would.
