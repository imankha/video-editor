# Post-export completion screen: UX/UI pass (proposal)

**Scope:** Focus completion (`FocusPublishActionBar` inside `CollectionPlayer`) and its Overlay twin (`OverlayPublishActionBar`). Design only; no code changed.
**Owner request (2026-09-19):** visible play/pause + fullscreen; kill the redundant "saved / only you can see it" + "Save draft" trio; make the three real choices feel like a celebration with more pop.

## What the code actually does today (facts the proposal depends on)

| Fact | Where |
|---|---|
| `useStoryPlayback` already returns `isPlaying` (from `play`/`pause` element events); `CollectionPlayer` never destructures it, so the UI has no paused/playing signal at all. | `components/collections/useStoryPlayback.js:25,84-85,121`; `CollectionPlayer.jsx:153-165` |
| `<video autoPlay playsInline>` with no `controls`. If the browser blocks unmuted autoplay, the user sees a frozen first frame and nothing tells them to tap. Center-third tap toggles play; left/right thirds are prev/next (no-ops for this one-reel caller). | `CollectionPlayer.jsx:288-294,497-508` |
| There is NO `requestFullscreen` / `webkitEnterFullscreen` anywhere under `src/`. Every "fullscreen" in the app (`isFullscreen` in Focus/Annotate/Overlay) is CSS state that swaps the layout; `useFullscreenWorthwhile` measures against `.video-container`. | grep; `hooks/useFullscreenWorthwhile.js:27` |
| The player panel is already `fixed inset-0` on mobile and `md:inset-12` on desktop. On a phone the footer (green line + 3 stacked cards + link + captions) is ~520px tall, so the 9:16 video gets whatever is left. | `CollectionPlayer.jsx:331`; `FocusPublishActionBar.jsx:98-175` |
| Header toolbar for this caller renders only the Close X (no Publish/Share/Download props are passed). `onClose` = `handleRefocus`, i.e. the X and Escape are a hidden duplicate of the "Edit framing" card. | `FocusScreen.jsx:1477`; `CollectionPlayer.jsx:186-195,469` |
| `data-tutorial-target="focus-publish"` is on the INNER pill button, not the card; the unit test and e2e assert exactly one match. Nothing else in `src/` consumes it; guided rule 30 (T7620 design, row 30) is the only reader. | `FocusPublishActionBar.jsx:144`; `FocusPublishActionBar.test.jsx:53`; `e2e/T8520-T8530-overlay-choice-and-publish.spec.js:87` |
| Unit tests pin: three `[class*="rounded-xl"]` cards, primary first + `cyan` in class, `<button>` roles named by `FOCUS_PUBLISH.*_LABEL`, `button.disabled` on loading, `span.whitespace-nowrap` inside every button, the exact grid string, no `overflow-x-auto`, `focus-save-draft` has `bg-transparent`, `focus-retention-note` renders/omits. | `FocusPublishActionBar.test.jsx`; `OverlayPublishActionBar.test.jsx` |
| Existing play/pause + fullscreen control idiom: `Button variant="success" size="sm" icon={isPlaying ? Pause : Play} iconOnly className="rounded-full"` and `ghost` `Maximize`/`Minimize` iconOnly. | `modes/annotate/components/PlaybackControls.jsx:230-238,285-294` |
| Existing "one-shot attention" idiom: `ring-2 ring-cyan-400/70 animate-pulse` cleared on a 1.5s timer. | `CollectionPlayer.jsx:416`; `DraftReelPreview.jsx:112-115` |

---

## A. Video controls

### Options compared

| | (1) Native `controls` for this caller | (2) Custom strip under the video | (3) Center glyph overlay + header transport |
|---|---|---|---|
| Play/pause visible | Yes (browser UI) | Yes | Yes: glyph at rest while paused, header icon always |
| Fullscreen | Yes, but browser-owned | Yes | Yes |
| Tap zones | Conflict: the native control bar (bottom ~40-60px) eats pointer-up, so center-tap toggles AND the native bar toggles; on iOS the native bar also shows its own scrubber, duplicating `CompositeScrubber` | Coexists (strip is outside the tap layer) | Coexists (glyph is `pointer-events-none`; the toggle still comes from the tap zone) |
| Vertical cost on 9:16 | 0 (overlaid) but covers the bottom of the clip, where the reel name pill already sits | ~44px stolen from a portrait video that is already height-starved | 0 |
| Visual consistency | Chrome/Safari/Firefox all differ; none look like the app | Matches `PlaybackControls` | Matches YouTube/TikTok idiom every parent knows; matches `PlaybackControls` icons |
| Other callers | Would need a prop; fine | Would need a prop | Would need a prop |

