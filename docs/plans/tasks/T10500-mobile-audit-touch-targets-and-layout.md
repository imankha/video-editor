# T10500: Mobile UI audit fixes — touch targets, tooltip overlap, chip wrap, title truncation

**Status:** STAGING
**Impact:** 4
**Complexity:** 3
**Created:** 2026-09-18
**Updated:** 2026-09-18

## Problem

A dispatched UI-audit agent swept Home/Admin/Annotate at 375/390/430px viewports looking for
the T10420 (wrong-anchor sheet) and T10380 (row-wrap-pushes-content) defect classes plus any
other iOS HIG/layout defect. It surfaced 9 findings. The user asked to fix everything except
Admin (F5 — desktop-only surface, out of scope by request).

**Important correction discovered during triage:** most of the reported "touch target too
small" findings were **false positives** caused by the audit's own methodology — it resized a
real-mouse-controlled Chromium viewport without emulating an actual touch device. This
codebase already has a mature, tested `coarse-pointer` Tailwind variant
(`@media (hover: none) and (pointer: coarse)`, `tailwind.config.js:17`) that floors touch
targets at 44px on real touch input only, used extensively (`shared/Button.jsx`,
`e2e/helpers/usabilityAudit.js`'s Invariant #4, `ClipScrubRegion`'s T7350 floor). Every control
already gated by that variant (Phase/Aspect filter chips, playback transport buttons, the
carousel's own scroll chevrons which only render for `isFinePointer` — i.e. never on a real
phone) tested "broken" purely because the audit browser reported `pointer: fine`. Confirmed
false positives: F4 (carousel arrow — only ever shown to mouse users), F6's playback transport
(already floored via `Button.jsx`), F7 (Share Plays — intentionally hidden while a play is
selected, per T10310), F8 (Upload modal Game Type field — the modal's scroll body / pinned
footer split is deliberate, T8790, and already guarantees reachability).

