# Milestone: Parent Usability Audit (filed 2026-10-04)

**Status:** TODO. All 15 decisions ruled 2026-10-04 (14 as recommended; U2 replaced by an investigation).
**Source:** an external parent usability test of **staging**, run 2026-10-04 at desktop
(1440x900), tablet (768x1024) and iPhone (390x844). The desktop tester completed the full journey:
upload, mark a play, frame it, generate, and save an 8-second portrait draft. Getting there meant
learning hidden rules and editor jargon.

- Audit and screenshots (copied into the repo):
  [reelballers-ux-audit.md](../../ux/2026-10-04-parent-usability-audit/reelballers-ux-audit.md),
  [desktop](../../ux/2026-10-04-parent-usability-audit/desktop-findings.md),
  [tablet](../../ux/2026-10-04-parent-usability-audit/tablet-findings.md),
  [iPhone](../../ux/2026-10-04-parent-usability-audit/iphone-findings.md).
  **Some screenshot filenames do not match what they show.** `tablet/03` is the Focus screen;
  `tablet/02` is the narrow tablet home; `iphone/04` shows the loaded 6-play state. Open the image
  before citing it.
- UX expert design proposals (one ui-designer per decision area; each lists options, pros, cons
  and exact Tailwind classes):
  [focus-unlock.md](../../ux/2026-10-04-parent-usability-audit/design/focus-unlock.md),
  [responsive.md](../../ux/2026-10-04-parent-usability-audit/design/responsive.md),
  [after-generate.md](../../ux/2026-10-04-parent-usability-audit/design/after-generate.md),
  [annotate-rating-upload-signin.md](../../ux/2026-10-04-parent-usability-audit/design/annotate-rating-upload-signin.md).
- Decision report with mockups (picks save there and Claude reads them back): https://claude.ai/artifact/Kt8eRfZB27Tj2DJGQ5zgn9

## Goal

A first-time soccer parent goes from upload to a finished highlight on any screen size without
having to guess a hidden gesture, a hidden rule, or a product word. Concretely:

1. Generate is never disabled without a visible control that unlocks it.
2. No editor page scrolls sideways at 320-428px wide, and the game name is always visible.
3. Every status label describes what actually happened to the clip.
4. Making a highlight does not depend on discovering an unexplained 5-star rule.
5. Upload, sign-in and cost facts say one thing at a time, in plain words.

## Epics (row order = recommended execution order)

| Epic | Folder | Why first / why here |
|------|--------|----------------------|
| A. Frame Highlight unlock | [frame-unlock/](frame-unlock/EPIC.md) | The only CRITICAL blocker on every screen size |
| B. Fits on phones and tablets | [mobile-fit/](mobile-fit/EPIC.md) | iPhone editor overflow hides the steps and the game name |
| C. Status you can trust after Generate | [status-truth/](status-truth/EPIC.md) | CRITICAL "In Spotlight" mislabel right after the parent's first spend |
| D. Make a highlight without guessing | [highlight-path/](highlight-path/EPIC.md) | 5-star gate and Annotate density; reverses recent rulings, so it needs decisions first |
| E. Upload and sign-in confidence | [upload-signin/](upload-signin/EPIC.md) | Commitment-point clarity (cost, progress, sign-in) |

T11900 (closing re-audit) runs last, after every epic.

**Parallel lanes.** The epics are mostly file-disjoint, so up to four can run at once. Shared files
force an order in these places:
- `config/displayNames.js` is touched by almost every task. Each task adds or edits its own keys,
  so conflicts are small text merges. Rebase before merging.
- `modes/FocusModeView.jsx`: T11700 -> T11710 -> T11720 (strict order, all in Epic A).
- `components/shared/UnifiedHeader.jsx` and `ModeSwitcher.jsx`: T11740 before T11830 and T11850.
- `modes/AnnotateModeView.jsx`: T11750 -> T11840 -> T11860.
- `components/ProjectManager.jsx`: T11760 -> T11790 -> T11820.
- `containers/AnnotateContainer.jsx`: T11800 before T11840.

## Standing rules for every task in this milestone

- **Copy accuracy (product-owner rule, 2026-09-15):** no string may claim that the app or AI
  frames, tracks, centers or follows the player. The parent places the box and picks the player;
  the app moves smoothly between the points the parent set, and sharpens (upscales) the video.
  The audit's own suggestions "We'll keep your child centered" and "Keep your child centered" are
  **rejected** for this reason.
- **No em dashes** in any shipped string. No "Saved" UI copy (persistence is silent).
- **Vocabulary:** the finished product is a **highlight** (one = highlight clip, a collection =
  highlight reel). Never call a single highlight a "reel". New strings say "your player".
- **All user-visible strings live in `src/frontend/src/config/displayNames.js`.** Move any inline
  string you touch there.
- **Do not rename internal ids** (routes `/annotate` `/focus` `/overlay`, `EDITOR_MODES`, store keys,
  `published_at`, analytics event names) to match new UI words.
