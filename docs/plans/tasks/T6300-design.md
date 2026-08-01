# T6300 — Design Treatment: ReelTile persistent actions + capability fix

**Status:** Design gate (awaiting user approval — do NOT implement yet)
**Author:** UI Designer agent
**Companion task:** [T6300-reel-tile-hidden-actions.md](./T6300-reel-tile-hidden-actions.md)
**Aligns to:** `DraftTile.jsx` (the authoritative sibling — T5910 capability fix + T6180 kebab pattern already shipped there), and T6180's user brief: *"Ready is a status → badge. Main button = Play, rest in a kebab once ready."*

---

## 1. Current state

`ReelTile.jsx` — the published-reel poster tile in the My Reels drawer.

### The two bugs

**Bug A — everything hides behind hover (discoverability).**
The whole actions cluster (`ReelTile.jsx:215-354`) sits in one absolutely-positioned wrapper at `top-1.5 left-1.5`, gated by `actionsVisibility` (`:137-139`):

```js
const actionsVisibility = isMobile
  ? (actionsRevealed ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none')
  : 'opacity-0 pointer-events-none group-hover/tile:opacity-100 group-hover/tile:pointer-events-auto';
```

At rest on a fine pointer: `opacity-0 pointer-events-none`. Play, Copy/Share, AND the kebab are ALL invisible until the tile is hovered. Nothing hints the tile has actions. This is the user's report: *"the UI is gone."*

**Bug B — touch-Windows is a functional dead end (capability).**
`isMobile` is the prop passed from `DownloadsPanel.jsx:395`, sourced from `useWebShare().isMobile` (`useWebShare.js:55`), which is a **UA sniff** (`isMobileDevice()`, `:11-13`) — matches only Android / iPhone / iPad / iPod / touch-Mac. A touchscreen **Windows** device gets `isMobile === false` → takes the `group-hover` branch → but a touch device has no hover, and the long-press handlers are only wired when `isMobile` is true (`:146-148`). Those users cannot reach Play, Copy link, or the kebab **at all**.

### What is on the tile today (corners are contested)

| Element | Position | Lines | z-index |
|---------|----------|-------|---------|
| Poster / skeleton / branded fallback | `inset-0` | `:154-173` | base |
| Unwatched **NEW** dot | `top-1.5 **right**-1.5` | `:175-178` | `z-20` |
| **#rank** badge (`#N`, ≤20) | `top-1.5 **left**-1.5` | `:179-189` | `z-20` |
| Bottom scrim (name / rename input / meta) | `inset-x-0 bottom-0` | `:191-213` | `z-10` |
| Actions cluster (Play + Copy/Share + kebab) | `top-1.5 **left**-1.5` | `:215-354` | `z-30` |
| Kebab bottom-sheet (coarse) / portaled popover (fine) | fixed | `:239-353` | `z-50` |

So the actions cluster currently **overlaps the #rank badge** in the top-left (badge is `z-20`, actions `z-30` — the actions sit on top and hide the badge on hover). The NEW dot is alone in the top-right.

### Verified facts (do not re-litigate)

- **Delete is NOT a two-click in-menu confirm here.** ReelTile's Delete (`:287`, `:346`) calls `onDelete(e, download)` then `setMenuOpen(false)`; `onDelete` is `DownloadsPanel.handleDelete` (`:225-233`) which uses a native `window.confirm`. So closing the menu on click is SAFE for ReelTile — there is no in-menu confirm state to swallow. (This differs from DraftTile, whose in-menu two-click delete must keep the menu open. ReelTile does not have that trap. **Spec: keep Delete closing the menu; do not port DraftTile's two-click.**)
- **Kebab portal + flip logic** (`:76-112`, `:294-353`) anchors off `kebabBtnRef.current.getBoundingClientRect()`. It is agnostic to where the button sits — moving the button's corner does not touch the portal math, provided `kebabBtnRef` still points at the rendered trigger.
- The `actionBtnClass` chip token (`:140`) already carries the ≥44px coarse floor.

