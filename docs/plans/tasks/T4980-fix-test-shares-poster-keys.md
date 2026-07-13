# T4980: test_shares payload key-set assert not updated for T4890 poster fields (red on master)

**Status:** DONE
**Impact:** 3
**Complexity:** 1
**Created:** 2026-07-12
**Updated:** 2026-07-12

## Problem

`tests/test_shares.py::TestGetSharedVideoBackgroundsAnalytics::test_payload_unchanged_and_milestone_backgrounded`
fails on master and passes at the 2026-07-10 prod base (`ef723e0d`) — the only
master-only unit regression found by the 2026-07-12 derisk sweep.

The T4890 share-poster work intentionally added three fields to the
`GET /api/shared/{token}` payload, but this test asserts the EXACT key set:

```
E  Extra items in the left set:
E  'video_poster_width'
E  'video_poster_url'
E  'video_poster_height'
```

The payload change is the feature (verified live on staging: unfurls serve the
poster). Only the test is stale. Every full-suite run is red until fixed, which
erodes the "compare against known-failures.md" discipline.

**Repro:**
`cd src/backend && pytest "tests/test_shares.py::TestGetSharedVideoBackgroundsAnalytics::test_payload_unchanged_and_milestone_backgrounded" -v`
(needs a dev/throwaway `DATABASE_URL`; NEVER staging/prod — and note backend
tests truncate the DB they point at.)

## Solution

Update the expected key set to include `video_poster_url`,
`video_poster_width`, `video_poster_height`, and add value assertions for the
poster fields (URL shape when a poster exists; explicit None when not) so the
test keeps guarding the payload contract rather than just widening.

## Context

### Relevant Files (REQUIRED)
- `src/backend/tests/test_shares.py` — the key-set assert (~line 354)
- `src/backend/app/routers/shares.py` — where the poster fields are added
  (read-only reference for the expected shape)

### Related Tasks
- T4890 (share posters) — the feature that added the fields
- T4950 (poster prod rollout) — unaffected, but this test guards its payload

### Technical Notes
- Check whether `branch-ci.yml` runs this file; if the failure is currently
  masked in CI, say so in the commit message (process signal: a payload change
  merged without its contract test updated).

## Implementation

### Steps
1. [ ] Add the three keys to the expected set; assert poster values for both
       the has-poster and no-poster fixtures.
2. [ ] Run the single test + the full `test_shares.py` file; paste output.

### Progress Log

**2026-07-12**: Found by the derisk sweep full-suite run; attributed
new-vs-base by running the same test at `ef723e0d` (passes there).

## Acceptance Criteria

- [ ] The test passes on master
- [ ] Poster fields are value-asserted (not just added to the allowed set)
- [ ] Full `tests/test_shares.py` green in the same run
