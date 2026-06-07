# Mobile UX Spec

**Goal:** Make Annotate, Framing, and Overlay fully usable on mobile (360-428px portrait, landscape fullscreen). Desktop must remain unchanged -- all changes gated behind Tailwind `sm:` breakpoint or mobile-only state.

**Guiding Principle:** Maximize video real estate. Every pixel not showing video needs to justify itself.

---

## 1. Home Screen Consolidation

**Problem:** "Report a Problem", Quest Panel, and Credit Balance live in the editor header/floating overlays, consuming space on every screen. On mobile, that space is critical.

**Changes:**

| Element | Current Location | New Location (Mobile Only) |
|---------|-----------------|---------------------------|
| Report a Problem | Fixed bottom-right floating button (`main.jsx`) | Home screen footer / settings area |
| Quest Panel | Floating overlay, repositioned per mode (`QuestPanel.jsx`) | Inline section on Home screen, below games/reels list |
| Credit Balance | UnifiedHeader right side (`CreditBalance.jsx`) | Home screen header area |

**Rules:**
- Desktop: no change, all three stay where they are
- Mobile (`< sm`): hide from editor views, show on Home screen
- Quest panel on Home: always expanded (no floating), collapseable
- Credit balance just on Home
---

## 2. Annotate -- Portrait Mode

**Current problems (from screenshots):**
- Video occupies ~35% of screen height, massive black bars above and below
- Two rows of controls (playback + add/volume/speed/fullscreen) waste vertical space
- Timeline + clip markers barely visible
- Breadcrumb navigation takes a full row
- "Format: MP4 / Size: 2.8 GB" info wastes space in landscape

### 2.1 Portrait Layout (Top to Bottom)

```
+----------------------------------+
| [<] Game Name          [clips: 5]|  <- Compact header (40px)
+----------------------------------+
|                                  |
|          VIDEO PLAYER            |  <- Aspect-fit, no forced black bars
|       (touch to show/hide       |
|          controls overlay)       |
|                                  |
+----------------------------------+
| [<<] [<] [PLAY] [>] [>>] 01:23  |  <- Single row controls (48px)
| [+ Add Clip]                     |  <- Prominent CTA below controls (48px)
+----------------------------------+
|  |---[====]-------[==]------|    |  <- Timeline + clip markers
|  Clips  [■■■] [■] [■■]         |  <- Clip region layer
+----------------------------------+
|  Clip Details (if selected)      |  <- Scrollable clip editor
|  [* * * * *]  [tags]             |
|  [Start] ----scrub---- [End]     |
|  [Notes...]                      |
+----------------------------------+
```

### 2.2 Changes

| Element | Change | Why |
|---------|--------|-----|
| Header | Collapse breadcrumb to back arrow + game name only. Hide ModeSwitcher icons except current mode indicator. | Reclaim 20px height |
| Format/Size info | `hidden` on mobile | Not actionable on mobile |
| Zoom buttons | `hidden` on mobile | Pinch-to-zoom is native |
| Volume slider | `hidden` on mobile (keep mute toggle) | Device volume controls exist |
| Speed control | Keep as compact `1x` button with tap-to-cycle (1x -> 1.5x -> 2x -> 0.5x -> 1x) | Still useful for reviewing clips |
| Controls | Merge into single row: `[<<] [<] [PLAY] [>] [>>]` left, timestamp right | One row instead of two |
| Add Clip | Full-width green button below controls, always visible when no clip selected | Primary action must be prominent, 48px min-height |
| Fullscreen button | Keep, prominent placement in controls row | Landscape fullscreen is the primary mobile workflow |
| Timeline | Full width, touch-draggable scrubber with 48px hit area | Fat finger friendly |
| Clip details | Scrollable panel below timeline when a clip is selected | Natural flow, no overlay needed |

---

## 3. Annotate -- Landscape Fullscreen Mode

This is the **primary mobile workflow**. User rotates phone, taps fullscreen, and works in immersive mode.

