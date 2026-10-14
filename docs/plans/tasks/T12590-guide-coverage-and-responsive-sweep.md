# T12590: Screen-by-screen sweep on staging: a guide on every screen, the right guide, and a readable layout at phone, tablet and desktop

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Tier:** S (verification and docs; every gap it finds becomes its own task)
**Created:** 2026-10-11
**Updated:** 2026-10-14
**Priority placement:** user-ordered 2026-10-11 at the priority T11900 held, as the closing rows of the Parent Usability Audit milestone.

## Problem

The guide spine (T12230 through T12360) covers the states its authors enumerated, not every screen a
user can land on. Nobody has walked the whole app asking "does this screen tell me what to do next,
and is that the right next thing?" Two further things are unchecked:

- **Does the guide push the shortest path to another export?** A guide can be true and still send the
  user sideways instead of toward their next finished highlight.
- **Does it change after the user has done it twice?** A parent on their third highlight does not need
  "tap Mark play"; they need to know the app can do more (aspect ratio, trim, straighten, background
  dim, text, spotlight). Today the copy does not know how many highlights a user has finished.

And the same screens have never been read side by side at the three sizes real parents use.

## Solution

One staging pass over every screen and state, producing one results doc plus filed tasks. Three
questions per screen, at three viewports:

1. **Coverage:** is there a guide? If not, what should it say?
2. **Content:** does it point at the shortest path to another export? If the account has two or more
   finished highlights, does it instead invite the user into the advanced settings?
3. **Layout:** at desktop, iPad and iPhone, is everything readable, is nothing confusing, and does the
   visual hierarchy still put the main action first?
4. **Guidance dialog placement:** is the guidance dialog always positioned near the item the user is
   probably looking at, but more central than that item? It sits on the side of the item that faces
   the middle of the screen: above the item when the item is at the bottom of the screen, below it
   when the item is at the top, and toward the center horizontally when the item is at a left or
   right edge. It never covers the item it describes and never lands off-screen. Check this at every
   viewport, since the item's position (and so the dialog's side) changes with the layout.

This pass also **closes the [Parent Usability Audit](parent-usability-audit/README.md) milestone**. Its
re-audit was folded in here 2026-10-11 (T11900 is OBSOLETE): that task had become a findings table
written from someone else's screenshots, and this walk covers its three viewports and all eight of its
journey screens. The 12 audit findings get their own section of this task's RESULTS.md, so the parent
journey is not driven a third time.

### Viewports

| Name | Size | Why |
|------|------|-----|
| Desktop | 1440x900 | the original audit size |
| iPad landscape | 1024x768 | tablet, wide |
| iPad portrait | 768x1024 | tablet, tall (the half-empty grid case) |
| iPhone | 390x844 | the majority phone case |

Plus the existing `assertNoHorizontalOverflow` sweep at 320, 360, 375, 390 and 768 on /annotate,
/focus, /overlay and /home.

## Context

### Relevant Files (REQUIRED)

Read-only for this task; findings become separate tasks.

- `src/frontend/src/components/instructions/resolveGuide.js` - `GUIDE_RULES` and `GUIDE_STATES` are the claimed coverage; the sweep checks them against the real app
- `src/frontend/src/config/displayNames.js` (`GUIDE`, `FRAMING_GUIDE`, `EDITOR_PANELS`) - the copy table every rule reads
- `src/frontend/src/components/instructions/catalog.js` - how screens build facts
- `docs/plans/ux/2026-10-08-staging-qa-walkthrough/re-run/RESULTS.md` - the previous pass, so findings are not re-filed
- `docs/plans/ux/2026-10-04-parent-usability-audit/reelballers-ux-audit.md` - the 12 parent-audit findings this pass must report on (plus `desktop-findings.md`, `tablet-findings.md`, `iphone-findings.md`)

### Related Tasks

- Absorbs: T11900 (parent-journey re-audit, OBSOLETE 2026-10-11). Closing the Parent Usability Audit milestone is now a step and an acceptance criterion here.
- Preferred after: T12580 (shaded guide steps), T12440, T12450, T12470, T12480, T12530 (layout and
  placement fixes). Not a hard block: if T12580 is not on staging yet, audit the guidance that is
  there and re-check the shaded version separately.
- Likely child: the guide spine has no "finished highlight count" fact on the editor screens, so the
  "after two exports, show the advanced settings" rule needs one. File it as its own task from this
  pass rather than widening this one.

### Screen inventory to confirm and complete

Start from this list, then add anything the walk reaches that is not on it. Admin screens and
developer diag routes are out of scope.

- Sign-in and auth gate; a lost or expired session
- Home: Games, Clips, Finished tabs, each empty and populated; a lone game
- Upload: choose file, details, submit, in flight, failed, game details modal, add footage
- Annotate: nothing marked, playing, one play, several plays, play editor, tags and notes, the
  post-Done choice card, review plays, expired source
- Focus: drag, play, trim split and adjust, keep the box, preview, generate, generating, finishing,
  failed, needs credits, ready panel, settings panel (aspect ratio, straighten, background dim)
- Overlay: spotlight pick walk (first, confirm, away, not outlined, nothing detected, done), text
  lane and the text sheet, generating, failed, ready panel
- Finished: the viewer, the share modal, the share and claim pages a recipient sees
- Account and billing: account settings, buy credits, credit history
- Error and edge: too large to export, clip upload limits, report a problem

### Content criteria (what "the right guide" means)

- Every state names one next action, in the user's words, and that action is on the shortest path to
  the user's next finished highlight.
- Fewer than two finished highlights: the guide drives the core path (mark a play, frame it, generate,
  finish) and never advertises an advanced control.
- Two or more finished highlights: the guide invites the user to try the advanced controls (aspect
  ratio, trim, straighten, background dim, text, spotlight) instead of repeating the basics.
