# T5190: Card image upload + parental-consent attestation

**Status:** WIP
**Impact:** 7 | **Complexity:** 3
**Epic:** [Player Intro + Rich Text](EPIC.md) — foundation, runs in parallel with T5180

> Read [EPIC.md](EPIC.md) (decisions 2, 2b, 3, 3b, 7 and the compliance posture). Knowledge docs:
> `.claude/knowledge/persistence-sync.md` (per-profile R2 prefixes), `.claude/knowledge/backend-services.md`.

## Rescoped 2026-08-03

This task was "Athlete profile fields + photo + consent" — ten athlete columns on the `profiles`
table (name, positions, jersey numbers, height, grad year, DOB, club, role, high school) plus a
`user_db` v006 migration, so the intro card could compose itself.

**Epic decision 3 dropped the structured field set (2026-08-03).** Cards carried free text the user
typed, so the fields were not on the critical path — and not collecting them meant storing
materially less personal data about a minor. What remained was the part every card needs: getting an
image into per-profile R2 storage, and capturing consent.

## Epic decision 3 REVERSED 2026-08-04 — position/class/team are back, as three fields only

**Decision 3 was partially reversed the next day.** Epic decision 2 changed: the card layout is no
longer picked from a template menu, it is **derived from which facts the user chooses to show**
(`no photo -> title-only`, `+1 fact -> hero`, `+2 -> broadcast`, `+3 -> recruiting` — [EPIC.md
decision 2](EPIC.md)). Deriving a composition from **content** requires the content to be **named,
typed fields** — free text has no field count to derive a layout from. So decision 3 reversed for
exactly the fields decision 2 needs:

- **`position`** (free text, e.g. "Midfielder 6-8-10")
- **`class`** (grad year, free text, e.g. "2029")
- **`team`** (free text, e.g. "Riverside FC")

Stored on the **profile** (not per-card) so they are typed once and every card auto-fills — a team
change edits one place ([EPIC.md decision 3](EPIC.md)). This is a **deliberate partial reversal**,
far lighter than the original ten-column spec this task started as: **3 fields, not 10** — still no
DOB, no height, no high school, no jersey number, no club/role. The data-minimisation posture that
makes T5230 tractable still holds; it was never "zero structured fields," it was "only the fields a
derived layout actually needs."

If a future feature needs athlete facts beyond these three, file it fresh against
`tasks/athlete-profile/T1610-profile-fields.md` (still TODO) — do not grow this task's field set.

## Scope

### A. Image upload endpoint (new, small)

- `POST /api/profiles/{profile_id}/intro/image` — single image, multipart.
- Validate **type and size** by decoding (cv2/Pillow), not by trusting the extension or the
  declared content type. Reject anything that is not a real image.
- Re-encode to a sane ceiling (long edge ~1440px, JPEG/PNG preserving alpha when present) — the
  same shape as the existing poster upload in `routers/export/overlay.py`, which is the closest
  precedent in the codebase and should be read before writing this.
- Store under the **per-profile** prefix `{APP_ENV}/users/{uid}/profiles/{pid}/intro/{uuid}.{ext}`
  via `storage.py` helpers. **Per-profile is mandatory** — an intro asset under any other prefix
  404s cross-profile (epic decision 7).
- Return the stored key + a presigned preview URL. **Follow-up (2026-08-04):** the original plan
  ("the key is written onto a card row by T5195") was a spec error — nothing persisted it, so an
  uploaded photo did not survive a reload. The photo is now owned at the **profile** level: the
  key is stored in the same per-profile `user_settings` KV as consent (`intro_photo_key.{profile_id}`,
  no migration) and exposed as `introPhotoKey` + a freshly presigned `introPhotoUrl` on both
  `GET /api/profiles` and `GET /api/bootstrap`. This is also the correct home regardless of the
  card row: a profile has no card until one is created, and a future card (T5195) may default its
  own image from this profile-level photo instead of requiring a fresh upload per card.
- Do NOT reuse the blake3/faststart multipart `uploadManager.js` flow — that is video-specific
  overkill for a single still.
- Gesture-based: the upload is its own explicit user gesture, never a reactive effect.

### B. Deletion

- A matching delete path so a removed card's image does not linger in R2, and so
  [T5230](T5230-childrens-data-compliance.md) has a real function to call from the purge path.

