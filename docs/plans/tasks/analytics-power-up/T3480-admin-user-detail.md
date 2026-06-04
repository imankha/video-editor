# T3480: Admin User Detail Redesign

**Status:** TODO
**Priority:** P1
**Impact:** 9 | **Complexity:** 4

## Summary

Replace the "cute" horizontal dot timeline with a power-user vertical action log. When a data analyst clicks on a user in the admin panel, they should see every action that user took, when, and with what context -- like reading a story, not glancing at a pretty diagram.

## Why

The current `JourneyTimeline` component shows milestone dots on a horizontal line. It tells you *which* milestones were reached and roughly *when*, but:
- No individual action instances (you see "Clip x3" not "created clip A at 9:22, clip B at 9:23, clip C at 9:25")
- No context (which game? which project? what rating?)
- No time deltas between actions (how long from first clip to first export?)
- No session grouping (which actions happened in the same session?)
- Not filterable or searchable
- Horizontal scroll is awkward at >10 milestones

## Design

### User Detail Panel (replaces JourneyTimeline modal)

Full-width panel that slides in from the right (or expands below the user row), with two sections:

**Header: User Summary**
```
imankh@gmail.com
Organic | Google | Joined 2026-05-22 | 26 sessions | Last active 6/3/2026 12:27 PM

Pipeline: Signup -> Upload -> Clip -> Annotate -> Frame -> Export -> Overlay -> Share
          5/22     5/23      5/23     5/23        5/24    5/25      5/25       --
```

A single line showing pipeline progression with dates. No circles, no animation -- just the facts.

**Body: Action Log**
```
Filter: [All actions v]  [Search context...]

DATE        TIME      ACTION                DELTA    CONTEXT
Jun 03      12:27 PM  session_started       4d 18h   pwa: true
May 29      06:14 PM  session_started       3d 22h   pwa: false
May 25      08:45 PM  share_completed       12m      2 recipients, video share
            08:33 PM  gallery_viewed         2m       --
            08:31 PM  overlay_exported       45m      project: Beach FC Highlights
            07:46 PM  export_started          1m      type: overlay
            07:45 PM  framing_exported       1h 3m    project: Beach FC Highlights
            06:42 PM  export_started          0m      type: framing
            06:42 PM  framing_opened          --      --
May 25      06:42 PM  session_started       1d 19h   pwa: true
May 23      11:31 AM  annotation_completed   9m      Beach FC, 22 clips
            11:22 AM  clip_created            0m      clip #22, rating: 3, Beach FC
            11:22 AM  clip_created            1m      clip #21, rating: 4, Beach FC
            ...
            09:15 AM  clip_created            1m      clip #1, rating: 3, Beach FC
            09:14 AM  game_created            --      Beach FC Apr 26
May 23      09:14 AM  session_started       1d 0h    pwa: false
May 22      09:02 AM  quest_completed        --      Quest 1: Get Started
            09:01 AM  session_started        --       first session
```

Key UX decisions:
- **Vertical, newest first** -- scroll down to go back in time
- **Grouped by session** -- session_started acts as a date header separator
- **Delta column** -- time since previous action. Gaps > 30min are highlighted (session boundary)
- **Context column** -- formatted from the JSON context blob, human-readable
- **Date shown once per day**, time shown for each action
- **Filterable** -- dropdown to filter by action type, text search on context

### Data Source

`GET /api/admin/analytics/user/{user_id}/actions` (from T3460) + `user_segments` info from T3450.

### Components

- Replace `JourneyTimeline.jsx` with `UserDetailPanel.jsx`
- Keep it in AdminScreen, triggered by clicking the activity icon on a user row
- Pipeline summary line at top: derive from `user_actions` (Postgres) for milestone first_at dates
- Action log in body: from SQLite `user_action_log` via new endpoint

## Implementation

### Frontend
- New component: `UserDetailPanel.jsx` (~200 lines)
- Remove or deprecate: `JourneyTimeline.jsx`
- Update `adminStore.js`: replace `journeyData`/`fetchJourney` with `userDetail`/`fetchUserDetail` that calls both the actions endpoint and segments endpoint

### Backend
- The actions endpoint (T3460) provides the log data
- Add segment info to the response (or fetch separately from `user_segments`)
- Add pipeline summary: query `user_actions WHERE user_id = ?` for milestone first_at values

## Dependencies

- T3450 (schema): user_segments table for header info
- T3460 (action log): user_action_log table + endpoint for the log body

## Notes

- For users who existed before T3460 deploy, the action log will be empty but the pipeline summary (from Postgres user_actions) will still show. This is fine -- the log fills going forward.
- No pagination needed initially -- even a power user won't have >500 actions. Add pagination if needed later.
- Context formatting: render JSON context as key: value pairs, skip null values. Known keys get human-readable labels (game_id -> game name lookup if available).
