# Milestone: Staging QA Walkthrough (filed 2026-10-08, user-ordered TOP PRIORITY)

**Status:** TODO. All 18 decisions ruled 2026-10-08: every recommendation approved except **Q15 = C** and **Q16 = A**. Tasks are written for the ruled options.
**Source:** a first-time-user Playwright walkthrough of staging (blank account, upload a game, mark a play, frame it, spotlight it, finish it). Findings, screenshots and the recommended guide copy:
[findings.md](../../ux/2026-10-08-staging-qa-walkthrough/findings.md) (screenshots in `screens/`).
**Decision report with mockups (picks save there and Claude reads them back):** https://claude.ai/artifact/E5KKydoV5gngJ9nXa14ftm

Root causes were verified against master `c6e6708fa` by four Opus expert agents (bugs, plain language, CTA system, guide architecture). All 8 bugs were still present on that revision; the recent CTA and guidance commits fixed none of them.

Relation to [Parent Usability Audit](../parent-usability-audit/README.md): that milestone already shipped rating legibility (T11840), Mark Plays rename (T11850), ready-screen copy (T11810), Finished rename (T11820) and one upload progress number (T11870). Tasks here must not redo them; they keep those testids and copy.

## Goal

A first-time parent goes from a blank account to a finished, shareable highlight without a wrong turn: nothing overlaps, the main action is always first and looks the same everywhere, every label says what the user wants to do, and with Guidance on every screen says the next step.

## Epics (listed in the order requested; sequencing below)

| Epic | Tasks | Gist |
|------|-------|------|
| [1. Bugs](bugs/EPIC.md) | T11950-T12000 | Corner overlaps, stale ready handoff, silent spotlight taps, debug label, viewer close landing, blob 404 |
| [2. Confusing moments and jargon](plain-language/EPIC.md) | T12110-T12220 | Plain labels, progress words, tabs, rating, sport, finished tab, share modal |
| [3. Styling and CTA consistency](cta-consistency/EPIC.md) | T12010-T12100 | One CtaBar, main first, one primary colour, tab badges |
| [4. Guide correction](guide-correction/EPIC.md) | T12230-T12300 | One resolver, correct copy and placement for every state |
| Close | [T12310](T12310-re-run-staging-walkthrough.md) | Re-run the walkthrough at 1440 and 390 |

Findings that are fixed inside another epic: **B1** (guide covers Upload game) by T12240; **B3a/B3b** (bottom bar wraps and covers video) by T12020 and T12030, because both rework the same bar.

## Recommended sequence and file conflicts

Up to four epics can run in parallel if the shared files below are sequenced.

1. Independent quick wins first: T11960, T12000, T12110, T12100.
2. Foundation: T12010 (CtaBar) before T12020-T12100 (except T12100); T12230 (resolver spine) before T12240-T12290; T12240 needs T11950 (corner controls) landed.
3. B-fixes that unblock guide work: T11970 before T12270; T11980 before T12280.
4. Shared-file order: `config/displayNames.js` (Epics 2 and 4, run T12110 first); `ExportButtonView.jsx` (T12020 then T12030); `AnnotateFullscreenOverlay.jsx` (T12070 then T12150); Share modals (T12080 then T12210); `OverlayModeView.jsx` (T12030, T11980, T12280 in that order); `ProjectManager.jsx` (T11950, T12100, T12220, T12250 in that order).
5. Branch CI does not run Playwright specs: run `e2e/cta-consistency.spec.js` and the per-task Playwright checks locally.

## Standing rules for every task here

- Copy: no em dashes, never "Saved" as UI copy, never claim AI frames or tracks on its own (the user frames and picks, AI proposes and upscales), a play makes a clip and the finished product is a highlight.
- Persistence: gesture-based only. Guidance state, tip bars, `--cta-bar-h` and similar are view state, never written reactively.
- Each behaviour change needs a test that failed first (Landing Policy). Fresh-context reviewer per M-tier task.
- Update the touched `.claude/knowledge/` doc in the same commit when an invariant or entry point moves.