- No jargon from the previous findings lists; no claim that the app frames, tracks or follows
  automatically (the user frames and picks, the app smooths and sharpens).

### Placement criteria (where the guidance dialog sits)

- Anchored near the item the user is probably looking at (the control or region the guide step is
  about), not parked in a fixed corner.
- Biased toward the screen center relative to that item: above it for an item near the bottom, below
  it for an item near the top, inward for an item near a left or right edge.
- Does not cover the anchor item, the video, or the primary action; stays fully on-screen at all four
  viewports and with the phone keyboard or browser chrome showing.
- Record the anchor item, the dialog side, and a pass/fail per viewport in RESULTS.md.

## Implementation

### Steps

1. [x] Use a fresh staging fixture account (never a real user's) with credits for one upload and one
       generation; drive it with Playwright per `reference_drive_app_as_user`.
2. [ ] Walk the inventory above at 1440x900, 1024x768, 768x1024 and 390x844. Screenshot every screen
       and state at every size into `docs/plans/ux/2026-10-11-guide-coverage-sweep/screens/`
       (keep them local, as T12310 did; do not commit ~200 images).
3. [x] Run the `assertNoHorizontalOverflow` sweep at 320, 360, 375, 390 and 768 on /annotate, /focus,
       /overlay and /home.
4. [x] (same account, after its second finish) Repeat the pass on a second fixture account that already has two or more finished highlights,
       to judge the "advanced settings" half of the content rule.
5. [x] Write `docs/plans/ux/2026-10-11-guide-coverage-sweep/RESULTS.md`: one row per screen and state
       with guide yes/no, the rule id that fired, a content verdict (shortest path / sideways /
       missing / should be advanced), a layout verdict per viewport, a dialog-placement verdict per
       viewport (anchor item, side, near-and-central pass/fail), and the screenshot link.
6. [x] File one task per gap (T12620 to T12710) (missing guide, wrong guide, unreadable layout, broken hierarchy),
       grouped the way T12440 through T12570 were grouped rather than one task per screen.
7. [x] Parent Usability Audit close (folded in from T11900): add a section to RESULTS.md giving each of
       the 12 audit findings fixed / partly fixed / not fixed with the screenshot that shows it, and
       record the one known gap, T11890 (silent Google sign-in failure), as "not verified: T11890 was
       closed 2026-10-09 by user decision without the Google console origin check or a real-device
       repro; `[auth-diag]` log lines are the only signal". Point
       `docs/plans/tasks/parent-usability-audit/README.md` at that section.
8. [x] Set `WAITING ON USER` with the RESULTS link: whether the guidance now reads clearly is the
       user's judgment.
9. [x] Commit docs with a subject starting `T12590:`.

### Progress Log

**2026-10-11**: Filed from the user's request, together with T12580. Not started.

**2026-10-12 (live walk)**: Staging walk done at 1440, 1024, 768, 390 (RESULTS.md). 10 gap tasks filed, T12620 to T12710. Ticked: overflow sweep passes (20 of 20 cells), content rule checked on both account shapes, every no-guide screen has a ruling or a task, every not-fixed row maps to a task. NOT ticked: full inventory screenshots at all four viewports (blank states past the first upload, failing-upload and credit-failure states, recipient pages were unreachable, listed in RESULTS.md section 8), per-viewport placement verdict for every guided screen (some cells n/t), CRITICAL and HIGH audit findings proven (finding 1 is partly open, T12630). Step 2 stays open for the same reason, step 8 (WAITING ON USER) is the caller's call. Status left WIP.

**2026-10-12**: Added guidance-dialog placement to the sweep (user request): near the item the user is
probably looking at, but more central (above if the item is at the bottom of the screen, etc.).

## Acceptance Criteria

- [ ] Every screen and state in the confirmed inventory has a screenshot at all four viewports, or a
      recorded reason it is unreachable on the fixture account.
- [ ] RESULTS.md gives every screen a coverage verdict, a content verdict and a layout verdict per
      viewport.
- [ ] Every guided screen has a dialog-placement verdict per viewport: the dialog sits near the item the
      user is probably looking at, on its more central side (above for a bottom item, etc.), without
      covering it or leaving the screen; each failure maps to a filed task.
- [x] Every screen with no guide either has one specified in a filed task or a recorded reason it
      needs none.
- [x] The content rule is checked on both account shapes: under two finished highlights and two or more.
- [x] Every "not fixed" or "needs work" row maps to a filed task id.
- [x] The overflow sweep passes, or each failure is a filed task.
- [ ] Every CRITICAL and HIGH parent-audit finding has a screenshot proving the fix or a filed
      follow-up task, and the full journey completes at 1440 with no step that needs a hidden gesture
      (the Parent Usability Audit close, with no second journey run).

**2026-10-14 (WAITING ON USER)**: Container session has no staging browser or fixture account, so the open
items (step 2 full-inventory screenshots, per-viewport placement cells marked n/t, CRITICAL/HIGH audit
proof) cannot be produced here. To unblock: after Epics A to D are on staging, re-run the walk with a fresh
fixture account (credits for one upload and one generation) per RESULTS.md section 8 and fill the n/t cells;
then tick the remaining acceptance boxes. Resolve is the user's gesture.


**2026-10-14 (back to TODO)**: Not a user wait. Epics A to D are on staging (all STAGING in PLAN.md), so the re-walk is unblocked except for build order: it runs from a HOST session (Playwright against staging plus a fixture account; see reference_staging_gate_v2_runbook and reference_staging_reset_needs_fly_auth), not a container, after the last epic shipping in this build lands. Whether Epic F ships first is decision 1 in https://claude.ai/artifact/SDeWeJ5qnaB3G64jn85iLU.