# T5360: Framing controls have sub-standard touch targets on tablet (26px)

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-07-17
**Updated:** 2026-07-17

## Problem

User report 2026-07-17 (imankh, tablet): while framing a clip, the control buttons
(play/pause, step, restart, fullscreen, zoom, keyframe delete) are too small to reliably
tap.

Root cause traced end-to-end (code read). The shared `Button` primitive defines its
`sm` icon-only size as:

```
// src/frontend/src/components/shared/Button.jsx:112
sm: iconOnly ? 'p-1.5 min-w-11 min-h-11 sm:min-w-0 sm:min-h-0' : 'px-3 py-1.5 text-sm',
```

The intent was "give phones a 44px minimum, drop it on desktop where there's a mouse."
But the toggle keys off **viewport width** (Tailwind `sm:` = ≥640px), not **input type**.
A tablet is ≥640px wide *and* touch-only, so it lands in the "desktop" bucket and **loses
the 44px floor**, collapsing to just `p-1.5` (6px) around a 14px icon:

**14px icon + 6px×2 padding = ~26×26px actual touch target on tablet.**

Compounding it: `useIsMobile()` (`(max-width: 1023px), (hover: none) and (pointer:
coarse)`) classifies the tablet as mobile and serves the mobile Framing layout — but the
buttons *inside* that layout get desktop-sized hit areas. The layout says "touch," the
buttons say "mouse."

### Measured touch targets in Framing (on tablet, ≥640px, touch)

| Control | File | Size class | Actual | Verdict |
|---|---|---|---|---|
| Play/Pause, Step ±, Restart, Fullscreen | `Controls.jsx` (all `size="sm" iconOnly`) | `p-1.5` + 14px | **~26px** | ❌ |
| Zoom in / out / reset | `ZoomControls.jsx` | `p-1.5` + 14px | **~26px** | ❌ |
| Mobile-fullscreen Crop toggle & exit | `FramingModeView.jsx:586-610` | `p-1.5` + 14px | **~26px** | ❌ |
| Keyframe delete / copy (timeline) | `KeyframeMarker.jsx:100,73` (hand-rolled, not shared Button) | `p-1.5` + 13px | **~25px** | ❌ |
| Keyframe diamond (select/drag) | `KeyframeMarker.jsx:88-95` | 12px + `-inset-3` hit pad | **~36px** | ⚠️ |
| Mobile "Expand video" | `FramingModeView.jsx:434` (`min-h-11 min-w-11`) | 44px | **✅** |

The last row is evidence of intent: a previous author hardcoded `min-h-11 min-w-11` on the
one button they hit this on, while the shared primitive silently under-sizes every other.

### Standards

| Standard | Minimum | 26px | 44px |
|---|---|---|---|
| Apple HIG | 44×44pt | ❌ | ✅ |
| Material Design 3 | 48×48dp | ❌ | ⚠️ (44, close) |
| WCAG 2.5.5 (AAA) | 44×44px | ❌ | ✅ |
| WCAG 2.5.8 (AA, 2.2) | 24×24px | ⚠️ barely | ✅ |

26px clears only the weakest bar, and the playback buttons sit `gap-1` (4px) apart —
misses and mis-taps are expected. Target: **44×44px** on touch pointers (Apple HIG /
WCAG AAA), desktop mouse **unchanged**.

## Solution

Gate the touch-target minimum on **pointer capability**, not viewport width. Fix it once in
the shared `Button` primitive so every `iconOnly` button across all three editor modes
(Framing, Overlay, Annotate) becomes tappable on touch devices, then bump the two
hand-rolled keyframe-timeline buttons that don't use the shared primitive.

**Key guarantee: desktop is byte-identical.** The change only *adds* a floor on coarse
(touch) pointers; fine (mouse) pointers keep exactly today's sizing.

### Mechanism: named pointer-capability Tailwind variants

Tailwind config is currently bare (`plugins: []`). Add two named variants via `addVariant`
so the intent is greppable and reusable (used in 3+ places → abstraction is warranted per
the refactoring rules), not an inline arbitrary-media string repeated everywhere:

```js
// src/frontend/tailwind.config.js
import plugin from 'tailwindcss/plugin';

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: { extend: {} },
  plugins: [
    plugin(({ addVariant }) => {
      // Primary pointer is a mouse/trackpad (desktop). Relax touch minimums here.
      addVariant('fine-pointer', '@media (hover: hover) and (pointer: fine)');
      // Primary pointer is a finger (phone + tablet). Enforce 44px touch targets.
      addVariant('coarse-pointer', '@media (hover: none) and (pointer: coarse)');
    }),
  ],
};
```

`tailwindcss/plugin` is available in the installed Tailwind `^3.4.0`.

### Button.jsx — unified iconOnly floor on coarse pointers

Replace the width-keyed sizeStyles with pointer-keyed ones. Give **all three** iconOnly
sizes the 44px floor on coarse pointers (today only `sm` had any floor, and only on
phones — `md`/`lg` had none at all):