---

## 2. Target state

**Principle (from T6180 brief + DraftTile precedent):** the primary action is *always visible*, never hover-gated; the kebab (overflow) is *always reachable* — persistently visible on coarse pointers, hover/focus-revealed on fine pointers but sitting in a fixed corner so its presence is discoverable. For a published reel the natural persistent primary is **Play** (there is no publish CTA — the reel is already published).

### 2.1 Structure change: split the one cluster into two persistent chips

Replace the single hover-gated `top-1.5 left-1.5` cluster with **two independently-placed, always-mounted chips**, mirroring DraftTile's split of "persistent primary" vs "corner kebab":

1. **Play chip** — persistent primary. Bottom-left of the poster, above the scrim.
2. **Kebab chip** — overflow. Top-right corner (the conventional kebab home, matching DraftTile `:566-583` and GameTile).

The direct **Copy link / Share** chip that used to sit inline (`:220-228`) **moves into the kebab** (Copy Link / Share already exist there — `:253-256`, `:310-317`). This is the T6180 house rule: *"main button = Play, the rest in a kebab."* Keeping a third always-visible chip on a 150px-wide tile would crowd it; the reel's share actions live one tap away in the kebab, exactly as Download/Rename/etc already do. **Net: one always-visible primary (Play) + one always-reachable kebab.**

### 2.2 Placement (resolves the contested corners)

| Corner | Occupant | Rationale |
|--------|----------|-----------|
| top-**left** | **#rank badge** (unchanged) | Freed — the actions cluster leaves this corner. Badge is now unobstructed. |
| top-**right** | **kebab chip** — but the **NEW dot** also lives here | Kebab is the conventional top-right home (DraftTile/GameTile). Coexistence handled below. |
| bottom-**left** | **Play chip** (new persistent position) | Sits over the scrim (which already darkens the base), clear of the name text which is bottom-aligned and left-padded; Play is the highest-value tap and belongs on the poster body, not crammed in a corner. |

**NEW dot ↔ kebab coexistence (top-right).** The kebab is 32px (fine) / 44px (coarse). The NEW dot is a 12px pip at `top-1.5 right-1.5 z-20`. Two options — **recommend Option A**:

- **Option A (recommended): stack them.** Kebab at `top-1.5 right-1.5`; when `isUnwatched`, shift the NEW dot to sit just left of the kebab at `top-2.5 right-11` (44px kebab + gap) so both are visible and neither overlaps. This mirrors DraftTile, which stacks its top-right "in My Reels" marker BELOW the status chip at `top-9 right-1.5` (`:480-484`) — a proven vertical/horizontal offset pattern. Precise: `isUnwatched ? 'right-11' : 'right-1.5'` on the dot (11 × 4px = 44px clears the coarse kebab; on fine pointers the 32px kebab leaves extra gap, which is fine).
- **Option B: move the NEW dot to top-left, riding the #rank badge.** More corner contention (rank badge is already there). Rejected — top-left would then hold two elements while we just cleared it.

The kebab is `z-40` (above the NEW dot's `z-20` and the actions' old `z-30`), matching DraftTile's kebab `z-40` (`:575`). The Play chip is `z-30`.

### 2.3 Exact treatment — Play chip (persistent primary)

Always mounted, always visible (no opacity gate). Sits bottom-left, lifted clear of the name via the existing scrim.

```jsx
{/* Persistent primary — Play. Always visible; never hover-gated (T6300). */}
<button
  type="button"
  onClick={(e) => onPlay(e, download)}
  title="Play video"
  aria-label="Play video"
  className={`absolute bottom-1.5 left-1.5 z-30 ${actionBtnClass}`}
>
  <Play size={16} className={REEL.accent} />
</button>
```

