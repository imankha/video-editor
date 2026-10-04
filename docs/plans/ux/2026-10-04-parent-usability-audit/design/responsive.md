# Responsive layout decisions D-K to D-N (UX audit milestone)

Status: DRAFT, needs user approval. No repo files were edited.

## Evidence notes (checked against the images)
- iphone/07 (Annotate, 390): the header row reads `[<] [≡ 0] [Annotate] [lock Frame Highlight` and is clipped at the right edge. The title has collapsed to 0px. There is a page-level horizontal scrollbar. In the action row, "Review plays", "Share" and "Add footage" are all equally faint.
- iphone/08 (Focus, 390): the header reads `[<] [52] [crop badge] [Annotate] [Frame Hig...`, with no title and horizontal scroll. The ActionBand covers the bottom of the screen.
- tablet/03 is actually **Focus at 768** (it is not the home screen). The single-row header **fits at 768**: "Play 1", the credits chip, the badge and all three labeled tabs, with about 150px of spare room. The overflow is therefore a below-md problem. The 768 layout is the proof point for keeping one row at md+.
- tablet/02 is **home at 768**: each month group shows one tile at about 330px in the left half, and the right half is empty. Separate finding for the home owner: "Upload game" (about x 150-317) is not centered under the centered heading.
- iphone/02 (games, 390): one tile, about 175x95px, in the left half. "at Oceanside Breake..." is truncated. Title, date and stats already fill all 95px of the thumbnail.

---

## D-K. Mobile editor header (UnifiedHeader mobile branch + ModeSwitcher inline)

Today the row needs about 550px at 390 (Back 40, chip 50, three labeled tabs about 400, gaps). The title has `flex-1 min-w-0`, so it is the only thing that can shrink, and it shrinks to zero.

### Option A: two rows below md, one row at md+ (RECOMMENDED)
```
390px Annotate                          390px Focus
+--------------------------------------+ +--------------------------------------+
|[<] at Oceanside Breakers      [≡ 6]  | |[<] Play 1               [52] [crop]  |
|    Aug 30                            | |    at Oceanside Breakers Aug 30      |
+------------+------------+------------+ +------------+------------+------------+
|  scissors  |    crop    |    lock    | |  scissors  |    crop    |    lock    |
|  Annotate  |  Frame     | Add        | |  Annotate  |  Frame     | Add        |
| (green)    |  Highlight | Spotlight  | |            | Highlight  | Spotlight  |
+------------+------------+------------+ +------------+-(gold)-----+------------+
768px (md+): unchanged single row, as in tablet/03
|[<] Play 1 / game   [52][crop]  [Annotate][Frame Highlight][lock Add Spotlight]|
```
- Wrapper: `flex flex-col gap-1 mb-2 md:flex-row md:items-center md:gap-2`
- Row 1: `flex items-start gap-2 min-h-11 md:flex-1 md:min-w-0`
  - Back: `w-11 h-11 flex-shrink-0` (today it is 40px; raise it to 44)
  - Title block `flex-1 min-w-0 py-1`:
    - Primary: `text-white font-medium text-sm leading-tight line-clamp-2 break-words`
    - Focus/Spotlight only, second line from the existing `breadcrumbGameName` prop: `text-xs text-gray-400 truncate`. This meets "game name always visible" in every mode.
  - Chips: `flex items-center gap-2 flex-shrink-0 self-center`. Any chip you can tap gets an `h-11` hit area, even if the visual is smaller.
- Row 2 (ModeSwitcher `inline` container, owned by UnifiedHeader): `grid grid-cols-3 gap-1 bg-white/5 rounded-lg p-1 md:flex md:bg-transparent md:p-0` plus `role="group" aria-label="Editor steps"`
  - Below md, each tab: `flex flex-col items-center justify-center gap-0.5 h-12 px-1 min-w-0 rounded-md`. Icon 16 stacked over a label `text-[11px] font-medium leading-tight text-center`.
  - md+: today's classes (`flex-row h-11 px-4 gap-2 text-sm whitespace-nowrap`)
  - Active, locked, gold hairline, `aria-disabled` plus the T8480 toast, and `data-testid` stay exactly as they are. Only the layout classes change.
- Fit check: at 320 the content is about 296px, so each segment is about 96px. "Frame Highlight" at 11px is about 85px. It fits, but must be verified at 320.

Pros: the full game name is visible on 2 lines. All three steps stay labeled, so T11140 D holds. Every target is at least 44px. There is no horizontal scroll at 320-428. The fix is CSS only, plus one title line. 768 keeps the layout already proven in tablet/03.
Cons: the header grows from about 40px to about 100px on phones (row 1: 44, row 2: 56 with padding). This works against mobile-ux-spec "reclaim 20px". It hurts most on Focus, where the ActionBand already takes 130-160px. That Focus space problem belongs to the Focus-unlock designer; it should be accounted for in their ActionBand height budget.
Conflicts: mobile-ux-spec §6.5 (`[<] Title ... [mode indicator]`), which this supersedes and should be updated. The responsiveness skill rule "Don't add new wrapper divs" (one container is added) and the "ModeSwitcher icon-only on mobile" row in its pattern table (already stale since T11140; update it). T11140 is respected.
Effort: S-M. About 40 LOC across UnifiedHeader and ModeSwitcher, update ModeSwitcher/UnifiedHeader unit tests, plus an overflow check (`scrollWidth === clientWidth`) at 320/360/375/390/768 in an e2e spec.