```js
// src/frontend/src/components/shared/Button.jsx  (sizeStyles)
const sizeStyles = {
  sm: iconOnly ? 'p-1.5 coarse-pointer:min-w-11 coarse-pointer:min-h-11' : 'px-3 py-1.5 text-sm',
  md: iconOnly ? 'p-2 coarse-pointer:min-w-11 coarse-pointer:min-h-11'   : 'px-4 py-2 text-sm',
  lg: iconOnly ? 'p-3 coarse-pointer:min-w-11 coarse-pointer:min-h-11'   : 'px-6 py-3 text-base',
};
```

Behavior per size (icon centered by the existing `inline-flex items-center justify-center`):

| Size | Fine pointer (mouse) | Coarse pointer (touch) | Change vs today |
|---|---|---|---|
| `sm` iconOnly | 26px (`p-1.5`+14) | **44px** | phone unchanged (was 44 via base min); **tablet 26→44**; desktop unchanged (was 26) |
| `md` iconOnly | 32px (`p-2`+16) | **44px** | desktop unchanged; touch 32→44 |
| `lg` iconOnly | 42px (`p-3`+18) | **44px** | desktop unchanged; touch 42→44 |

Why this is desktop-safe: the OLD `sm` rule gave desktop `min-w-0` (→26px). The NEW rule
gives fine pointers no min at all (→ same 26px from `p-1.5`). Phones were `hover:none +
pointer:coarse` → previously matched the base `min-w-11`, now match `coarse-pointer:min-w-11`
→ identical 44px. Only **coarse pointers ≥640px (tablets)** move: 26 → 44. That is exactly
the reported cohort and nothing else.

### KeyframeMarker.jsx — hand-rolled timeline buttons (not shared Button)

These are absolutely-positioned overlay buttons, so blindly forcing 44×44 risks overlap on
the dense timeline. Design:

1. **Diamond select/drag hit area** (`KeyframeMarker.jsx:93`): widen the invisible hit pad
   on coarse pointers only.
   ```
   // was: <div className="absolute -inset-3 bg-transparent" />
   <div className="absolute -inset-3 coarse-pointer:-inset-4 bg-transparent" />
   ```
   `-inset-3` (12px) → 36px; `coarse-pointer:-inset-4` (16px) → **44px**. Desktop unchanged.