- Reuses the existing `actionBtnClass` token verbatim (`rounded-full bg-black/60 backdrop-blur-sm text-white hover:bg-black/80 ... coarse-pointer:min-h-[44px] coarse-pointer:min-w-[44px] min-h-[32px] min-w-[32px]`) — no new visual language. The `bg-black/60 backdrop-blur-sm` IS the required backdrop for a control over video.
- `REEL.accent` on the Play glyph — unchanged from today (`:218`).
- Bottom-left, not bottom-right: the name/meta text is left-aligned and the scrim already covers the base; a bottom-left 32/44px chip overlaps only the scrim's dark corner, not the readable text (name is `line-clamp-2`, starts at the left edge but the chip's 44px is small against a 150–260px width; if crowding is observed in review, the name block can gain `pl-9` left padding — noted as a fallback, not a default).

### 2.4 Exact treatment — kebab chip (persistent overflow)

Corner-anchored, always mounted. **Copy the DraftTile kebab visibility formula exactly** (`:566-583`) so the two tiles share one convention:

```jsx
{/* Overflow kebab — corner-anchored. Persistent on coarse pointers; hover/focus-
    revealed on fine pointers, but always in a fixed discoverable corner (T6300). */}
<button
  ref={kebabBtnRef}
  type="button"
  onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
  title="More actions"
  aria-label="More actions"
  aria-haspopup="menu"
  aria-expanded={menuOpen}
  className={`absolute top-1.5 right-1.5 z-40 ${actionBtnClass} transition-opacity ${
    isCoarsePointer
      ? 'opacity-100'
      : 'opacity-0 group-hover/tile:opacity-100 focus:opacity-100'
  } ${menuOpen ? 'opacity-100' : ''}`}
>
  <MoreVertical size={16} />
</button>
```

- `isCoarsePointer` comes from `useIsCoarsePointer()` (`hooks/useIsMobile.js:32`) — a **live `(pointer: coarse)` matchMedia**, NOT the UA sniff. This is the T5910 fix, already the pattern in DraftTile (`:65`, `:576`).
- On a **fine pointer** the kebab is hover/focus-revealed (keeps the tile clean at rest, matches DraftTile). Discoverability of the *primary* is satisfied by the always-visible Play chip; the kebab following DraftTile's hover-reveal keeps the two tiles identical and keeps the corner uncluttered.
- On a **coarse pointer** (incl. touch-Windows, now correctly detected) the kebab is `opacity-100` — always tappable, no long-press, no dead end.
- `aria-haspopup`/`aria-expanded` added to match DraftTile (`:573-574`); ReelTile currently lacks them.

### 2.5 What gets DELETED from the current code

- The `actionsVisibility` string (`:137-139`) — gone; each chip now owns its own visibility.
- The `actionsRevealed` state (`:61`), `handleTouchStart`/`clearLongPress` (`:126-136`), `longPressTimer`/`longPressFired` refs (`:67-68`), and the `onTouchStart/Move/End` wiring (`:146-148`) — gone. Long-press is replaced by an always-visible kebab (no long-press = no dead end). This matches DraftTile's ready-state kebab, which has no long-press either.
- The inline Copy/Share chip (`:220-228`) — removed from the poster surface; the actions remain in the kebab.
- The single wrapping `<div className="... top-1.5 left-1.5 z-30 flex ... ${actionsVisibility}">` (`:216`) — dissolved into the two standalone chips + the (unchanged) menu render.

### 2.6 Capability signals after the change (two separate concerns)

| Concern | Signal | Where |
|---------|--------|-------|
| Reveal/interaction gate (kebab visibility, sheet-vs-popover) | `useIsCoarsePointer()` — live `matchMedia` | **new**, internal to ReelTile |
| Share-vs-Copy-link method choice | `useWebShare().isMobile` (UA sniff) — KEPT, it's a genuine platform question | `isMobile` prop from `DownloadsPanel:395` |

