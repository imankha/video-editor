# Mobile Responsive

**Status:** TODO
**Started:** -
**Completed:** -

## Goal

Make the app usable on mobile phones (Android Chrome, iOS Safari). Currently the desktop-first layout breaks on narrow screens: nav buttons truncate, two-column editors are unusable, and content overflows off-screen.

## Observed Issues (Android screenshots 2026-03-04)

1. **Top nav overflow** — "Framing", "Annotate", "Gallery" buttons truncated/clipped on all screens
2. **Home screen** — Gallery button partially hidden behind edge, game card stats layout messy
3. **Annotate clip details** — Right-side content bleeds off-screen, scrollbar visible
4. **Framing editor** — Two-column layout (clips list + video preview) squeezed side-by-side, unusable
5. **Video preview** — Tiny and crop rectangle barely visible when in half-width column

## Tasks

| ID | Task | Status |
|----|------|--------|
| T280 | [Mobile Navigation](T280-mobile-navigation.md) | TODO |
| T290 | [Mobile Home Screen](T290-mobile-home-screen.md) | TODO |
| T300 | [Mobile Annotate Screen](T300-mobile-annotate-screen.md) | TODO |
| T310 | [Mobile Framing/Editor Layout](T310-mobile-editor-layout.md) | TODO |
| T320 | [Mobile Video Preview](T320-mobile-video-preview.md) | TODO |
| T330 | [Mobile Video Players](T330-mobile-video-players.md) | TODO |

## Completion Criteria

- [ ] All screens functional on 360px-428px width (common Android/iPhone range)
- [ ] No horizontal overflow or truncated controls
- [ ] Video preview is usable (can see crop rectangle, play video)
- [ ] Tested on Android Chrome and iOS Safari