**Reference:** YouTube mobile fullscreen (controls appear on tap, auto-hide after 3s).

### 3.1 Layout

```
+---------------------------------------------------------------+
|                                                                |
|                                                                |
|                      FULL-SCREEN VIDEO                         |
|                  (entire screen, edge to edge)                 |
|                                                                |
|                                                                |
+---------------------------------------------------------------+

TAP TO SHOW CONTROLS (auto-hide after 3s, cancel hide on touch):

+---------------------------------------------------------------+
| [X]                              01:23:45 / 01:28:54    [clips]|  <- Top bar (fades in)
+---------------------------------------------------------------+
|                                                                |
|                     [<<]  [<]  [PLAY]  [>]  [>>]               |  <- Center controls
|                                                                |
+---------------------------------------------------------------+
| |----[====]--●-------[==]------|     [+ Add Clip]             |  <- Bottom bar (fades in)
+---------------------------------------------------------------+
```

### 3.2 Control Overlay Behavior

| State | Visible | Auto-hide |
|-------|---------|-----------|
| Tap on video | Show all overlays | Hide after 3 seconds |
| Tap while overlays visible | Hide overlays immediately | - |
| Dragging scrubber | Keep overlays visible | Reset 3s timer on release |
| Dragging clip start/end handle | **ALL UI disappears** | Reappear on drag end |
| Playing video | Auto-hide after 3s | - |
| Paused | Keep visible indefinitely | - |

### 3.3 Top Bar

- **Left:** Exit fullscreen button (X icon), 48px touch target
- **Right:** Timestamp (`01:23 / 88:54`), clip count button (opens clip list sheet)
- Background: gradient from `rgba(0,0,0,0.7)` to transparent (YouTube-style)
- Height: 48px

### 3.4 Center Controls

- Large play/pause button (64px), flanked by skip/step buttons (48px)
- Semi-transparent circular backgrounds on each button
- Centered vertically and horizontally on the video
- These are the same controls as portrait, just repositioned and larger

### 3.5 Bottom Bar

- **Scrubber/timeline:** Full width, 48px touch target (visual bar is 4px, but hit area is 48px)
- **Clip markers:** Shown on timeline as colored ticks
- **Add Clip button:** Right side of bottom bar, compact green pill `[+ Add]`, 44px min-height
- Background: gradient from transparent to `rgba(0,0,0,0.7)`

### 3.6 Add Clip Flow in Landscape Fullscreen

When user taps `[+ Add]`:
1. Video pauses
2. Clip is created at current timestamp (existing behavior)
3. Bottom bar transforms to show clip editing controls:

```
+---------------------------------------------------------------+
| [X close]                    Editing Clip          [Save] [Del]|
+---------------------------------------------------------------+
|                                                                |
|                         VIDEO                                  |
|                                                                |
+---------------------------------------------------------------+
| [Start: 01:23] ====== drag handle ====== [End: 01:35]         |  <- Scrub region
| [*****]  [tag] [tag]  [notes...]               [Done]         |  <- Compact edit row
+---------------------------------------------------------------+
```

**Critical:** During start/end time handle drag, ALL UI disappears (top bar, bottom bar, center controls) so user sees the full video frame. UI reappears on drag end.

### 3.7 Clip Start/End Handle Drag -- Full Video Visibility

This is the key interaction for mobile annotation:

1. User touches the start or end time handle
2. `onDragStart` fires -> set `isDraggingClipHandle = true`
3. All overlay UI (top bar, center controls, bottom bar except the scrub region itself) fades out (150ms transition)
4. Only the dragged handle + a floating timestamp badge remain visible
5. Video frame occupies the full screen so user can see exactly where they're cutting
6. User releases -> `onDragEnd` fires -> `isDraggingClipHandle = false`
7. All overlay UI fades back in (200ms transition)

---

## 4. Framing -- Mobile Layout

**Current problems (from screenshots):**
- Clip details card (name, tags, resolution, duration) takes ~30% of portrait screen
- "Background: Dim/Dark" toggle and "Zoom: 100%" controls waste space
- Crop box handles are tiny (8px), hard to hit with fingers
- Video is pushed below the fold by metadata