- **Gesture-based persistence only.** No `useEffect` writes. View-only flags (coach marks, "just
  saved" markers, "More controls") are memory-only and never persisted.
- **Tests that pin old copy are updated, never deleted.** Branch CI does not run Playwright, so any
  e2e spec listed in a task must be updated and run locally.
- **Responsive proof:** every layout task checks `document.scrollingElement.scrollWidth <=
  window.innerWidth` at 320, 360, 375, 390 and 768 (helper: `e2e/helpers/qa.js`
  `assertNoHorizontalOverflow`), and gets one look in a real browser.

## Decision register

Each decision is in the decision report with mockups, pros and cons. Tasks are written for the
**recommended** option and say exactly what changes if a different option is picked. Update the
"User ruling" column (and the affected task files) when the user decides.

| ID | Decision | Recommended | Conflicts with | Tasks | User ruling |
|----|----------|-------------|----------------|-------|-------------|
| F1 | How a parent unlocks Generate | D: "Set focus point" button + coach chip, keep the T8510 gate | T8510 (2026-09-03) only if option C | T11700, T11710 | Recommended, 2026-10-04 |
| F2 | Locked Generate band on phones | Compact one-line row while locked | T9270 "CTA never resizes" (needs an exception) | T11720 | Recommended, 2026-10-04 |
| M1 | Mobile editor header | Two rows below `md`, one row at `md`+ | mobile-ux-spec 6.5; T11140 D kept | T11740 | Recommended, 2026-10-04 |
| M2 | Games grid on phone and tablet | 1 column on phone, pack small month groups at `sm`+, 2-line titles | T7330 "floored at 2" | T11760 | Recommended, 2026-10-04 |
| S1 | Status words for a framed clip | Ladder: "Draft, framed" etc. (no mode names in statuses) | T9860 (2026-09) chose "Draft, in Spotlight" | T11790 | Recommended, 2026-10-04 |
| S2 | The word "Publish" | Rename to "Finish", tab "Finished" | T8555, T9530 N12 (2026-09-10), T10180, T9860 D5 | T11810, T11820 | Recommended, 2026-10-04 |
| S3 | Where "Done for now" lands | Stay on Annotate, re-select the play, confirmation banner | none (keeps T8390) | T11800 | Recommended, 2026-10-04 |
| S4 | Ready-screen tile copy | Outcome labels in house vocabulary | T10670 copy (2026-09-19) | T11810 | Recommended, 2026-10-04 |
| S5 | The "Saved" chips | Remove them | T10670 (2026-09-19) | T11810, T11870 | Recommended, 2026-10-04 |
| H1 | The 5-star highlight gate | Hybrid: one labeled star row + "Make a highlight anyway" | Highlight-First H3 (2026-09-24) | T11840 | Recommended, 2026-10-04 |
| H2 | No visible exit from the rate modal on touch | Add an X close button | T11390 (2026-09-28), objection avoided | T11840 | Recommended, 2026-10-04 |
| H3 | Rename "Annotate" / "annotations" | Tab "Mark Plays", cards "N plays" | Round 2 ruling 6 (2026-09-24) | T11850 | Recommended, 2026-10-04 |
| H4 | Annotate first-run density | Hide advanced controls until the first play; phone zoom 100% until then | T10780 (2026-09-20), T10930 | T11860 | Recommended, 2026-10-04 |
| U1 | Upload modal intro copy | One honest sentence + stacked cost facts | none | T11880 | Recommended, 2026-10-04 |
| U2 | Sign-in when Google cannot open | (designer: email fallback + failure notice) | none | T11890 | **None of the options, 2026-10-04.** May be a staging/test-harness artifact; a generic "use email instead" path risks Google users creating a second, empty account. Handle failures only once the cause is diagnosed. T11890 is now an investigation. |

Recommendation-only items (no real alternative; proceed unless the user objects): one upload
progress number (T11870), shared cost row component (T11770), readable action row under Mark play
(T11750), loading placeholders and the preloader (T11830).

## Findings deliberately NOT turned into tasks

- **Tablet T-01, Google sign-in did nothing: no fallback UI (user ruling U2, 2026-10-04).** The
  tester was an AI agent in a non-Chrome in-app browser, so this may be a test artifact. A generic
  "sign in with email instead" path is rejected: Google and email-code sign-in both resolve the
  account **by email** (`backend/app/routers/auth.py` `_find_or_create_user`), so a Google user who
  types a different address silently gets a new, empty account and reports lost data. T11890 now
  investigates the cause; any handling must be specific to a diagnosed failure.
- **"Turn a game video into your child's highlight reel"** (tablet headline suggestion): breaks the
  "reel" vocabulary rule. Sign-in headline changes are out of scope after U2.
- **Audit D1/D6/iPhone #11 "We'll keep your child centered" copy:** overclaims automatic framing.
- **Sharing straight from the ready screen (after-generate D4):** deferred. It would make skipping
  the spotlight the shortest path to an audience, and the publish-from-working-video path is
  unverified.

## Completion criteria

- [ ] Every decision in the register has a user ruling, recorded here and in the affected tasks.
- [ ] All tasks merged and on staging.
- [ ] T11900: an agent re-runs the audit journey on staging at all three viewports and each
      CRITICAL and HIGH finding is shown fixed with a screenshot.
- [ ] Knowledge docs updated (`annotate.md`, `keyframes-framing.md`, `export-pipeline.md`),
      `docs/plans/mobile-ux-spec.md` 6.5 and `.claude/references/ui-style-guide.md` updated for
      the new header, locked-band, locked-secondary-action and packed-grid patterns.