## Vocabulary (from the plain-language expert; applies to all new copy)

| User goal | The word | Button | Progress | Confirmation |
|---|---|---|---|---|
| Mark a play | Mark play (noun: play) | Mark play / Done | n/a | n/a |
| Turn a play into a highlight | Make highlight | Make highlight (one string everywhere) | n/a | n/a |
| Point the video at my player | Frame (the rectangle you drag is the 'box', Q15 = C) | Edit framing | n/a | n/a |
| Create the video | Generate | Generate highlight (Focus and Overlay; drop "with overlay") | Getting your video ready, Generating your highlight, Sharpening the picture, Finishing up | Highlight ready |
| Show which kid is mine | Spotlight (paired with "show which athlete is yours" on first sight, Q7 = C) | Add spotlight / Redo spotlight | Adding your spotlight | Highlight with spotlight ready |
| Done editing | Finish | Finish / Finish without spotlight | n/a | Finished |
| Send to others | Share | Share / Copy link / Download / Create share link | Creating link | Link copied |

The child is "your athlete" (Q15 = C), never "your player". Drop from parent-facing copy: "overlay" (use spotlight), "tracker", "frame N" meaning a video still (use "moment N"), "auto-detect", progress counters like 15/92, "Saved", em dashes and `--`.

## Decision register

Ruled 2026-10-08 by the user (chat), mirrored in the stored picks of the [decision report](https://claude.ai/artifact/E5KKydoV5gngJ9nXa14ftm). Rulings are recorded in the last column.

| # | Decision | Recommended | Gates | Ruling |
|---|---|---|---|---|
| Q1 | Bottom action row shape | A cards + solid primary | T12010-T12070 | A (recommended) |
| Q2 | One primary colour (and repoint Button primary) | A cyan, dark text | T12010, T12080 | A (recommended) |
| Q3 | Delete in the play editor | A last, quiet | T12010, T12070 | A (recommended) |
| Q4 | Guidance switch and corner stack | A header chip + clean corner | T11950, T12300 | A (recommended) |
| Q5 | Guide surface | A bubble on desktop, tip bar on phone | T12230, T12240 | A (recommended) |
| Q6 | Header mode tabs | B contextual tabs | T12130 | B (recommended) |
| Q7 | Introducing 'Spotlight' | C meaning first, word second | T12130, T12120 | C (recommended) |
| Q8 | Rating scale display (+ rename Lapse words) | A each cell shows its own stars | T12140 | A (recommended); rename to Decision miss / Skill miss approved with it |
| Q9 | Where to pick a sport | B in the upload modal | T12160 | B (recommended) |
| Q10 | My athlete / Team lanes | B one lane until a Team play exists | T12170 | B (recommended) |
| Q11 | Finished tab with one highlight | B one consolidated card | T12200 | B (recommended) |
| Q12 | Spotlight-pick guide placement | A strip under the video | T12280 | A (recommended) |
| Q13 | Tap inside the spotlight circle | A moves spotlight and counts as the pick | T11980 | A (recommended) |
| Q14 | X on the finished viewer | A Finished tab | T11990 | A (recommended) |
| Q15 | Words: crop rectangle and child | B 'box' and 'your player' | T12120-T12280 (many strings) | **C**: crop rectangle = 'box', child = 'athlete' (T9860 wording kept; 'My athlete' stays) |
| Q16 | Guidance default | B on until the first export | T12300 | **A**: Guidance on until the user turns it off; the value must persist (T12300 re-scoped) |
| Q17 | Replace user-approved empty-state headlines | A approve replacements | T12200, T12220 | A (recommended) |
| Q18 | Modal button order | A main first in modals | T12080 | A (recommended) |

Defaults taken unless the user objects: locked steps stay visible with a lock and reason; Portrait and Landscape slots stay two equal choices; review mode primary is Share plays; Clips empty state primary is Go to Games when a game exists; tab badges show totals including 0 with a separate new dot; `.claude/references/ui-style-guide.md` is the only style guide.
