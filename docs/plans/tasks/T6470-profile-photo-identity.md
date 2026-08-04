# T6470: Use the profile's intro photo as its identity mark, instead of the sport icon

**Status:** TODO
**Impact:** 6 | **Complexity:** 3
**Requested:** user 2026-08-04 ("if a player intro card has been uploaded for a profile, we should use
that visualization instead of the sport icon to denote the user is in that profile")
**Depends on:** [T5190](player-intro/T5190-card-image-upload-consent.md) (the profile-level intro photo key)

## Problem

A profile is currently denoted by its **sport icon** plus a colour — the same soccer ball for every
soccer profile, so two kids on one account are told apart only by colour and name. Once a parent has
uploaded a photo of their player ([T5190](player-intro/T5190-card-image-upload-consent.md)), the app
is holding a far better identity mark and ignoring it.

## Scope

### A. The rule

Wherever a profile is represented by its sport icon, show the **profile's intro photo** instead when
one exists. No photo -> the existing sport icon, unchanged. **Never a broken image and never a
generic silhouette placeholder** — the icon IS the fallback.

### B. Surfaces to cover (audit before implementing; this list is a starting point)

- `ProfileDropdown.jsx` — the active-profile control in the header (the "you are in this profile"
  affordance the user named)
- `ProfileSportButton.jsx`
- `ManageProfilesModal.jsx` — the profile list/editor
- `MoveToProfileModal.jsx` — picking a destination profile
- Any other place a profile is listed or switched

### C. Presentation

- Circular crop, `object-fit: cover`. The uploaded photo is a full portrait, so a naive centre crop
  lands on the torso.
- **Bias the crop toward the top of the frame** (a portrait's head is near the top). This is a fixed
  arithmetic bias, NOT detection: face detection on a minor's photo is **forbidden**
  (see [player-intro/EPIC.md](player-intro/EPIC.md) § Compliance — the 2025 COPPA amendment added
  facial templates to "personal information"). Do not add a "smart crop" of any kind.
- Keep the profile colour as a ring around the photo, so colour identity survives.
- The cut-out photo ([T5200](player-intro/T5200-player-cutout.md)) would be the ideal source when it
  exists — use `image_cutout_key` in preference to the raw photo if both are present.

### D. Serving the image (design question — decide before building)

The intro photo is currently read back as a **presigned URL** minted per read. That is fine for one
preview in profile settings and wrong for an avatar that renders on every screen: presigned URLs are
uncacheable across sessions and re-minting them per render will thrash.

Options: (a) a stable session-authed proxy route with an ETag and a long `max-age`, mirroring the
poster routes in `downloads.py`/`projects.py` (T5682 pattern — pooled R2 client, `If-None-Match` ->
304, negative-cache 404s); (b) presign once per session and cache in the store. **(a) is almost
certainly right** — the poster work already solved this exact problem — but confirm before building.

### E. Privacy boundary (non-negotiable)

The avatar is an **owner-facing** affordance. A minor's face must not leak into any shared or public
surface as a side effect of this change: check every share page, collection view, teammate view and
og:image path and confirm none of them start rendering it. The photo becomes public **only** through
an intro card the parent deliberately attached and shared
([T5215](player-intro/T5215-intro-attachment.md)/[T5220](player-intro/T5220-add-intro-integration.md)).

## Relevant files
- `src/frontend/src/components/ProfileDropdown.jsx`, `ProfileSportButton.jsx`,
  `ManageProfilesModal.jsx`, `MoveToProfileModal.jsx`
- `src/frontend/src/stores/profileStore.js` — `introPhotoKey` / `introPhotoUrl` land here in T5190
- `src/backend/app/routers/projects.py` `_serve_draft_poster_jpeg` — the caching-proxy pattern for (D)
- `.claude/knowledge/persistence-sync.md` — per-profile R2 prefixes

## Classification hint
M-tier, frontend-led with a small backend route if (D) picks the proxy. No schema change. Reviewer
required. Real-browser verification (T5380): this is pure visual chrome, so screenshots at both
states (photo / no photo) are the evidence.

## Acceptance criteria
- [ ] A profile with an intro photo shows that photo wherever its sport icon appeared.
- [ ] A profile without one is visually unchanged.
- [ ] The crop is top-biased and circular, with the profile colour retained as a ring.
- [ ] The cut-out image is preferred when present.
- [ ] The image is served cacheably — no per-render presign churn.
- [ ] No shared/public surface renders the photo as a result of this change (explicitly verified).
- [ ] No face/biometric detection of any kind was added.