### Recommendation: (3), as an opt-in `transport` prop on `CollectionPlayer`

1. **Center glyph** (`data-testid="collection-player-play-glyph"`), rendered inside the tap/swipe container so it never intercepts the tap:
   ```
   absolute inset-0 flex items-center justify-center pointer-events-none
     > div: flex h-16 w-16 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm ring-1 ring-white/20
       > <Play size={32} className="ml-1" /> while paused, <Pause size={32} /> flashed on play
   ```
   - Paused: glyph is persistent at full opacity (style guide rule: a control the user must find is rendered at rest). This also fixes today's blocked-autoplay dead end.
   - Playing: glyph shows for one beat then fades (`transition-opacity duration-500`, opacity 0 after 600ms via a `useState` + `setTimeout` on the `isPlaying` edge, cleared on unmount). No rAF, no new loop.
   - `aria-hidden`; the accessible control is the header button below.
2. **Header transport**, appended to the existing toolbar cluster BEFORE Close, only when `transport` is set:
   ```
   <Button variant="ghost" size="sm" iconOnly icon={isPlaying ? Pause : Play}  onClick={togglePlay}  aria-label={isPlaying ? 'Pause' : 'Play'} title=... className="coarse-pointer:min-h-11" />
   <Button variant="ghost" size="sm" iconOnly icon={expanded ? Minimize : Maximize} onClick={toggleExpanded} aria-label={expanded ? 'Exit fullscreen' : 'Fullscreen'} title=... className="coarse-pointer:min-h-11" />
   ```
   Same `ghost sm iconOnly` shape as Re-edit/Re-rank/Close in that cluster; `Play`/`Pause`/`Maximize`/`Minimize` are the icons `PlaybackControls.jsx` already uses.
3. **Time**: not added. The white `CompositeScrubber` already carries progress, and mm:ss adds chrome the user did not ask for. (If wanted later: `text-xs font-mono text-gray-300` next to the title, from `videoRef.current.currentTime`, on the existing rAF tick via `onProgress`.)

### Fullscreen mechanics (this is the part with real tradeoffs)

The user's "fullscreen" need on this screen is "let me see the clip big, without the footer". So the primary mechanism is **our CSS expand**, with native fullscreen layered on where it exists:

| Layer | Behaviour |
|---|---|
| CSS expand (always works) | `expanded` local state in `CollectionPlayer`. Panel class `md:inset-12 md:rounded-xl` becomes `inset-0 rounded-none`; the `actionBar` slot is NOT rendered while expanded (`{expanded ? null : actionBar}`); header stays (it holds Minimize + Close). The scrubber stays. This alone gives the portrait video the full viewport height on both desktop and mobile. |
| Native fullscreen (desktop Chrome/Firefox/Safari, Android Chrome) | On enter: `panelRef.current.requestFullscreen?.()` after setting `expanded`. On the panel, NOT the video element, so our scrubber/header/glyph stay visible in fullscreen. Listen to `document` `fullscreenchange`: if `document.fullscreenElement` becomes null (user pressed Esc, browser exit), set `expanded=false`. |
| iOS Safari (iPhone) | `document.fullscreenEnabled` is false and `requestFullscreen` is undefined on iPhone; the only fullscreen is `videoRef.current.webkitEnterFullscreen()` on the VIDEO element, which opens Apple's native player (native controls, native scrubber) and returns on dismiss (`webkitendfullscreen` event on the video). Do that when `typeof video.webkitEnterFullscreen === 'function' && !document.fullscreenEnabled`. Do NOT also set `expanded` on iOS (the native player covers everything; on return the layout should be untouched). `playsInline` stays so non-fullscreen playback remains inline. |
| Escape | Landmine: `CollectionPlayer`'s keydown handler maps Escape to `onClose()` (`:191`). With native fullscreen active the browser consumes the first Esc to exit fullscreen but we ALSO receive keydown in some browsers. Guard: `if (e.key === 'Escape') { if (expanded) { setExpanded(false); exit native; return; } onClose(); }`. |
| Coarse pointer | The two header icons already get `coarse-pointer:min-h-11` floors via `Button`. Tap-to-toggle in the video keeps working; in expanded mode on mobile the footer is gone so the video is roughly 2x taller. |

