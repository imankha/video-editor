# T1073 - Team + Athlete Name on Profile

**Status:** TODO
**Priority:** 3.5 (Impact 7, Cmplx 2)
**Epic:** For Launch

## Goal

Let a user set two fields on each profile: **team name** and **athlete name**. These feed downstream branding (overlay text, export filenames, share copy) and personalize quest and gallery UI.

## Why

- Current profile is just an opaque id — nothing personalized to the athlete.
- Exports and overlays default to generic labels; adding athlete/team makes output share-ready.
- Cheap precursor to T1050 (Team Invitations) and T1060 (Coaches View) — both need a real team/athlete notion to hang off of.

## Scope

**In:**
- DB columns `team_name TEXT`, `athlete_name TEXT` on `profiles` (nullable).
- Profile settings UI: two text inputs, saved via a gesture-based PATCH.
- Backend endpoint to update profile fields.
- Display athlete name in top nav or profile switcher.
- Default export filenames use athlete name when present.

**Out (for this task):**
- Team invitations / multi-user teams (T1050).
- Coach-assigned rosters (T1060).
- Profile photos / avatars — separate task.

## Design sketch

- Migration: `ALTER TABLE profiles ADD COLUMN team_name TEXT; ALTER TABLE profiles ADD COLUMN athlete_name TEXT;`
- `PATCH /api/profiles/{id}` — surgical update, only the changed fields (gesture-based persistence rule).
- Frontend: new `ProfileSettings` screen or extend existing settings modal.
- Export filename helper: `{athlete_name or user_id}_{date}.mp4`.

## Open questions

- Do we validate uniqueness of athlete/team names per user account? Probably no — multiple athletes on one account is fine.
- Should overlay templates auto-render these when present? Out of scope for this task; filed as follow-up if requested.

## Test plan

- Backend: test PATCH persists both fields, empty string clears them.
- Frontend: form saves on blur (gesture-based), UI reflects updated value after reload.
- Filename generator: falls back cleanly when fields are null.
