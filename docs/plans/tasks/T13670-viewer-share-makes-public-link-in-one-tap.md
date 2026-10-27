# T13670: One tap on Share in the Finished viewer makes a public link with no confirmation

**Status:** WIP
**Impact:** 5
**Complexity:** 3
**Tier:** M (frontend share flow; product decision)
**Created:** 2026-10-26
**Updated:** 2026-10-26
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Staging QA part 3, 2026-10-26, 1440x900 (also seen at 768 in part 2). Highlight "Play 6" (gallery id 9).

## Problem

In the Finished tab, opening a highlight with its Watch button shows a viewer with a cyan **Share** button. One tap sends `POST /api/gallery/9/share`, creates an "anyone with the link" share and copies it ("Link copied to clipboard"). There is no confirm, and no "who can watch" choice, unlike the tile menu's Share dialog ("Only people I add / Anyone with the link... Creating a link does not send it.") and the after-finish viewer's "Create share link" review step. A parent who taps Share to look at options has already made the video public. (Double tap is idempotent: two POSTs returned the same token.)

## Repro steps

1. Home > Finished > a highlight never shared publicly > its Watch (play) button.
2. Tap Share once.
3. Check the clipboard and `GET /api/gallery/{id}/shares`.

**Expected:** the same review step as elsewhere (choose who can watch, then create), or at least a clear confirm before a public link exists.
**Actual (before fix):** public link created and copied on the first tap.

## Verify the fix (required, before and after)

1. **Before the fix:** run the repro and record the POST and the created token; test that one tap on the viewer Share does not call the share endpoint; see it fail.
2. **After the fix:** same steps: no share is created until the user confirms; the link works after confirming; revoke still works.

## Acceptance Criteria

- [ ] No public link is created without an explicit confirm, from every Share entry point
- [ ] One consistent share flow (decide with the user)
- [ ] Test fails before, passes after