Nothing here changes any other `CollectionPlayer` caller: `transport` defaults to false, and the Escape guard is a no-op when `expanded` is false.

---

## B. Copy and hierarchy simplification

### What goes, what stays

| Element today | Verdict | Why |
|---|---|---|
| Green line "Saved to your drafts. Only you can see it." (`retentionNote`) | **Remove as a sentence; becomes a one-word chip** next to the headline | T9870's job (user must not believe unsaved work is at risk) is done by a `Check` chip reading "Saved" plus the absence of any "Save" verb on the screen. The audience fact ("nobody else sees it until you share") already lives in the Publish caption, which is where T9590 wants it (before the tap). |
| "Save draft" ghost link + caption "It is already saved to your drafts. Pick it up whenever you want." | **Rename to "Done for now", no caption** | The word "Save" is the whole source of the false model T9870 found. Handler is unchanged (navigation-only `handleAddSpotlightLater` / `handlePublishLater`); the landing toast ("Saved to Clips" / "Saved to Reels") still names the destination. |
| Three captions, italic, two sentences | **Keep three captions, non-italic, one idea each, max ~60 chars** | Italic gray on gray reads as fine print; short roman `text-xs text-gray-400` reads as a label. |
| "Play 1" title top-left | Keep; it is the reel name and other callers use that slot | |
| Close X = Edit framing | Keep behaviour, but flag: X/Escape silently do what the tertiary card does. Not changing in this pass. | |

### Final copy, ready to paste into `displayNames.js`

Keys are ADDED or REVALUED; no key is renamed or removed except `SAVE_DRAFT_CAPTION` (only readers: the two bars and their tests, verified by grep). No em dashes.

```js
export const FOCUS_PUBLISH = {
  HEADLINE: 'Your clip is ready',
  ADD_SPOTLIGHT_LABEL: 'Add spotlight',
  SPOTLIGHT_CAPTION: 'Point out your athlete to everyone watching.',
  PUBLISH_LABEL: 'Publish without spotlight',
  PUBLISH_CAPTION: `Goes to Published. ${STAGE_REASONS.PUBLISH}`,
  EDIT_FRAMING_LABEL: 'Edit framing',
  EDIT_FRAMING_CAPTION: 'Reframe and export again. Uses credits.',
  SAVE_DRAFT_LABEL: 'Done for now',
};

export const OVERLAY_PUBLISH = {
  HEADLINE: 'Your clip is ready',
  PUBLISH_LABEL: 'Publish',
  PUBLISH_CAPTION: `Goes to Published. ${STAGE_REASONS.PUBLISH}`,
  REAPPLY_OVERLAY_LABEL: 'Reapply spotlight',
  REAPPLY_OVERLAY_CAPTION: 'Go back and redo the spotlight.',
  REAPPLY_FOCUS_LABEL: `Reapply ${MODE_NAMES.FRAMING}`,
  REAPPLY_FOCUS_CAPTION: 'Reframe and export again. Uses credits.',
  SAVE_DRAFT_LABEL: 'Done for now',
};

// Chip text next to the headline (was a full sentence above the grid).
export const RESULT_RETENTION = {
  PRIVATE_READY: 'Saved',
  PRIVATE_DRAFT: 'Saved',
  PUBLISHED: 'Saved. Link unchanged',
};
```