### Option B: active tab labeled, the others icon-only (one row)
```
390 Annotate: [<] at Ocea..  [≡ 6] [scissors Annotate] [crop] [lock]
390 Focus:    [<] Pl..  [52] [crop] [scissors] [crop Frame Highlight] [lock]
```
- Inactive tabs: `w-11 h-11 px-0 justify-center`. Label `sr-only` unless active.
- Width check at 390, Focus: 44+52+36+44+150+44 plus gaps is about 400px, so it **still overflows**. Annotate leaves the title about 40px.

Pros: one 44px row, so the smallest height cost. Matches mobile-ux-spec §6.5 intent.
Cons: fails "game name always visible" in both modes and still overflows on Focus at 320-390. Unlabeled locked tabs bring back the icon-guessing that T11140 D fixed. The gold "newly unlocked" hairline on a bare icon is a weak cue.
Conflicts: reverses part of T11140 decision D (labels inside every mobile tab).
Effort: S. Not recommended.

### Option C: compact step indicator with a dropdown
```
390: [<] at Oceanside Breakers Aug 30          [≡ 6]
         [Step 1 of 3: Annotate  v]   <- h-11 pill, opens a bottom sheet
Sheet: 1 Annotate (current) / 2 Frame Highlight (lock: "Rate a play Highlight, then choose Make Highlight Now.") / 3 Add Spotlight (lock: ...)
```
- Pill: `inline-flex items-center gap-1.5 h-11 px-3 rounded-full bg-white/10 text-sm text-white`, with ChevronDown 14. Show a gold dot when a step has just unlocked.

Pros: the most compact two-line header. The sheet can show the lock reasons as static text, which is clearer than a toast.
Cons: moving forward to the next step becomes a hidden two-tap action. That is the exact discoverability T11140 optimized for. "Step 3 of 3" implies Spotlight is required, but "Done for now" skips it, and Annotate is per game while Frame/Spotlight are per play, so the numbering is not truthful. It adds a new sheet component. Every e2e spec that clicks `mode-framing` needs an extra open step.
Conflicts: T11140 D ("NO static text under the tabs", tabs visible). T8480 toast pattern. It overlaps the content designer's numbered-flow proposal (audit #8), so decide the copy there first.
Effort: M-L. Not recommended now. Reconsider only if the content pass adopts a strict numbered flow.

### Recommendation: Option A
It is the only option that meets all four constraints: no scroll at 320, name visible, 44px targets, labels kept. It follows the skill's own rule: "Two readable lines are always better than one unreadable line." Use `md:` rather than `useIsMobile` for the row split, because useIsMobile sends 768-1023 tablets to the mobile branch and they fit one row.

### Loading state (applies to every option)
- While `/load` is in flight, the plays chip shows `<span className="inline-block w-5 h-3 rounded bg-white/15 animate-pulse" aria-label="Loading plays" />` instead of "0".
- Locked tabs show `Loader2` instead of `Lock`, with `aria-busy`. The toast copy is "Loading your plays...". The locked look only appears once load resolves.
- Preloader: show the spinner and "Loading" until the overlay is gone. "Ready" never appears while the overlay still covers the page.

---

## D-L. Games grid on phone and tablet

Today: `gamesGridColumns` is floored at 2, so a 1-game month leaves half a row empty at both 390 and 768. Tiles are about 95px tall at 390, and the overlay text already fills them.

### Option A: 1-column floor with capped width
- Columns = `clamp(biggest, 1, 4)`. Phone: `grid-cols-1` (tile about 358x200 at 16:9). Tablet with biggest=1: one column, `max-w-md` (448px), left-aligned under the month label.
- Pros: the phone tile has room for a 2-line title, the date and stats over a readable thumbnail. Simple.
- Cons: at 768 the right side is still empty (it just looks deliberate). A long library on phone means about 210px of scroll per game.

### Option B: group side rail at md
- Extend the lg label rail to md: `md:grid md:grid-cols-[96px_1fr]`.
- Pros: reuses existing lg code.
- Cons: does not fix a 1-game month. It still shows one tile and empty space, now in a narrower area. Not recommended.

### Option C: pack small month groups side by side
```
768: OCTOBER 2026 (1)          AUGUST 2026 (1)
     [tile Game uploaded Oct 4] [tile at Oceanside Breakers Aug 30]
     SEPTEMBER 2026 (3) ................................ (full row)
     [tile] [tile] [tile]
```
- Outer: `sm:grid sm:gap-x-3 sm:gap-y-6` plus an explicit `GRID_COLS[N]` class map (greppable, no computed class names).
- Each group: `sm:col-span-{min(k,N)}`, from an explicit `COL_SPAN` map, with an inner `grid grid-cols-{min(k,N)}`.
- Chronological order is kept (no `grid-flow-dense`).
- Pros: fills tablet rows without touching tile size. Pure CSS. The skeleton uses the same map.
- Cons: two month headers on one row is a new pattern. It scans fine left to right, but needs approval.

