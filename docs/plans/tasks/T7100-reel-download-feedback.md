# T7100: My Reel download has no visible feedback (menu closes before it's watchable)

**Status:** DONE — deployed 2026-08-16 prod.
**Impact:** 5
**Complexity:** 3
**Created:** 2026-08-16
**Updated:** 2026-08-16

## Problem

User report: "when I download a myReel, I don't get sufficient user feedback that I am
downloading. I do see a small spinner by the download button, but that's in a menu that goes
away."

Confirmed as two compounding bugs, not just a polish gap:

1. **The spinner is unwatchable by construction.** The download button lives inside a
   kebab/overflow menu on `ReelTile` (mobile bottom-sheet ~`ReelTile.jsx:325-338`, desktop
   popover ~`:388-403`). The click handler fires the download (fire-and-forget, not awaited)
   then calls `setMenuOpen(false)` in the SAME synchronous handler — unmounting the menu, and
   the spinner inside it, before any bytes have even started arriving. It flashes for at most
   a frame.
2. **The single-reel download endpoint is not a static file stream.** `GET
   /api/downloads/{id}/file` (`downloads.py:689-836`) downloads the source from R2, runs an
   ffmpeg concat to burn in the intro/outro, stamps metadata (T6360), THEN streams — as a
   `StreamingResponse` with **no `Content-Length`** header. This is mechanically identical to
   the collection-download endpoint's shape (full server-side compose before first byte,
   indeterminate size) — the T7050 "spinner + live received-byte readout, never a dishonest
   determinate bar" reasoning applies directly here, not as a style borrow.

**Also found, must fix in the same task (same root cause, not scope creep):**
`useDownloads.js::downloadFile` currently swallows every failure into an internal `error`
state that `DownloadsPanel.jsx` never reads anywhere — **download failures are 100% silent
today.** Grepped and confirmed: no component destructures `error` from the hook for this flow.

## Solution

Approved UX design (ui-designer agent, 2026-08-16) — reuses two patterns already established
in this codebase rather than inventing new ones:

- **T7050's streaming/progress mechanism** (`useDownloads.js:234-288`,
  `downloadCollection`) — same backend response shape (no `Content-Length`, full compose
  before first byte), so the same "indeterminate spinner + live byte readout" UI is correct
  here, not just similar.
- **`ReelTile`'s existing pattern of persistent, always-mounted tile chrome outside the menu**
  (the "NEW" dot, rank badge — `ReelTile.jsx:205-247`) — proves a corner/scrim indicator
  surviving menu-close is architecturally normal on this component already.

**Where feedback lives:** the tile's bottom scrim (which already shows a `metaLine` — download
status temporarily takes over that slot, higher-priority info in the moment) + the kebab icon
itself (where the user's eye already is, swapped to a spinning `Loader` like 3 other menu items
in this file already do). No new progress-bar component, no `SegmentedProgressStrip`-style bar
(that component signals a PERMANENT draft-pipeline state — borrowing its visual weight for a
transient action would misrepresent a published reel as having a pipeline again; the UI style
guide explicitly calls out `ReelTile` as "WITHOUT draft-progress chrome").

**Failures:** `toast.error('Could not download reel', ...)` via the existing app-wide `Toast`
system (already used elsewhere in `DownloadsPanel.jsx`, mounted independently at the app root
so it survives the panel itself closing mid-download). No success toast — matches the T7050
collection precedent; the browser's own download-saved indicator is the completion signal in
both cases.

### States

| State | Tile scrim | Kebab icon | Global |
|---|---|---|---|
| Default | `metaLine` shown | `MoreVertical`, hover-gated (fine pointer) | — |
| Downloading, before first byte | "Preparing…" + spinning `Loader` (cyan) | Spinning `Loader` (cyan), forced full opacity | — |
| Downloading, bytes arriving | "Downloading… 2.4 MB" (live) | Spinning `Loader`, forced full opacity | — |
| Success | Reverts to `metaLine` instantly on resolve | Reverts to `MoreVertical` | none (matches T7050) |
| Error | Reverts to `metaLine` instantly on reject | Reverts to `MoreVertical` | `toast.error(...)` — first time this flow surfaces failures at all |
| Menu reopened mid-download | Download menu item still shows its own `Loader`+`disabled` (existing code, now actually reachable) | — | — |

### Considered and rejected
- **A `SegmentedProgressStrip`-style bottom bar** (matching `DraftTile`) — misrepresents a
  published reel as having a pipeline; style guide explicitly excludes this chrome from
  `ReelTile`.
- **Aborting the in-flight fetch if the panel closes mid-download** — the user explicitly
  requested this download; closing the drawer shouldn't cancel it. Verified the fetch + its
  `.catch`/toast keep running via closure regardless of `DownloadsPanel`'s mount state
  (`ToastContainer` is mounted independently at `main.jsx` root).