The `isMobile` prop stays wired (DownloadsPanel `:221`/`:395` unchanged). Its ONLY remaining use inside ReelTile is: (a) choosing the bottom-**sheet vs popover** menu shell — **change this to `isCoarsePointer`** so touch-Windows gets the sheet; (b) the Web-Share-vs-Copy method — **keep `isMobile`** here (Web Share availability). Since the inline Copy/Share chip is removed, the only remaining `isMobile` decision is inside the menu (the menu shows both "Share" and "Copy Link" items already — `:310-317` — so no per-item gating is even needed; both stay listed).

**Result:** the menu shell selector at `:239` / `:294` changes from `menuOpen && isMobile` / `menuOpen && menuPos` to `menuOpen && isCoarsePointer` / `menuOpen && menuPos`. Everything else in the menu render is byte-identical.

---

## 3. States table

Play chip is always `opacity-100 pointer-events-auto` in every column. The table below is for the **kebab** (the only element with pointer-dependent visibility):

| State | Kebab opacity | Kebab pointer-events | What's visible at rest | How to reach overflow |
|-------|---------------|----------------------|------------------------|------------------------|
| **At rest, fine pointer** (mouse, any width) | `0` | inherits (button, but invisible) | Play chip + #rank + NEW dot | Hover the tile → kebab fades in (`group-hover/tile:opacity-100`); or Tab to it (`focus:opacity-100`) |
| **Hover, fine pointer** | `100` | auto | Play + kebab + #rank + NEW dot | Click kebab → portaled popover (flips near viewport bottom) |
| **Coarse pointer** (touch phone/tablet **AND touch-Windows**) | `100` | auto | Play + kebab + #rank + NEW dot — ALL persistent | Tap kebab → bottom sheet. No hover, no long-press, no dead end. |
| **Menu open** (any pointer) | `100` | auto | kebab stays lit while its menu is open | — |

Contrast to today: today's at-rest fine-pointer row shows NOTHING; today's touch-Windows row is unreachable. Both are fixed.

---

## 4. Landscape vs portrait

`sizeClass` (`:70-74`) is unchanged: portrait `w-[42vw] max-w-[168px] sm:w-[150px] aspect-[9/16]`; landscape `w-[72vw] max-w-[300px] sm:w-[260px] aspect-video` (260×146 at sm).

The two-chip layout works in both because the chips are corner/edge-anchored, not flowed:

- **Portrait (150×267):** ample vertical room. Play bottom-left over scrim, kebab top-right, NEW dot shifted left of kebab, #rank top-left. No collisions.
- **Landscape (260×146):** shorter (146px tall). The Play chip (bottom-left, 32/44px) and the kebab (top-right) are on opposite corners — the 146px height comfortably separates a top-right 44px chip from a bottom-left 44px chip (44 + 44 = 88 < 146). The scrim still covers the base. No special-casing needed; both aspects use the identical chip placement classes.

No `isLandscape` branch is required for the actions (it remains only for `sizeClass`).

---

## 5. Edge cases

