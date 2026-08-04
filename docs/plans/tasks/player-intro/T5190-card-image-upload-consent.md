# T5190: Card image upload + parental-consent attestation

**Status:** TODO
**Impact:** 7 | **Complexity:** 3
**Epic:** [Player Intro + Rich Text](EPIC.md) — foundation, runs in parallel with T5180

> Read [EPIC.md](EPIC.md) (decisions 3, 7 and the compliance posture). Knowledge docs:
> `.claude/knowledge/persistence-sync.md` (per-profile R2 prefixes), `.claude/knowledge/backend-services.md`.

## Rescoped 2026-08-03

This task was "Athlete profile fields + photo + consent" — ten athlete columns on the `profiles`
table (name, positions, jersey numbers, height, grad year, DOB, club, role, high school) plus a
`user_db` v006 migration, so the intro card could compose itself.

**Epic decision 3 dropped the structured field set.** Cards carry free text the user types
([T5205](T5205-card-editor-ui.md)), so the fields are not on the critical path — and not collecting
them means storing materially less personal data about a minor. What remains here is the part every
card needs: **getting an image into per-profile R2 storage**, and **capturing consent**.

If a future feature genuinely needs structured athlete facts, file it fresh against
`tasks/athlete-profile/T1610-profile-fields.md` (still TODO) — do not resurrect it here.

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
- Return the stored key + a presigned preview URL. The key is written onto a card row by
  [T5195](T5195-intro-card-library.md); this endpoint owns the object, not the row.
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
- [ ] An image uploads to the per-profile `intro/` R2 prefix and returns a key + preview URL.
- [ ] Non-images and oversized files are rejected by decoding, not by extension.
- [ ] Deleting a card's image removes the R2 object.
- [ ] Consent attestation is captured per profile and gates intro use.
- [ ] Upload and consent are explicit gesture handlers — no reactive persistence.
- [ ] No athlete PII field set is added (epic decision 3).