- **A "download complete" success toast** — rejected for consistency with T7050 (no success
  toast there either); the browser's native indicator already communicates completion.
- **A compose-time estimate in the copy** (like the collection footer's "~1 minute") — a
  single reel's concat should be much faster than a multi-clip stitch and no duration data was
  in hand; "Preparing…" intentionally makes no time claim.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/hooks/useDownloads.js` — `downloadFile` (`:168-210`): rewrite to stream via
  `response.body.getReader()` + `onProgress`-equivalent state (mirrors `downloadCollection`
  `:234-288`), re-throw failures instead of swallowing into unread `error` state; add
  `downloadProgress` state paired 1:1 with existing `downloadingId`
- `src/frontend/src/components/DownloadsPanel.jsx` — `handleDownload` (`:467-472`): make async,
  wrap in try/catch, `toast.error` on failure; also fix the story-player download call site
  (`:834`, currently fire-and-forget with no catch — becomes an unhandled rejection once
  `downloadFile` re-throws, so this is a required fix not scope creep); wire `downloadProgress`
  through to `<ReelTile>` (`:666-679`); drop the stray `console.log` at `:469` (debug leftover)
- `src/frontend/src/components/collections/ReelTile.jsx` — bottom scrim block (`:285-287`,
  replaces `metaLine` conditionally), kebab button (`:309-324`, icon swap + forced-opacity rule
  while downloading), new `downloadProgress` prop, local `formatBytesShort` helper (mirrors
  `CollectionHeader.jsx`'s `formatBytes` minus the GB rung reels don't need)

### Related Tasks
- Reuses: T7050 (collection-download progress bar — same backend-shape reasoning, same
  spinner-not-bar UI decision)
- Precedent for tile chrome outside the menu: existing "NEW" dot / rank badge on `ReelTile`

### Technical Notes
- New optional `downloadProgress` prop (`{receivedBytes, totalBytes}` or `null`) is
  `undefined`-safe and only activates when `downloadingId === download.id` — existing
  `ReelTile` tests that don't pass it are unaffected.
- `text-cyan-300` for the in-progress state matches this tile's existing accent (kebab hover
  ring `cyan-400`, Play icon accent, rank-badge `cyan-500`) — reads as "your action," distinct
  from neutral `metaLine` gray and from error/destructive red.
- The kebab's forced-full-opacity-while-downloading (even on fine pointers, where it's
  normally hover-gated) follows the UI style guide's "a control the user must find is rendered
  at rest" rule — a status indicator is exactly that case; it must not require hovering to see.
- Test model: `CollectionDownload.test.jsx` (T7050's tests) is the pattern to mirror for a new
  `ReelDownload.test.jsx` or extended `ReelTile.test.jsx` coverage.
- Fast-follow flagged, NOT included in this task: giving the story player's own inline download
  UI (`IntroStoryPlayer`, already has its own `downloadLoading`) the same byte-readout
  treatment — different component with its own layout constraints, no regression risk from
  deferring it.

## Implementation

### Steps
1. [ ] Rewrite `downloadFile` in `useDownloads.js`: streaming reader + `downloadProgress`
       state + re-throw on failure (remove the swallow-into-unread-`error` pattern)
2. [ ] `DownloadsPanel.jsx`: async `handleDownload` + try/catch + `toast.error`; fix the
       story-player download call site the same way; wire `downloadProgress` prop through;
       drop the stray `console.log`
3. [ ] `ReelTile.jsx`: scrim status row (Preparing… / Downloading… N MB), kebab icon swap +
       forced-opacity rule, `formatBytesShort` helper, new `downloadProgress` prop
4. [ ] Tests: extend `ReelTile.test.jsx` / new `ReelDownload.test.jsx` modeled on
       `CollectionDownload.test.jsx` — cover the states table above, including the
       previously-silent failure path

### Progress Log

**2026-08-16**: UX design proposed by ui-designer agent and approved by user. Root cause
confirmed to be two compounding bugs (menu unmounts the spinner synchronously; failures are
silently swallowed), not a pure visual gap. Not yet implemented.

## Acceptance Criteria
- [ ] Download progress is visible on the tile (scrim + kebab) for the full duration of the
      download, independent of whether the menu is open or closed
- [ ] Progress shows a live received-byte readout once bytes start arriving (indeterminate
      spinner before that, since the backend sends no `Content-Length`)
- [ ] A failed download surfaces a `toast.error` — today it fails 100% silently
- [ ] Reopening the menu mid-download still shows the existing per-menu-item spinner/disabled
      state correctly
- [ ] No regression to the story-player's own download flow
- [ ] Tests pass (frontend unit), including new coverage for the failure-toast path