| Case | Handling |
|------|----------|
| **NEW dot + kebab both top-right** | Dot shifts to `right-11` (clears the 44px coarse kebab) when `isUnwatched`, else `right-1.5`. Kebab `z-40` > dot `z-20`; if they ever visually touch, the kebab wins the tap (it's on top and larger). See §2.2 Option A. |
| **#rank badge (top-left)** | No longer overlapped — the actions cluster left the top-left corner. Badge renders unobstructed at `top-1.5 left-1.5 z-20`. |
| **Rename inline input** | Unchanged (`:193-206`). It lives in the bottom scrim. The Play chip is also bottom-left — while renaming, the input spans the scrim width; the Play chip sits on top of the input's left edge (`z-30` > scrim `z-10`). **Spec: hide the Play chip while `isRenaming`** (`{!isRenaming && <Play chip/>}`), mirroring DraftTile which hides its action bar while renaming (`:566`, `:590` guard on `!isRenaming`). The kebab (top-right) does not overlap the input and may stay. |
| **Delete-confirm-in-menu** | ReelTile's Delete uses native `window.confirm` in DownloadsPanel — closing the menu on click is safe. **Keep the current behavior** (menu closes, then `window.confirm` fires). Do NOT port DraftTile's in-menu two-click. Verified in §1. |
| **Portal flip** | Untouched. `kebabBtnRef` still points at the (now top-right) trigger; `useEffect` (`:76-112`) reads its rect and flips upward near the viewport bottom exactly as before. Moving the trigger from top-left to top-right only changes the anchor rect the existing math already consumes. `left: rect.right - 192` still right-aligns the w-48 popover under the button. |
| **Menu shell selector** | `isMobile` → `isCoarsePointer` for the sheet-vs-popover choice (§2.6), so touch-Windows gets the mobile bottom sheet, not a mispositioned desktop popover. |
| **`onWebShare` / `onCopyLink` still both wired** | Both handlers stay passed from DownloadsPanel and both items stay in the menu (`Share` + `Copy Link`). No handler is dropped; only the inline poster chip is removed. |

---

## 6. Risks / do NOT touch

- **Portal positioning + flip (`:76-112`, `:294-353`).** Do not change the `getBoundingClientRect` anchor logic or the `menuHeight`/flip heuristic. Only the button's screen corner moves; the ref and math are preserved. Regression here re-introduces the clipping bug the portal was added to fix.
- **≥44px coarse targets.** The `actionBtnClass` token (`:140`) carries `coarse-pointer:min-h-[44px] min-w-[44px]`. Reuse it verbatim for both chips — do not hand-roll smaller chips.
- **`DownloadsPanel` prop wiring (`:221`, `:395`).** Keep passing `isMobile` (it's still needed for the Web-Share method choice and can remain the sheet selector's fallback if desired, though `isCoarsePointer` is the correct signal). Do not remove the prop; `useWebShare().isMobile` is correct for Share-vs-Copy.
- **Do not port DraftTile's two-click in-menu delete** — ReelTile's delete is a native confirm; adding in-menu confirm state here would be a behavior change with no cause.
- **Menu item set is frozen.** Download, Copy Link, Share, Rename, Before/After (dev), Open as Draft, Move to profile…, Delete — every item stays, same handlers, same conditions (`showBeforeAfter`, `canOpenSource`, `canMoveProfiles`). This task moves affordances; it does not add/remove capabilities.
- **`useWebShare().isMobile` UA sniff stays** — it is the right tool for "can this platform Web Share." Only the *reveal gate* migrates to `useIsCoarsePointer()`.

---

## 7. Summary of the proposed treatment

1. **Split the one hover-gated action cluster into two persistent pieces:** an always-visible **Play** chip (bottom-left, over the scrim) and a corner **kebab** (top-right).
2. **Play is never hidden** — the reel's primary action is always discoverable. The direct Copy/Share chip is absorbed into the kebab (both Share and Copy Link already live there), per T6180's "main button = Play, rest in a kebab."
3. **Kebab visibility copies DraftTile exactly:** `opacity-100` on coarse pointers (always tappable, incl. touch-Windows), hover/focus-revealed on fine pointers, in a fixed discoverable corner.
4. **Capability fix:** the reveal gate + sheet-vs-popover selector move to `useIsCoarsePointer()` (live `matchMedia`); the UA-sniff `useWebShare().isMobile` is KEPT only for the Web-Share-vs-Copy method choice. Long-press (and its dead end) is deleted — an always-visible kebab replaces it.
5. **Corners de-conflicted:** actions vacate top-left so the **#rank** badge is unobstructed; the **NEW** dot shifts left of the kebab in the top-right when present. Play chip hidden while renaming.
6. **No new visual language** — reuses `actionBtnClass`, `REEL.accent`, the scrim, and DraftTile's proven kebab formula. Portal/flip logic, ≥44px targets, and the frozen menu item set are untouched. ReelTile's Delete stays a native `window.confirm` (no in-menu two-click trap here).