Genuine gaps fixed: CreditBalance credit badge, ProfileSportButton, ProfileDropdown avatar +
guest Sign-In button, App.jsx footer legal links, StarRating (shared + the ClipDetailsEditor
sidebar's own local copy), TagSelector tag chips — none of these had the `coarse-pointer` floor
at all.

Other genuine layout bugs fixed:
- F9: the "You start with N free credits" first-run tooltip overlapped the centered wordmark on
  narrow viewports.
- F3: the Clips-tab Phase filter chip row used `flex-wrap`, so a lone chip ("Draft (4)") wrapped
  to its own second row and pushed the list down — the actual T10380 defect class.
- F2 (partial): the "Continue Where You Left Off" card's recent-game title truncated with an
  ellipsis, sometimes eating the trailing date (e.g. "Vs legends Sep 5" → "Vs legend…").
- F4 (residual, non-false-positive part): the desktop-only scroll-chevron's `-left-4`/`-right-4`
  half-out inset could graze a card's leading text on an unusually narrow mouse window.

## Solution

Applied the codebase's own established fix patterns rather than inventing new ones:
- `coarse-pointer:min-h-[44px] coarse-pointer:min-w-[44px]` (+ centering utilities where the
  element isn't already a flex/inline-flex box) on every genuinely-undersized control — pointer-
  gated, so mouse/desktop is untouched at any viewport width.
- `sm:` breakpoint reversion (this codebase's existing mobile/desktop split, `tailwind.config.js`
  comment: "don't change the `sm` breakpoint") for the two changes that aren't touch-specific:
  the tooltip's position/width and the carousel arrow's inset.
- `flex-nowrap overflow-x-auto scrollbar-hide` (matching the pattern already used by
  `CardCarousel.jsx` and elsewhere in this same file) instead of `flex-wrap` for the Phase chip
  row — desktop already fits on one line, so this is a no-op there.
- Removed `truncate`, added `break-words sm:truncate` (wraps below `sm`, keeps the original
  ellipsis behavior at `sm:` and up — byte-identical desktop).

Explicitly out of scope, left as follow-ups rather than guessed at blind:
- F1's Admin dashboard tables (excluded per user request — desktop-only surface).
- The `landscape-inline` Annotate layout (~844×390) is the one place the StarRating + TagSelector
  floor edits land on an already cramped row and could squeeze the tag lane — flagged by the
  fresh Reviewer as needing a live 844×390 check before being called fully verified, not
  reworked blind.
- `CreditBalance.jsx`'s tooltip vertical offset (`mt-[100px]`) and `ProjectManager.jsx`'s header
  clearance (`coarse-pointer:pt-12`) are both derived from static markup measurements, not a
  live browser — flagged for the same live-check pass.
- Focus/Overlay/Gallery/share/intro-card screens were never reachable during the audit (the dev
  account was accidentally emptied mid-session by a known R2-sync landmine) — F6's "likely
  systemic to Focus/Overlay too" claim about touch targets is unconfirmed there.

## Context

### Relevant Files
- `src/frontend/src/components/CreditBalance.jsx` — credit badge floor + first-run tooltip reposition
- `src/frontend/src/components/ProfileSportButton.jsx` — sport switcher floor
- `src/frontend/src/components/ProfileDropdown.jsx` — avatar + guest Sign-In floor
- `src/frontend/src/App.jsx` — footer Privacy/Terms link floor
- `src/frontend/src/components/shared/StarRating.jsx` — shared star button floor
- `src/frontend/src/modes/annotate/components/ClipDetailsEditor.jsx` — its own local StarRating copy, same floor
- `src/frontend/src/components/shared/TagSelector.jsx` — tag chip floor
- `src/frontend/src/components/ProjectManager.jsx` — Phase filter chip nowrap/scroll, Continue-card title wrap, header touch clearance
- `src/frontend/src/components/shared/CardCarousel.jsx` (+ `.test.jsx`) — scroll-arrow inset, tightened regression assertion

### Related Tasks
- Follows up on T10420/T10380 (named defect classes this audit re-checked).

## Implementation

### Steps
1. [x] Dispatch UI-audit agent across 375/390/430px, all reachable screens (Focus/Overlay/Gallery
   blocked mid-session by an R2-sync data-loss incident — documented in the audit's own artifact).
2. [x] Triage every finding against the actual code before touching anything — this surfaced the
   `coarse-pointer` false-positive pattern.
3. [x] Implement genuine fixes (round 1), lint clean, 71 targeted tests green.
4. [x] Fresh-context Reviewer pass on the diff: 0 BLOCKING, 4 MAJOR, 8 MINOR.
5. [x] Fixed all 4 MAJOR + the actionable MINOR findings (round 2): chip shrink-0/nowrap, header
   coarse-pointer clearance, truncate→break-words+sm:truncate, tooltip justify-center + recomputed
   offset, ClipDetailsEditor's local StarRating, ProfileDropdown guest Sign-In floor, tightened
   the CardCarousel regression test. Re-linted (0 errors) and re-ran the full 118-test curated set
   (12 files) green.
6. [ ] Live visual confirmation at 375×812 (touch-emulated) and 844×390 (landscape) — mandatory
   per the `responsiveness` skill's Phase 2 before this can be called fully tested.

### Progress Log

**2026-09-18**: Implemented, reviewed, fixed all MAJOR findings, tests + lint green. Pushed for
the user's live-browser review (this project's own responsiveness-skill policy requires a headed
visual pass before a mobile CSS change is considered verified — jsdom/lint can't see real layout).

**2026-09-18**: User asked to merge directly (skipping the live-browser pass) after CI review.
Branch CI verified green (`frontend` pass, `backend` correctly skipped — no backend files
changed, `changes` pass) via `gh pr checks`. PR #468 merged to master (merge commit `a48594e9`).
The live 375×812 touch-emulated + 844×390 landscape check flagged above was NOT done — reopen
this task if the tooltip offset, header clearance, or the landscape-inline tag lane look wrong
on staging.

## Acceptance Criteria

- [x] Lint clean on every touched file
- [x] Targeted regression suite green (118 tests, 12 files)
- [x] Fresh Reviewer pass with all MAJOR findings resolved
- [ ] User confirms the fixes look right live at 375/390/430px (and 844×390 landscape for the
      StarRating/TagSelector floor) before merge