### 2-line title (all options)
- GameTile.jsx:309: `truncate` becomes `line-clamp-2 break-words leading-tight`. Meta row stays one line, `truncate`.
- At 2-up on phone this does not fit (a 95px tile with 4 text lines covers the image). This is why the phone half of the decision matters.

### Recommendation: A on phone, C at sm+, plus 2-line titles
- Phone `grid-cols-1`: identifying the game is the main job here (audit #4). Typical accounts have 1-2 games per month (ProjectManager.jsx:385-390), so scroll cost is low.
- sm+ packs groups at N = `clamp(biggest, 2, 4)`.
- lg keeps its rail, with packing inside it.
- Change `gamesGridColumns` and the skeleton together (T6310).
- Conflicts: the "floored at 2 to match mobile" rationale in the gamesGridColumns doc comment and its unit tests. The responsiveness pattern table.
- Effort: M (about 60 LOC, ProjectManager plus skeleton plus GameTile plus tests).

---

## D-M. Action row under "Mark play" (zero-plays state, AnnotateModeView.jsx:1470-1499)

Problem: enabled Share and Add footage use `text-gray-400`, 12px icons and no hit area. Locked Review plays uses `text-gray-600`, about 1.6:1. All three read as disabled, and none is 44px tall.

### Option 1: legible secondary buttons, with a locked state that explains itself (RECOMMENDED)
```
[ + Mark play                              ]   (unchanged hero)
  Captures 6 seconds before and 2 after.
[lock Review plays] [share Share] [file Add footage]
```
- Container: `flex flex-wrap items-center justify-center gap-2`
- Enabled: `min-h-11 px-3 rounded-lg text-sm text-gray-100 ring-1 ring-inset ring-white/20 hover:bg-white/10 hover:text-white flex items-center gap-1.5`, icon 16
- Locked: `min-h-11 px-3 rounded-lg text-sm text-gray-400 flex items-center gap-1.5`, Lock icon 16 replacing ListVideo, no ring, `aria-disabled="true"` (not `disabled`). On tap: `toast.info('Mark your first play to review it.', { dedupKey: 'review-locked' })`.
- The difference between locked and enabled comes from three cues together: no outline, a lock icon, and dimmer text. Locked text-gray-400 stays readable (style guide: 4.5:1). The style guide's `text-gray-500` disabled token is about 2.8:1 on this purple, too faint for a control that explains itself.
- Pros: matches the ModeSwitcher locked-tab pattern (lock icon, aria-disabled, toast, T8480) and the "ring = available" cue from T11140. Still clearly below the green hero.
- Cons: the row gets taller (44px). AnnotateModeView.cta.test.jsx:125-132 pins `text-xs` and `disabled === true`. Rewrite it to assert: no `py-3`, `aria-disabled`, toast on click.

### Option 2: hide Review plays until a play exists
- Show only Share and Add footage (Option 1 enabled styling). Add one line to the hint: "Captures 6 seconds before and 2 after. Your plays will appear here to review."
- Pros: nothing locked to explain, and less clutter.
- Cons: removes the preview of what comes next. Breaks the same test differently.

### Option 3: full-size row like the with-plays state (T10393)
- Pros: consistent with the with-plays state.
- Cons: three big buttons compete with "Mark play" in the empty state. That undoes the deliberate demotion. Not recommended.

Recommendation: Option 1. Copy: "Review plays" (locked), "Share", "Add footage". Toast: "Mark your first play to review it." Effort: S (about 25 LOC, plus the AddFootageButton `link` variant class and a test update).

---

## D-N. Cost row stacking (recommendation only)

Extract a shared `CreditCostRow` component and use it in GameDetailsModal, AttachVideoModal, AddFootageButton and StorageExtensionModal. These are four copies, so the third-duplication rule is met.
```
Cost: 2 credits                 Balance: 54 credits
Your game video is kept for 30 days.
```
- `<div className="flex flex-col gap-0.5 text-sm">`
  - `<div className="flex flex-wrap justify-between gap-x-3">`, with two spans each `whitespace-nowrap`. The two facts can wrap as whole units but never interleave.
  - Retention note: `<p className="text-xs text-gray-400">`
- Props: `cost`, `balance`, `note` (a caller-supplied string, because StorageExtensionModal's wording differs).
- When balance < cost: balance in `text-red-400`, and the caller renders its buy-credits action.
- Lay it out the same way at every width, not only on mobile, so the copy reads the same everywhere.
- Effort: S-M (about 50 LOC plus one component test at 320px width).

---

## Cross-cutting
- Update mobile-ux-spec §6.5 and the responsiveness skill pattern table when D-K and D-L are approved.
- Add the new header, packed grid and locked secondary action patterns to ui-style-guide.md after approval.
- Verification for every decision: `scrollWidth === clientWidth` at 320/360/375/390/768, and the user reviews it in a headed browser (responsiveness skill, Phase 2).
