# T7350: Mobile Share Skips the Native OS Sheet (UA-Sniff Regression)

**Status:** STAGING (merged 2026-08-20, CI green — user waived real-device staging test, merged on the container QA's Playwright coarse-pointer/fine-pointer evidence)
**Impact:** 6
**Complexity:** 3
**Created:** 2026-08-19
**Updated:** 2026-08-19

## Problem

User report 2026-08-19: tapping "Share" on a reel in the Gallery/My Reels panel on mobile
used to pop the native OS share sheet (letting the user post straight to Instagram, etc.).
Testing today, it instead goes straight into our own custom `ShareModal` — the behavior
that's supposed to be desktop-only.

**Root cause (found via git archaeology, not yet reproduced on a specific device):**
`DownloadsPanel.webShareReel` (`src/frontend/src/components/DownloadsPanel.jsx:598-620`)
gates the native-share attempt on `isMobile`, which comes straight out of
`useWebShare()`'s `isMobileDevice()` — a raw `navigator.userAgent` regex test
(`src/frontend/src/hooks/useWebShare.js:11-14`):

```js
function isMobileDevice() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && /Macintosh/i.test(navigator.userAgent));
}
```

```js
// DownloadsPanel.jsx
const webShareReel = async (e, download) => {
  if (!isMobile) {
    setSharingDownload(download);   // <-- opens the desktop ShareModal
    return;
  }
  ...
  await webShare({ ... });          // <-- native OS share sheet
};
```

If `isMobileDevice()` misreads the device as desktop, the native path never even gets a
chance — the code doesn't fall through to a capability check, it routes straight to the
custom modal. This is the **same landmine already fixed once** in `ReelTile.jsx`: T6300
(2026-08-01) found this exact `isMobile` UA-sniff misdetecting a touchscreen Windows
device as desktop ("I can't actually access the kebab or do anything") and deliberately
removed the flag from `ReelTile`/`DownloadsPanel`, replacing it with the matchMedia-based
`useIsCoarsePointer()` (`src/frontend/src/hooks/useIsMobile.js`) — no UA sniffing.

Then T5220's follow-up fix (`8a051985`, 2026-08-08) reintroduced the `isMobile` UA-sniff
into `DownloadsPanel.webShareReel`, for a legitimate but *different* bug: some desktop
Chromium builds expose `navigator.share()` for URL-only shares, so clicking Share on
desktop was popping a bare OS share sheet instead of the intended `ShareModal`
(recipient/visibility controls). That fix correctly needed *some* mobile/desktop signal —
but it grabbed the same fragile regex-based `isMobileDevice()` that had already bitten
this exact codepath once, instead of the matchMedia capability check the codebase had
already standardized on elsewhere.

Net effect: whatever devices the regex misclassifies as desktop (in-app browser
webviews, "Request Desktop Site" mode, UA strings that don't match the hardcoded
`Android|iPhone|iPad|iPod` list, etc.) silently lose native OS share and land on the
desktop modal instead — invisibly, no error, just the wrong UI. Confirming the exact
device/browser that misfired for the reporting user is part of this task.

## Solution

Replace the raw UA regex in `isMobileDevice()` (or its role in gating `capability` /
`isMobile` inside `useWebShare.js`) with the capability-based detection the codebase
already uses everywhere else for this exact mobile-vs-desktop distinction:
`useIsMobile()` / `useIsCoarsePointer()` (`src/frontend/src/hooks/useIsMobile.js`,
matchMedia on `(hover: none) and (pointer: coarse)` / `(pointer: coarse)`).

This fixes both directions at once: mobile devices that don't match the hardcoded UA
regex correctly get native share back, and desktop Chromium builds that expose
`navigator.share()` still correctly skip it (no fine-pointer/hover device matches the
coarse-pointer query), so T5220's desktop fix stays intact.

Before implementing, reproduce on the actual device/browser the user tested with (ask
which phone/browser, or check if it was opened inside an in-app browser / PWA / desktop-
site mode) to confirm the UA-sniff mismatch theory rather than assuming it.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/hooks/useWebShare.js` — `isMobileDevice()` UA regex, `capability` memo, `isMobile` return value
- `src/frontend/src/hooks/useWebShare.test.js` — existing T5220 regression tests pin UA-based `isMobile`; must be updated to pin the new capability-based detection instead of loosened
- `src/frontend/src/hooks/useIsMobile.js` — the matchMedia-based `useIsMobile`/`useIsCoarsePointer` pattern to reuse
- `src/frontend/src/components/DownloadsPanel.jsx:452-453,598-620` — `webShareReel`'s `isMobile` gate
- `src/frontend/src/components/collections/ReelTile.jsx` — header comment documents the T6300 history of this exact UA-sniff landmine; do not reintroduce it here

### Related Tasks
- Regression of the fix landed in T6300 (`57e07b89f`, 2026-08-01)
- Follow-up bug in T5220's fix commit (`8a051985`, 2026-08-08) — reintroduced the UA sniff for a legitimate desktop-only reason; see [[project_t5220_premature_merge_incident]]

### Technical Notes
- Keep the desktop behavior T5220 fixed: desktop must still skip native share and open
  `ShareModal` directly, even on Chromium builds that expose `navigator.share()`.
- `ShareCapability.FULL` vs `LINK_ONLY` also derives from the same `isMobile` value
  (`useWebShare.js:57-68`) — the capability-based swap needs to flow through both the
  `capability` memo and the standalone `isMobile` return value DownloadsPanel reads.
- `useIsMobile()`/`useIsCoarsePointer()` are React hooks (stateful, matchMedia listener);
  `useWebShare()` currently computes `isMobile` via a plain `useMemo` with no listener —
  confirm whether a live-updating value (e.g. orientation change, external display) is
  needed here or a one-shot read is fine, consistent with how `ReelTile`/`DraftTile`
  already consume `useIsCoarsePointer()`.

## Implementation

### Steps
1. [ ] Reproduce: identify the exact device/browser/mode that misfired for the user
2. [ ] Replace `isMobileDevice()`'s UA regex with a capability-based check
       (`useIsCoarsePointer` or equivalent matchMedia query) in `useWebShare.js`
3. [ ] Update `useWebShare.test.js` to pin capability-based detection (mock matchMedia,
       not `navigator.userAgent`) — keep the T5220 desktop-regression assertions green
4. [ ] Manually verify on a real phone: Share opens the native OS sheet, not `ShareModal`
5. [ ] Manually verify on desktop: Share still opens `ShareModal` directly, not the OS sheet

### Progress Log

**2026-08-19**: Investigated user report, traced root cause via git history
(T6300 → T5220 fix regression). Task filed, not yet started.

## Acceptance Criteria

- [ ] Native OS share sheet fires on mobile (real device test, not just UA-mocked unit test)
- [ ] Desktop still opens `ShareModal` directly, never the bare OS share sheet (T5220 stays fixed)
- [ ] `useWebShare.test.js` updated to test the new detection mechanism
- [ ] No raw `navigator.userAgent` regex sniffing left in the share capability path