2. **Delete button** (`KeyframeMarker.jsx:100-114`) and **Copy button**
   (`KeyframeMarker.jsx:72-85`): give a coarse-pointer 44px box with flex-centering, keeping
   the 13px glyph visually the same.
   ```
   // append to each button's className:
   coarse-pointer:min-w-11 coarse-pointer:min-h-11 coarse-pointer:flex coarse-pointer:items-center coarse-pointer:justify-center
   ```
   In Framing (`CropLayer`) only the **delete** button renders (`showCopyButton={false}`),
   positioned `-top-5` above a 12px diamond — a single 44px box there does not collide.
   In Overlay (`RegionLayer`) both can show, stacked (copy `-top-5`, delete `top-4`). On a
   44px box those overlap, so when BOTH buttons are present bump the vertical separation on
   coarse pointers: copy → `coarse-pointer:-top-12`, delete stays `top-4` (they clear each
   other and the diamond). Verify visually in Overlay on the iPad project; adjust offsets if
   the evidence screenshot shows overlap. (Framing is the reported surface and the primary
   acceptance gate; Overlay parity is in-scope because it's the same component.)

`ZoomControls`, `Controls`, and the mobile-fullscreen toggles need **no per-file change** —
they all consume the shared `Button size="sm" iconOnly` and are fixed by the primitive edit
above.

## Context

### Relevant Files (REQUIRED)

Changed:
- `src/frontend/tailwind.config.js` — add `fine-pointer` / `coarse-pointer` variants (plugin)
- `src/frontend/src/components/shared/Button.jsx` — `sizeStyles` iconOnly floors (L110-115)
- `src/frontend/src/components/timeline/KeyframeMarker.jsx` — diamond hit pad + delete/copy
  boxes (L72-85, L93, L100-114)
- `src/frontend/e2e/helpers/usabilityAudit.js` — add `assertTouchTargetSizes` invariant #4
- `src/frontend/e2e/screen-usability.selfcheck.spec.js` — self-check the new assertion (see
  Testing)

Read-only / verified-unchanged (consume shared Button, no edit):
- `src/frontend/src/components/Controls.jsx`
- `src/frontend/src/components/ZoomControls.jsx`
- `src/frontend/src/modes/FramingModeView.jsx` (mobile-fullscreen Crop/exit toggles)

### Related Tasks
- Builds on **T4930** (mobile/viewport usability matrix + `usabilityAudit.js` + iPad
  project). This task adds the touch-target-size dimension the matrix does not yet check.
- Sibling to **T4880/T4931/T4932/T4933** (mobile layout fixes) — same "mobile shipped
  undetected" class, different axis (target size vs reachability).

### Technical Notes
- **Blast radius is intentional and wide.** `size="sm" iconOnly` appears in ~20 files
  (Controls, ZoomControls, AnnotateControls, PlaybackControls, ClipsSidePanel, RankingGame,
  UnifiedHeader, DownloadsPanel, ProjectManager, modals, …). The primitive fix upgrades ALL
  of them on touch and NONE of them on desktop — that is the point, not a risk. The reviewer
  should confirm the desktop-unchanged claim, not chase per-call-site regressions.
- **Do not** re-introduce a width breakpoint (`sm:`/`lg:`) for touch sizing — width ≠ input
  type is the whole bug. Pointer media queries are the canonical fix.
- Touch laptops / 2-in-1s: with a mouse attached the primary pointer reports `fine` →
  desktop sizing; in tablet mode it reports `coarse` → 44px targets. Correct either way.
- No persistence, no store, no schema, no backend. Pure presentational CSS-class change +
  one test helper.

## Implementation

### Steps
1. [ ] `git checkout -b feature/T5360-touch-target-sizes-tablet`
2. [ ] Add `fine-pointer` / `coarse-pointer` variants to `tailwind.config.js`
3. [ ] Rewrite `Button.jsx` iconOnly `sizeStyles` to the pointer-keyed floors
4. [ ] Update `KeyframeMarker.jsx` diamond hit pad + delete/copy boxes (+ overlay offsets)
5. [ ] Add `assertTouchTargetSizes(page, manifest)` invariant #4 to `usabilityAudit.js`,
       call it inside `auditScreen`; thread a per-action `minTarget` override for the dense
       timeline diamonds if needed
6. [ ] Extend `screen-usability.selfcheck.spec.js` to prove the new assertion FAILS on a
       26px button and PASSES at 44px (the T4930 self-check idiom)
7. [ ] Run the usability matrix on the iPad + phone projects; save evidence screenshots
8. [ ] Lint (eslint hook) + commit with co-author line

### `assertTouchTargetSizes` sketch (invariant #4)

Behavioral, matrix-driven, matches the existing helper style:

```js
/**
 * Invariant #4: every primary action is a large-enough TOUCH TARGET.
 * On coarse-pointer (touch) viewports, each manifest action's rendered box must be
 * >= 44x44 CSS px (Apple HIG / WCAG 2.5.5 AAA). Skipped on fine-pointer projects —
 * mouse targets are intentionally smaller. Runs only when the device project is touch
 * (deviceScaleFactor/isMobile from context, or a passed `coarse` flag).
 */
export async function assertTouchTargetSizes(page, manifest, { min = 44 } = {}) {
  for (const action of manifest.actions) {
    const loc = action.locator(page);
    await loc.scrollIntoViewIfNeeded();
    const box = await loc.boundingBox();
    const floor = action.minTarget ?? min; // dense timeline markers may justify a lower, documented floor
    expect(box.width, `${manifest.name} > ${action.label}: touch target width`).toBeGreaterThanOrEqual(floor - 0.5);
    expect(box.height, `${manifest.name} > ${action.label}: touch target height`).toBeGreaterThanOrEqual(floor - 0.5);
  }
}
```

Gate it to touch projects inside `auditScreen` (e.g. `if (page.context()... isMobile)` or a
`coarse` param the spec passes for iPhone/iPad/Pixel projects). The Framing manifest in
`screenManifests.js` already enumerates the primary actions — reuse them; only add
`minTarget` where a control is a deliberately-small dense marker with a written justification.

## Acceptance Criteria

- [ ] On an emulated tablet (iPad project), every Framing playback control (play/pause,
      step ±, restart, fullscreen), both zoom controls, the mobile-fullscreen Crop/exit
      toggles, and the keyframe delete button render **≥ 44×44 CSS px**.
- [ ] Keyframe diamond select hit area **≥ 44px** on coarse pointers.
- [ ] **Desktop (Desktop Chrome project) is byte-identical** to before — spot-check the
      same controls still measure ~26px (sm), i.e. the fix did not fatten the desktop UI.
- [ ] `assertTouchTargetSizes` FAILS against a 26px control and PASSES at 44px
      (self-check spec proves both directions).
- [ ] Overlay keyframe copy+delete buttons do not overlap on the iPad project (evidence
      screenshot).
- [ ] eslint clean; frontend unit tests unaffected; usability matrix green on iPad +
      iPhone 14 + iPhone SE + Pixel 7 + Desktop.

## Progress Log

**2026-07-17**: Created from a Framing button-size investigation. Root cause is the
`sm:min-w-0 sm:min-h-0` width-keyed reset in `Button.jsx` stripping the 44px floor on
tablets (≥640px + touch). Design locked: pointer-capability Tailwind variants + unified
iconOnly floor + KeyframeMarker hand-rolled bump + a 4th `assertTouchTargetSizes` invariant
extending T4930's usability matrix. Desktop provably unchanged.