Notes on the strings:
- `STAGE_REASONS.PUBLISH` ("Nobody else can see this until you share a link.") is reused verbatim so T9860 D5 wording and the existing regex tests hold.
- `SPOTLIGHT_CAPTION` no longer aliases `STAGE_REASONS.SPOTLIGHT` (the 22-kids sentence stays for the Spotlight mode reason line; it is 90 chars, three lines in a 243px card). "athlete" is singular possessive per T9860 vocabulary.
- `HEADLINE` is a new key; `EXPORT_JOBS.framing.completed` ("Framing ready") stays as the toast/job-row string (T9540 N21). Both stages say "clip" because a single play is a clip, never a reel.
- Optional, not recommended in this pass: shorten `PUBLISH_LABEL` to "Publish as is" (e2e spec `:137` uses the exact current name).

---

## C. Making the three choices feel like a moment

### Footer structure (Focus shown; Overlay identical with its own primary)

```
<div data-testid="focus-publish-action-bar" className="border-t border-gray-800 bg-gray-900 px-4 py-4 sm:px-6 sm:py-6">
  {/* headline row */}
  <div className="mx-auto mb-4 flex max-w-md items-center justify-center gap-3 lg:max-w-4xl">
    <h2 className="text-lg font-semibold text-white sm:text-xl motion-safe:animate-[readyIn_320ms_ease-out_both]">{HEADLINE}</h2>
    {retentionNote && (
      <span data-testid="focus-retention-note"
            className="inline-flex items-center gap-1 rounded-full border border-green-500/40 bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-300 motion-safe:animate-[chipIn_240ms_ease-out_120ms_both]">
        <Check size={12} aria-hidden="true" />{retentionNote}
      </span>
    )}
  </div>
  {/* grid: class string byte-identical to today (T8390 landmine) */}
  <div className="mx-auto grid w-full max-w-md grid-cols-1 gap-3 lg:max-w-4xl lg:grid-cols-[repeat(3,minmax(min-content,1fr))]">
    <Tile .../> <Tile .../> <Tile .../>
  </div>
  <div className="mx-auto mt-4 flex max-w-md justify-center">
    <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={onSaveDraft} data-testid="focus-save-draft">
      <span className="whitespace-nowrap">{SAVE_DRAFT_LABEL}</span>
    </Button>
  </div>
</div>
```

Keyframes (one `<style>` block in the bar, same pattern as `collectionPlayerTitleFade`):
`readyIn` 0% opacity 0 translateY(6px) -> 100% opacity 1 translateY(0); `chipIn` 0% opacity 0 scale(.7) -> 100% opacity 1 scale(1); `tileIn` 0% opacity 0 translateY(8px) -> 100% opacity 1 translateY(0); `primaryPulse` 0%/100% box-shadow 0 0 0 0 rgba(34,211,238,0) -> 50% 0 0 0 6px rgba(34,211,238,.35). All gated by `motion-safe:`; nothing loops. No confetti, no library.

### Tile anatomy (one DOM element is the whole control)

The inner pill `<Button>` goes away. The card itself is the button, so there is exactly one tab stop and one accessible name, and the "button inside a button" that made the cards look like forms is gone.

```
<div role="button" tabIndex={0} aria-labelledby={titleId} aria-describedby={captionId}
     onClick={handler} onKeyDown={handleCardKeyDown(handler)}
     data-testid="focus-choice-primary"            // primary only
     data-tutorial-target="focus-publish"           // Publish tile only (moves from the pill to the card)
     className={TILE.primary}>
  <span className={DISC.primary}><Sparkles size={28} aria-hidden="true" /></span>
  <span id={titleId} className="whitespace-nowrap text-base font-semibold text-white">{LABEL}</span>
  <span id={captionId} className="text-xs leading-snug text-gray-400">{CAPTION}</span>
</div>
```

Layout classes shared by all tiles: mobile is a horizontal row (icon left, text right) so three stacked tiles cost ~3 x 76px instead of ~3 x 130px; at `lg:` they become centered columns.
```
TILE.base   = "group flex h-full flex-row items-center gap-4 rounded-xl p-4 text-left cursor-pointer select-none
               transition-[transform,box-shadow,border-color,background-color] duration-150 ease-out
               lg:flex-col lg:items-center lg:gap-3 lg:p-5 lg:text-center
               focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900
               motion-safe:animate-[tileIn_320ms_ease-out_both] motion-reduce:transform-none"
```
(`rounded-xl` is kept on purpose: the tests count cards with `[class*="rounded-xl"]`.) Stagger: inline `style={{ animationDelay: '60ms' | '120ms' | '180ms' }}`.

