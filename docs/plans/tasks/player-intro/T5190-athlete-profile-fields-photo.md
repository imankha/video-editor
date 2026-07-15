# T5190: Athlete profile fields + photo upload + consent

**Status:** TODO
**Impact:** 7 | **Complexity:** 5
**Epic:** [Player Intro](EPIC.md) — child 1 of 5 (foundation data model)

> Read [EPIC.md](EPIC.md) for the visual target, systems map, and compliance posture. This task
> is the data foundation the intro card ([T5210](T5210-intro-card-generation.md)) renders from.

## Problem

Profiles today hold only `id, name, color, sport, is_default` (`user_db.py:76-83`
`_USER_DB_SCHEMA`) — no athlete facts, no photo. T1610 (`tasks/athlete-profile/T1610-profile-fields.md`,
TODO) specced `athlete_name`/`team_name` but only `sport` ever landed. The intro needs the fields
shown on the reference card + a player photo.

## Scope

### Fields (add to the `profiles` table in `user.sqlite`)
Match the reference card, minimizing PII per EPIC decision #4:
- `athlete_name` (TEXT) — full name (OPTIONAL; warn it becomes public when shared)
- `positions` (TEXT) — e.g. "Midfielder" ; `jersey_numbers` (TEXT) — e.g. "6,8,10"
- `height` (TEXT) — free text e.g. `5'2"`
- `grad_year` (INTEGER) — the "Class" line. **Preferred over birthdate** (minimization).
- `birthdate` (TEXT, nullable) — **only if the user opts in**; encrypted at rest ([T5230](T5230-childrens-data-compliance.md)). Default: not collected.
- `current_club` (TEXT), `club_role` (TEXT, e.g. "Captain")
- `high_school` (TEXT) — OPTIONAL (public-exposure sensitive)
- `photo_key` (TEXT) — R2 key of the uploaded photo (per-profile prefix)
- `photo_cutout_key` (TEXT, nullable) — set by [T5200](T5200-player-cutout.md)
- `intro_consent_at` (TEXT/timestamp, nullable) — parental-consent attestation timestamp

All new columns nullable/defaulted so existing profiles are unaffected.

### Backend
- `user_db.py`: extend `_USER_DB_SCHEMA` profiles table + `create_profile`/`update_profile`
  (:899/:910) to read/write the new fields. **Dual-write rule:** also add a versioned `user_db`
  migration (next ver **v006**) that `ALTER TABLE`s the new columns onto existing DBs.
- `profiles.py`: extend `CreateProfileRequest`/`UpdateProfileRequest` (:54-63) and the list
  response (:84-94) with the new fields (camelCase over the wire).
- **Image-upload endpoint** (new, small): accept a single image (multipart), validate
  type/size, store under `{APP_ENV}/users/{uid}/profiles/{pid}/intro/photo.{ext}` via
  `storage.py` helpers, set `photo_key` on the profile. Do NOT reuse the blake3/faststart
  `uploadManager.js` multipart flow (video-specific overkill). Return a presigned URL for preview.

### Frontend
- `profileStore.js`: extend `createProfile`/`updateProfile` bodies (:105/:139) with the fields.
- New "Add Player Intro" section in `ManageProfilesModal.jsx` (or a dedicated modal): the field
  form + photo picker + preview. **Gesture-based save** (explicit submit handler — never a
  reactive effect). Photo upload is its own gesture.
- Parental-consent attestation checkbox ("I am the parent/guardian and consent to using this
  player's likeness; I understand it becomes publicly visible when I share it"), storing
  `intro_consent_at` on save. Block intro use until consented.

## Relevant files
- `src/backend/app/services/user_db.py` (:76 schema, :899/:910 CRUD)
- `src/backend/app/routers/profiles.py` (:54-63 models, :84-94 list)
- `src/backend/app/storage.py` (R2 helpers, per-profile `r2_key`)
- `src/frontend/src/stores/profileStore.js`, `src/frontend/src/components/ManageProfilesModal.jsx`
- Prior spec: `docs/plans/tasks/athlete-profile/T1610-profile-fields.md`

## Classification hint
L-tier: schema change (Migration agent — user_db v006), backend + frontend, new upload endpoint.
Architect gate recommended for the field set + consent UX. Coordinate the consent/DOB decisions
with [T5230](T5230-childrens-data-compliance.md).

## Acceptance criteria
- [ ] New athlete fields persist on the profile (gesture-saved); existing profiles unaffected (migration).
- [ ] Photo uploads to a per-profile R2 prefix; `photo_key` recorded; preview renders.
- [ ] Grad-year is the default "class" field; DOB is opt-in only and flagged for encryption.
- [ ] Consent attestation captured before intro can be used.