### 4.1 Portrait Layout

```
+----------------------------------+
| [<] Clip Name            [clips] |  <- Compact header (40px)
+----------------------------------+
|                                  |
|         VIDEO + CROP BOX         |  <- Video with crop overlay
|      (pinch to zoom/pan,         |
|       drag crop box edges)       |
|                                  |
+----------------------------------+
| [<<] [<] [PLAY] [>] [>>]  01:23 |  <- Controls (48px)
+----------------------------------+
| |--------●-----------[KF]-------|  <- Timeline with keyframes
+----------------------------------+
| [+ Keyframe]   [Dim/Dark toggle] |  <- Action row (48px)
+----------------------------------+
```

### 4.2 Changes

| Element | Change | Why |
|---------|--------|-----|
| Clip details card | Collapse to single line in header (clip name only) | Metadata (1920x1080, 0:17, 30fps) not needed during framing |
| Zoom buttons | `hidden` on mobile | Pinch-to-zoom is native on touch devices |
| "Format: MP4 / Size" | `hidden` on mobile | Not actionable |
| Crop box handles | Increase to 24px touch targets (visual: 12px dot, hit area: 24px) | Apple HIG minimum is 44pt, but crop handles need precision -- 24px with visual feedback is the compromise |
| Background toggle | Keep as compact icon toggle in action row | Still useful |
| Keyframe add button | Prominent in action row | Primary framing action |

### 4.3 Crop Box Touch Targets

Current crop handles are 8px blue squares. On mobile:
- **Visual size:** 12px filled circles (more visible than squares)
- **Hit area:** 24px invisible touch padding around each handle
- **Corner handles:** 24px, positioned at corners
- **Edge handles (midpoints):** 24px, positioned at edge midpoints
- **Drag the box:** Touch inside the crop box and drag to reposition
- **Conflict resolution:** If touch is near a handle AND inside the box, handle wins (handle drag, not box drag)

### 4.4 Landscape Fullscreen