| Tile | Default (appended to base) | Hover | Focus-visible | Pressed | Loading / disabled |
|---|---|---|---|---|---|
| **Primary** (Focus: Add spotlight, Overlay: Publish) | `border border-cyan-400/50 bg-gradient-to-b from-cyan-500/20 to-cyan-500/5 shadow-[0_12px_40px_-14px_rgba(34,211,238,0.45)] motion-safe:animate-[tileIn_320ms_ease-out_both,primaryPulse_1.2s_ease-out_400ms_1]` | `hover:-translate-y-0.5 hover:border-cyan-300/80 hover:from-cyan-500/30 hover:shadow-[0_16px_48px_-14px_rgba(34,211,238,0.6)]` | `focus-visible:ring-cyan-300` | `active:translate-y-0 active:scale-[0.98]` | `aria-disabled="true" opacity-60 cursor-not-allowed hover:translate-y-0 hover:shadow-none`; disc icon swaps to `<Loader size={28} className="animate-spin" />` |
| **Secondary** | `border border-gray-700 bg-gray-800/60` | `hover:-translate-y-0.5 hover:border-gray-500 hover:bg-gray-800 hover:shadow-[0_12px_32px_-14px_rgba(0,0,0,0.7)]` | `focus-visible:ring-gray-300` | same | same, without the cyan bits |
| **Tertiary** | `border border-gray-800 bg-transparent` | `hover:border-gray-600 hover:bg-gray-800/40` (no lift: it should feel quieter) | `focus-visible:ring-gray-400` | `active:scale-[0.98]` | n/a |

Icon discs (the thing that gives the row "pop" at a glance):
```
DISC.base      = "flex shrink-0 items-center justify-center rounded-full ring-1 transition-colors duration-150 h-12 w-12 lg:h-14 lg:w-14"
DISC.primary   = base + " bg-cyan-500/20 text-cyan-300 ring-cyan-400/40 group-hover:bg-cyan-500/30 group-hover:text-cyan-200"   icon 28px
DISC.secondary = base + " bg-gray-700/70 text-gray-100 ring-gray-600 group-hover:bg-gray-700"                                    icon 26px
DISC.tertiary  = base + " bg-gray-800 text-gray-300 ring-gray-700 group-hover:text-white"  and h-11 w-11 lg:h-12 lg:w-12          icon 22px
```
Icons unchanged from today's conventions: `Sparkles` spotlight, `FolderInput` publish, `Pencil` edit framing (Focus) / `Crop` reapply framing (Overlay). Exit link icon becomes `ArrowLeft` ("back to my clips" gesture) instead of `Clock` (`Clock` says "later", which is the vocabulary we are retiring).

Text column: `flex min-w-0 flex-col gap-0.5 lg:items-center`. Title `text-base font-semibold text-white` (primary: `text-cyan-50`), caption `text-xs leading-snug text-gray-400` (primary: `text-cyan-100/80`). Caption width at lg is ~243px, so anything over ~36 chars wraps to two lines; the strings in B are 40-66 chars, i.e. two lines max, never three. `whitespace-nowrap` on the title keeps the min-content column floor equal to the title width (T8390 rule); the 56px disc adds a fixed, non-wrapping min-content of its own, well under the ~590px total budget.

Keyboard: one tab stop per tile (card `tabIndex=0`, no inner focusable), Enter/Space via the existing `handleCardKeyDown`; DOM order primary -> secondary -> tertiary -> exit link, so T9590's tab-order acceptance still falls out of source order.

Vertical budget on a 390x844 phone: header 40 + headline 36 + 3 rows (76 x 3 + 2 gaps) 252 + exit 44 + padding 32 = ~404px footer, versus ~520px today; the video gains roughly 115px, and the Fullscreen button (A) removes the footer entirely when the parent wants to watch.

---

## D. Mirror for `OverlayPublishActionBar`

