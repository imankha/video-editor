# T13510: A play edited while offline is silently lost although the banner says it is saved

**Status:** TODO
**Impact:** 9
**Complexity:** 4
**Tier:** M (frontend persistence; possibly backend idempotency)
**Created:** 2026-10-26
**Updated:** 2026-10-26
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Staging QA part 2, 2026-10-26, 1440x900, account imankh+stg-qa-20261025@gmail.com (report `C:\Users\imank\Desktop\staging-qa-part2-2026-10-26\REPORT-FINAL.md`, bug 66, screenshot `BUG-66-offline-rating-lost-1440.png`). Severity: Blocker (data loss behind a reassuring message).

## Problem

Changing a play's rating while offline updates the screen and shows the banner "Offline -- your work is saved locally". The save request fails and is never retried. After coming back online and reloading, the old rating is back.

Console at the moment of the tap:

```
PUT /api/clips/raw/10  net::ERR_INTERNET_DISCONNECTED
[useRawClipSave] updateClip error: TypeError: Failed to fetch
```

No later request resends it.

## Repro steps

1. Sign in, open a game with at least one play (staging: "Vs Carlsbad QA", Play 6, 4 stars).
2. Select the play in the left list so Play Details shows the stars.
3. DevTools > Network > Offline (Playwright: `context.setOffline(true)`).
4. Tap the 2nd star. The text changes to "Technical lapse - a play to learn from." and the banner "Offline -- your work is saved locally" shows.
5. Go back online and wait 10 s.
6. Reload, open the same game, select the same play.

**Expected:** 2 stars (the change was sent once online), or, if it could not be saved, a visible error with Retry that does not claim the work is saved.
**Actual (before fix):** 4 stars. The change is gone, no error was ever shown.

Also check the other gesture writes that go through the same path (name, notes, tags, trim ends, "who is this play about").

## Solution direction

Either queue failed gesture writes and replay them on reconnect (in order, once), or fail visibly with Retry and stop claiming "saved locally". The banner copy must match what actually happens. Follow the gesture-persistence rules in CLAUDE.md (single write path, no reactive persistence, no blind retry that clobbers newer state).

## Context

### Relevant Files
- `useRawClipSave` (frontend hook named in the console error) and its caller in `AnnotateScreen`
- The offline banner component (search "your work is saved locally")
- `.claude/knowledge/persistence-sync.md`, `.claude/knowledge/annotate.md`

## Verify the fix (required, before and after)

1. **Before the fix:** run the repro steps above against the current code (staging or local) and confirm the edit is lost after reload. Record the console/network lines. Write the regression test first and see it fail for this reason.
2. **After the fix:** run the same steps on the same play and confirm the new rating survives reconnect and reload (or a clear error with Retry appears and no "saved" claim). Repeat for one other field (notes or trim end).
3. Attach both runs (before: lost; after: kept) to the task's progress log.

## Acceptance Criteria

- [ ] An edit made offline is either saved once the connection returns, or the user sees an error with Retry; never silently dropped
- [ ] The offline banner never says "saved" for something that is not saved
- [ ] Regression test that fails on the current code and passes after the fix
- [ ] Before/after repro recorded as above