Same YouTube-style overlay pattern as Annotate:
- Video fills screen
- Tap to show/hide controls
- Controls: center play/pause, bottom timeline with keyframe markers
- Crop box always visible (it's part of the video content, not UI)
- "Add Keyframe" button in bottom bar

---

## 5. Overlay -- Mobile Layout

**Current problems:** Similar to Framing -- metadata card dominates, controls are small.

### 5.1 Portrait Layout

```
+----------------------------------+
| [<] Clip Name            [clips] |  <- Compact header (40px)
+----------------------------------+
|                                  |
|    VIDEO + HIGHLIGHT REGIONS     |  <- Video with highlight overlay
|    (tap region to select,        |
|     drag edges to resize)        |
|                                  |
+----------------------------------+
| [<<] [<] [PLAY] [>] [>>]  01:23 |  <- Controls (48px)
+----------------------------------+
| |--------●--------[R1]---[R2]---|  <- Timeline with regions
+----------------------------------+
| [+ Region]  [Style: ▼]  [Del]   |  <- Action row (48px)
+----------------------------------+
```

### 5.2 Changes

| Element | Change | Why |
|---------|--------|-----|
| Clip details card | Same as Framing -- collapse to header | Same reason |
| Zoom buttons | `hidden` on mobile | Pinch-to-zoom |
| Highlight region handles | Same 24px touch target treatment as crop handles | Same fat-finger problem |
| Region style picker | Compact dropdown instead of full panel | Space saving |

### 5.3 Landscape Fullscreen

Same pattern as Annotate/Framing:
- Video fills screen
- Tap to show/hide controls
- Highlight regions visible on video (they're content, not chrome)
- "Add Region" button in bottom bar
- Region edge drag hides all UI (same as clip handle drag in Annotate)

---

## 6. Cross-Cutting Concerns

### 6.1 Touch Target Minimums

All interactive elements on mobile must meet these minimums:

| Element Type | Min Touch Target | Visual Size |
|-------------|-----------------|-------------|
| Buttons (primary actions) | 48 x 48px | 44 x 44px |
| Buttons (secondary) | 44 x 44px | 36 x 36px |
| Icon buttons | 44 x 44px | 24 x 24px icon inside |
| Timeline scrubber | 48px height hit area | 4px visual bar |
| Crop/highlight handles | 24 x 24px | 12 x 12px visual |
| Clip markers on timeline | 16px min-width | Rating-colored blocks |

### 6.2 Gesture Support

| Gesture | Action | Where |
|---------|--------|-------|
| Pinch | Zoom video | All modes (replaces zoom buttons) |
| Two-finger pan | Pan zoomed video | All modes |
| Single tap on video | Toggle control overlay | Fullscreen only |
| Double-tap sides | Skip +/- 10 seconds | Fullscreen only (YouTube pattern) |
| Swipe up on bottom bar | Expand clip list (Annotate) | Fullscreen only |
| Long press on clip marker | Show clip preview tooltip | Annotate timeline |

### 6.3 YouTube-Style Controls Pattern (Shared)

All three modes use the same fullscreen overlay pattern:

```
Visible states:
  HIDDEN     -> tap video     -> VISIBLE (start 3s timer)
  VISIBLE    -> tap video     -> HIDDEN
  VISIBLE    -> 3s elapsed    -> HIDDEN (only while playing)
  VISIBLE    -> touch control -> VISIBLE (reset 3s timer)
  ANY        -> drag handle   -> DRAG_MODE (all UI hidden)
  DRAG_MODE  -> release       -> VISIBLE (start 3s timer)
```

**Implementation:** Shared `useFullscreenControls` hook managing visibility state, timer, and drag-mode override. Used by AnnotateModeView, FramingModeView, and OverlayModeView.

### 6.4 Responsive Breakpoint Strategy

- **All changes gated behind `< sm` (< 640px)** using Tailwind classes or a `useIsMobile()` hook where JS logic is needed
- Desktop layout must not change
- No new breakpoints needed -- the existing `sm:` threshold is correct for this work
- Test on: 360px (small Android), 390px (iPhone 14), 428px (iPhone 14 Pro Max)

### 6.5 Header Simplification (Mobile)

The `UnifiedHeader` on mobile should collapse to:

```
[<] Game/Clip Name ...truncated    [mode indicator]
```

- Back arrow: always visible, 44px touch target
- Title: truncated with ellipsis, flex-1
- Mode indicator: small icon showing current mode (scissors/crop/sparkle), tappable to switch modes
- No breadcrumb trail on mobile
- No CreditBalance, InstallButton, or SignInButton (moved to Home)

---

## 7. Implementation Phasing

### Phase 1: Foundation
- Add `useIsMobile()` hook (wraps `matchMedia` for `(max-width: 639px)`)
- Add `useFullscreenControls()` hook (visibility state, auto-hide timer, drag-mode)
- Move Report/Quest/Credits to Home screen (mobile only)
- Simplify UnifiedHeader for mobile

### Phase 2: Annotate Mobile
- Portrait layout: single-row controls, remove zoom/volume/format
- Landscape fullscreen: YouTube-style overlay controls
- Add Clip flow in fullscreen
- Handle drag -> hide all UI behavior
- Double-tap to skip

### Phase 3: Framing Mobile
- Portrait layout: collapse clip details, remove zoom buttons
- Enlarge crop handles for touch (24px hit area)
- Landscape fullscreen with crop overlay
- Pinch-to-zoom on video (replaces zoom buttons)

### Phase 4: Overlay Mobile
- Portrait layout: same simplifications as Framing
- Enlarge highlight region handles for touch
- Landscape fullscreen with highlight overlay

---

## 8. What This Spec Does NOT Cover

- Gallery/Downloads screen mobile layout (already functional)
- Video upload flow on mobile
- PWA/native app shell
- Offline support
- Push notifications
- New features -- this is purely making existing features usable on mobile