Same component shape, so a reviewer diffs them side by side (still two call sites, so no shared abstraction yet, per the rule of three):

| Slot | Focus | Overlay |
|---|---|---|
| Headline + chip | `FOCUS_PUBLISH.HEADLINE`, chip from `resultRetentionNote(project)` (`PRIVATE_DRAFT` -> "Saved") | `OVERLAY_PUBLISH.HEADLINE`, chip `PRIVATE_READY` -> "Saved" |
| Primary tile | Add spotlight, `Sparkles`, `data-testid="focus-choice-primary"` | Publish, `FolderInput`, `data-testid="overlay-choice-primary"`, `data-testid="overlay-publish-now"` moves from the pill to the tile, carries `publishLoading` |
| Secondary | Publish without spotlight, `FolderInput`, `data-tutorial-target="focus-publish"`, `publishLoading` | Reapply spotlight, `Sparkles` |
| Tertiary | Edit framing, `Pencil` | Reapply Framing, `Crop` |
| Exit link | "Done for now", `ArrowLeft`, `data-testid="focus-save-draft"` | "Done for now", `ArrowLeft`, `data-testid="overlay-save-draft"` |
| Player | `transport` prop on the Focus `CollectionPlayer` mount (`FocusScreen.jsx:1468`) | same prop on the Overlay mount (`OverlayScreen.jsx:1815`) |

Overlay's primary is Publish, so the pulse and cyan glow land on Publish there; the hierarchy still tracks pipeline position exactly as T9590 specified.

---

## E. Variants for the product owner to pick from

### V1. Restrained refresh
Keep today's three card shells (`rounded-xl`, `p-5`, cyan tint on primary) and the inner pill buttons. Changes: delete the green line and the Save-draft caption; add the headline row with the "Saved" chip; captions become roman `text-xs`; add the icon disc above each pill (icon 24px, disc h-12); hover lift on primary/secondary only; exit link renamed "Done for now". No new animation beyond hover.
Mockup: footer = [headline centered] / [3 equal cards: disc, pill button, caption] / [ghost link]. Mobile: cards stacked full-width, centered content.
Rationale: smallest test churn (no role/anchor moves), still fixes all three complaints. Risk: the pill-inside-card still reads like a form, and the "pop" is mostly the disc.

### V2. Celebration tiles (recommended)
Everything in section C: headline with one-shot rise-in + "Saved" chip pop; three icon-forward tiles where the tile IS the button; primary gets gradient, glow, and a single 1.2s ring pulse 400ms after mount; tiles stagger in 60ms apart; hover lift/glow; mobile tiles are horizontal rows; exit link "Done for now"; header transport + fullscreen from A.
Mockup: desktop footer height ~230px: [ "Your clip is ready"  (Saved) ] / [ tile: cyan disc Sparkles / "Add spotlight" / caption | gray disc FolderInput / "Publish without spotlight" / caption | ghost disc Pencil / "Edit framing" / caption ] / [ <- Done for now ]. Mobile: three 76px rows (disc left, title + caption right), exit link below.
Rationale: reads as a reward screen, the primary is unmistakable, and the height saved on mobile is what makes "watch it big" possible without a fullscreen tap.

### V3. Action-sheet rows
V2's mobile row layout at EVERY width, left-aligned, `max-w-md`, with a `ChevronRight` at the end of each row; no 3-across grid on desktop. Headline above, chip inline, exit link below.
Mockup: a 448px-wide list under the video: [Your clip is ready (Saved)] / [cyan row] / [gray row] / [ghost row] / [Done for now].
Rationale: shortest footer on desktop too (~250px) and the strongest top-to-bottom hierarchy. Downsides: on a 1500px desktop the list looks narrow under a 9:16 video and it drops the `lg:grid-cols-[repeat(3,...)]` string that two tests and the T8390 rationale pin, so it is the largest departure from what shipped in T9590.

**Pick:** V2. It uses V3's rows where they matter (phones) and keeps the T9590/T8390 desktop grid verbatim.

---

## F. Risks and conflicts (named, with the fix)