### C. Parental-consent attestation

- Store `intro_consent_at` (timestamp) per profile. With the athlete fields dropped, the natural
  home is a row in the existing per-profile settings rather than a new profiles column — pick the
  cheapest location that survives sync, and state the choice in the design.
- UI: a checkbox at first card creation — *"I am the parent or guardian, I consent to using this
  player's likeness, and I understand it becomes publicly visible to anyone I share a link with."*
- **Block intro use until consented**: no card can be attached to a reel or collection without it.
- Consent is recorded once per profile, re-shown if it is ever revoked.

### D. Structured intro facts (added 2026-08-04, epic decision 3 reversal)

- `position`, `class`, `team` — same per-profile `user_settings` KV mechanism as consent/photo
  (`intro_position.{profile_id}`, `intro_class.{profile_id}`, `intro_team.{profile_id}`), so no
  migration. `get_intro_fact`/`set_intro_fact`/`clear_intro_fact`/`get_all_intro_facts` in
  `services/user_db.py`.
- `PUT /api/profiles/{profile_id}/intro/facts` body `{field, value}`, one field per call — surgical,
  matching the gesture-based-sync rule (never a full-blob PUT of all three). An empty/whitespace
  value **clears** the field (DELETEs the KV row) rather than storing `""`.
- Exposed as `position`/`class`/`team` (already camelCase, single-word) alongside
  `introPhotoKey`/`introConsentAt` on **both** `GET /api/profiles` and `GET /api/bootstrap`.
- All three are **optional and independently clearable**. An absent field is a real state a card
  composition reads to pick `title-only`/`hero`/`broadcast`/`recruiting` (epic decision 2) — this
  task never substitutes a placeholder for a missing fact; prompting the user to fill a field a
  chosen composition needs is the editor's job ([T5205](T5205-card-editor-ui.md)), not this one's.
- `ProfileIntroSection.jsx` renders the three inputs; each commits on **blur** (or Enter), never per
  keystroke and never via a reactive effect — local `draft` state holds keystrokes, and the write is
  skipped entirely if the trimmed value didn't change from the profile's stored value.
- **Compliance (T5230):** position/class/team are a minor's personal data exactly like the photo and
  consent timestamp. [T5230](T5230-childrens-data-compliance.md)'s privacy export + purge MUST
  include all three fields (`clear_intro_fact` for each of `position`/`class`/`team`, mirroring
  `clear_intro_photo_key`/`clear_intro_consent`) — T5230 is still TODO and has not wired this up yet;
  this note is so its implementer doesn't miss the three new KV prefixes when it lands.

## Relevant files
- `src/backend/app/routers/profiles.py` — where the endpoint belongs
- `src/backend/app/routers/export/overlay.py` — `POST /projects/{id}/poster/upload` is the pattern
  to copy (decode-verify, re-encode, deterministic key, overwrite-safe)
- `src/backend/app/storage.py` — R2 helpers, per-profile `r2_key`
- `src/frontend/src/stores/profileStore.js`, `src/frontend/src/components/ManageProfilesModal.jsx`

## Classification hint
M-tier. Backend + a small frontend surface. **No schema migration** if consent lands in the existing
settings store; if the design chooses a `profiles` column instead, it needs `user_db` v008 and the
Migration agent. Reviewer required.

## Acceptance criteria
- [x] An image uploads to the per-profile `intro/` R2 prefix and returns a key + preview URL.
- [x] Non-images and oversized files are rejected by decoding, not by extension.
- [x] Deleting a card's image removes the R2 object.
- [x] The uploaded photo key and consent survive a reload (persisted at the profile level, not just
      returned in the upload response — see the 2026-08-04 follow-up in scope A).
- [x] Consent attestation is captured per profile and gates intro use.
- [x] Upload and consent are explicit gesture handlers — no reactive persistence.
- [x] `position`/`class`/`team` persist per profile, are exposed on both `GET /api/profiles` and
      `GET /api/bootstrap`, are independently clearable, and survive a reload.
- [x] Editing position/class/team is gesture-based (commit on blur), never per keystroke, never a
      reactive effect.
- [ ] Only `position`/`class`/`team` are added — no birthdate, height, high school, jersey number, or
      club/role (epic decision 3's reversal is scoped to exactly these three; decision 3's
      minimisation intent otherwise still holds).
