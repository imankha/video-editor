# T17740: Shared Download opens another video

**Status:** STAGING
**Impact:** 7
**Complexity:** 3
**Created:** 2026-11-18
**Updated:** 2026-11-18

## In plain words

A viewer opens a public highlight and presses Download. The browser leaves the shared page and opens the video in its built-in viewer instead of saving a file. This repeated on three fresh signed-out page loads. The Download action should start a file download.

## How we got here

Found by the full QA continuation on staging on 2026-11-18, build 91f0e6792 (#8105), desktop 1440 x 900. The storage check is the returning parent flow as e2e@test.local. The shared viewer is signed out.

## Repro steps

1. Open a public highlight link while signed out on desktop at 1440 x 900.
2. Click Download in its footer.
3. Observe the browser address and whether a file download starts.

**Expected:** The video downloads and the shared page remains available.
**Actual:** The current tab navigates to a cloud video address and plays it inline. No download starts.
**Repeats:** 3 of 3 fresh signed-out page loads.
**Also checked at:** Other device classes not checked for this exact fault yet.

## Evidence

- Screenshots: `qa/qa-pass-2026-11-18/bugs/B07-shared-download-1.png` through `B07-shared-download-3.png`.
- Measured record: `qa/qa-pass-2026-11-18/bugs/B07-download-repros.json`.
- Network: the video navigation returned 200 with Content-Type video/mp4 and no Content-Disposition header on all three tries. Signed URL credentials are omitted.
- Console: no exception established as the cause. Server: no failing request established; the successful response opens inline.
- Shared link: the QA-created highlight token beginning 284d6c65, retained locally in own-share-link.txt.

## Solution

Pressing Download saves the video file from the public page.

## Relevant Files

- `src/frontend/functions/shared/[token].js`, found by searching the visible Open ReelBallers and Download footer wording.

## Acceptance Criteria

- [ ] C1: Download starts a browser file download from the shared highlight page without replacing that page.
- [ ] C2: It also saves correctly on supported phone browsers.