| Decision / landmine | Conflict introduced by this proposal | Resolution |
|---|---|---|
| **T9590** "Save draft stays available but quiet" and "every alternative states its destination" | "Done for now" is quiet but does NOT name a destination. | Either accept (the landing toast names Clips/Reels), or pass an `exitLabel` from the screen computed from `project.is_auto_created` (the same predicate the toast uses at `FocusScreen.jsx:1159`) yielding "Back to Clips" / "Back to Reels". Recommend "Done for now" and record the exception in T9590's file. |
| **T9590** primary = filled cyan `lg` button in a tinted card | Pill buttons are removed; the tile itself is the control. | Hierarchy is preserved (cyan gradient + glow + pulse only on primary); T9590's acceptance criteria are about dominance and order, not the pill. Update the T9590 file with a pointer. |
| **T9870** retention line + Save-draft caption | Sentence becomes a one-word chip; caption deleted. | AC1 intent holds: the screen contains no "Save" verb and shows "Saved". AC4 guard holds: `resultRetentionNote` still routes PUBLISHED to "Saved. Link unchanged" and never says "only you can see it". Note the pre-existing gap: on an already-published re-export the Publish tile caption still says "Nobody else can see this until you share a link"; out of scope here, log as follow-up. |
| **T9860 / T9540 vocabulary** | `SPOTLIGHT_CAPTION` stops aliasing `STAGE_REASONS.SPOTLIGHT`; new `HEADLINE` sits beside `EXPORT_JOBS.framing.completed` ("Framing ready"). | Both are additions, not renames; "Framing ready" remains the toast. Record in the displayNames comment block. |
| **T8390 grid landmines** | Icon disc adds fixed min-content; rows on mobile change flex direction. | Grid string `lg:grid-cols-[repeat(3,minmax(min-content,1fr))]` and `grid-cols-1`/`max-w-md`/`lg:max-w-4xl` stay byte-identical; titles stay in `whitespace-nowrap`; no `overflow-x-auto`. Verify in a real browser at 1024-1100px (jsdom cannot). |
| **Guided tutorial anchor** (`focus-publish`, rule 30) | Anchor moves from the pill to the Publish tile. | Still exactly one element, still the Publish gesture. Rule 30 copy ("put it in Highlight Reels") is already stale versus the Published tab; pre-existing, note for T7630. |
| **T7630 reads `displayNames.js`** | Values change; one key (`SAVE_DRAFT_CAPTION`) is removed. | Grep shows no reader outside the two bars and their tests. Keep all other keys. |
| **`CollectionPlayer` shared by 6+ callers** (DraftReelPreview, DownloadsPanel, public share viewer, RankingGame, IntroStoryPlayer, diag harnesses) | Glyph, transport buttons, expand, Escape guard. | All behind `transport` (default false); Escape guard is a no-op unless `expanded`. Follow-up: turning `transport` on for the public share viewer is probably the single highest-value reuse of this work. |
| **Native fullscreen + Escape** | Existing Escape -> `onClose` would close the player when the user only meant to leave fullscreen. | Guard described in A. |
| **iOS** | No panel fullscreen; native video fullscreen shows Apple's controls. | Use `webkitEnterFullscreen` on the video; do not toggle `expanded`. Accept native UI there. |
| **Unit tests that must change** | `FocusPublishActionBar.test.jsx` / `OverlayPublishActionBar.test.jsx`: `getByRole('button', {name})` now resolves the tile (works because of `aria-labelledby`); `button.disabled` assertions become `aria-disabled`; the "span.whitespace-nowrap inside every button" test must query tiles + the exit link; the 4-button DOM-order test becomes a 4-`[role=button]` order test; retention-note test asserts the chip text; caption assertions use the new strings. e2e `T8520-T8530...spec.js:137,148` use `getByRole('button', {name, exact:true})`, which still resolves the tile. `focusPublishExit.test.jsx` / `overlayPublishExit.test.jsx` use `SAVE_DRAFT_LABEL` via the constant, so they follow the rename. | Listed so the implementor curates the relevant set up front. |
| **Motion** | New one-shot animations. | All `motion-safe:`; none loop; total added motion < 1.5s after mount. Matches the "animation is core product value" direction without a dependency. |
