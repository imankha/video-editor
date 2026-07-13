# T4280: Backend Silent-Fallback Sweep — Fail Visibly on Internal Data

**Status:** DONE
**Impact:** 6
**Complexity:** 3
**Created:** 2026-07-03
**Source:** Code quality audit ([audit-2026-07-03-code-quality.md](../audit-2026-07-03-code-quality.md) item A10 remainder; T4230/T4240 carry the two worst instances)

## Problem

**Exposure: varied — each site is a place where wrong data flows silently instead of failing loudly.** Project rule (CLAUDE.md "No Silent Fallbacks for Internal Data"): missing/invalid internal data is a bug that must be visible. These sites hide bugs today and will each eventually produce a "how did the data get like this?" incident (the audit found several past incidents with exactly this signature).

Verified sites (fix each; the pattern is the task):

| # | Site | Today | Correct behavior |
|---|------|-------|------------------|
| 1 | `routers/clips.py:402-406` | Keyframe missing geometry persisted as `or 0 / or 640 / or 360` — fabricated crop written to DB | Reject the action: 422 with which field was missing. Never invent geometry. |
| 2 | `routers/games.py:964` | `row['status'] or 'ready'` — NULL status displayed as ready | Trust the column; if NULL, log ERROR with game id and surface the real value (frontend can render unknown state). NULL status = bug to find, not hide. |
| 3 | `routers/games.py:930-931` | Unparseable `storage_expires_at` → `is_expired = False` (game silently active) | Log ERROR; treat as EXPIRED (safe direction: blocks share/re-export of possibly-gone video — matches T3970 semantics) |
| 4 | `services/local_processors.py:65-66` | ffprobe failure → dimensions default `1920, 1080` | Raise; a failed probe means the file is bad — processing it at guessed dimensions produces corrupt output downstream |
| 5 | `services/ffmpeg_service.py:~277` | `get_video_duration` failure → `0.0` | Raise (or return None and make every caller handle it explicitly — check the callers, pick the smaller change, be consistent) |
| 6 | Ratings: `games.py:810` `rating or 3`, `clips.py:839` `rating or 5`, `clips.py:1303` `rating or 3` | Three different invented defaults for the same field | Decide the real semantics of a NULL rating ONCE (probably "unrated", displayed as such), encode it in one helper, use it at all three sites. Three different fallback values for one field is the smoking gun of this whole audit. |

## Non-Goals

- Do NOT touch fallbacks at true external boundaries (network retries, third-party API responses) — the rule is about OUR data.
- Do NOT fix the frontend `|| 30` framerate fallbacks here (audit item C7, separate task — it needs the canonical-framerate design).
- projects.py:1275 catch-all and exports.py fallbacks are T4230/T4240 — skip them here.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/clips.py`, `src/backend/app/routers/games.py`
- `src/backend/app/services/local_processors.py`, `src/backend/app/services/ffmpeg_service.py`

### Technical Notes
- Some of these will surface latent data bugs when they start failing visibly — **that is the point**. If a fix reveals bad prod data (e.g., games with NULL status), file the data heal as its own follow-up (migration track — see memory "Running Migrations"), don't quietly re-add the fallback.
- For #3, read T3970 (expired-game gating) first so the expired-direction default matches its UX.
- Each site gets a test asserting the loud behavior (422 / raise / ERROR log), plus one asserting the happy path is unchanged.

## Implementation

### Steps
1. [ ] One commit per site (or per file), test-first each.
2. [ ] For #6: write the NULL-rating semantics decision in this file's Progress Log before coding.
3. [ ] `python -c "from app.main import app"` + backend tests after each commit.

## Acceptance Criteria

- [ ] None of the listed sites silently substitutes a default for internal data
- [ ] Each has a test for the failure behavior and the happy path
- [ ] NULL-rating semantics decided once, implemented in one helper, used at all three sites
- [ ] Any latent data issues surfaced are filed as follow-ups, not re-hidden
