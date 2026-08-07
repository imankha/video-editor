# T6650: Deleting an intro card destroys the profile's intro photo (shared R2 object, two owners)

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-08-07
**Updated:** 2026-08-07

## Problem

The user uploaded a profile intro photo on 2026-08-07 (consent stamp `2026-08-07T00:32Z`), then found
the Edit Profile photo thumbnail broken. The photo is gone from R2 while the database still points at
it, so every surface that renders the profile photo shows a broken image and the user has no way to
tell what happened.

**Verified live state (2026-08-07, dev):**

| Fact | Evidence |
|---|---|
| Key is persisted | `user_settings.intro_photo_key.9fa7378c` = `dev/users/3ed03fb5-949d-4cfd-b708-0c758ea68ef3/profiles/9fa7378c/intro/66b98be0226a4c52b82a4ead6b1cb529.png` |
| Object does not exist | Full paginated `list_objects_v2` over `dev/users/3ed03fb5.../profiles/` filtered to `/intro/`: **6 objects, all dated 2026-08-04**; the `66b98be0...png` key is absent |
| Browser symptom | Presigned GET for that key returns **404** (HAR `Downloads/localhost.har`; Chrome masks the opaque `<img>` error as `ERR_BLOCKED_BY_ORB`) |

The user must re-upload once this is fixed. **Do not "heal" by re-pointing the key at the surviving
2026-08-04 object `5c8b0ffd563744188c15b85e4abef963.png`** — that is a different photo.

## Root cause

**One R2 object, two owners, and only one of them knows it is shared.**

1. A new card defaults its image to the profile's photo key — not a copy, the *same key*:
   `src/frontend/src/components/introcards/introCardDefaults.js:57`
   ```js
   image_key: profile?.introPhotoKey || null,
   ```
   (pinned by `introCardDefaults.test.js:24` as epic decision 3b, so it is intended behaviour).
   `IntroCardsModal.jsx:69` copies `image_key` again when a card is duplicated, so N cards plus the
   profile can all reference one object.

2. Deleting a card hard-deletes that object from R2, unconditionally:
   `src/backend/app/routers/intro_cards.py:331-333`
   ```python
   if image_key:
       delete_intro_image(user_id, profile_id, image_key)
   ```

3. Nothing clears or even checks `user_settings.intro_photo_key`, which still points at the deleted
   object. The profile photo is silently destroyed by a gesture on an unrelated object.

This directly contradicts the ownership contract asserted in `profiles.py:301-316`, whose docstring
says the upload endpoint "remains the sole owner of the R2 object" while a card "may later default
its own image from this profile-level key". The card-delete path violates that stated sole ownership.

It fires easily: create a card, delete it, and the profile photo is gone. That is exactly the shape of
2026-08-07's session, which was heavy card create/delete during T6640 QA.

### Hypothesis explicitly REFUTED — do not re-derive it

The 2026-08-07 session handoff proposed that the upload path "persisted the key without proving the
object landed" (a T4310 violation on the upload side). **That is wrong; the write path is already
correctly ordered and already fails loudly:**

- `profiles.py:320-332` — `store_intro_image()` runs first; `None` raises HTTP 500; only then does
  `set_intro_photo_key()` run.
- `intro_media.py:110-118` — returns `None` and logs ERROR when the upload reports failure.
- `storage.py:746-771` — `upload_bytes_to_r2_global` returns `False` if the client is missing or the
  PUT raises.
- `utils/retry.py:140-161` — `retry_r2_call` **re-raises** the last exception when retries are
  exhausted; it never returns success after a failed PUT.

So a failed upload cannot produce a persisted key. Do not "fix" the ordering in `profiles.py` — it is
already correct; fix the shared-object ownership instead.

## Solution

Decide the ownership rule, then make one path enforce it. Two candidates:

- **A (recommended): the profile owns the object; cards only reference it.** A card delete deletes
  the object only when no other card AND not the profile still references that key. Cheap to check —
  one `SELECT ... WHERE image_key = ?` plus the profile key comparison, in the same transaction that
  deletes the row. Preserves the docstring's stated contract.
- **B: cards own their own copy.** Defaulting a card from the profile photo COPIES the object to a
  new card-scoped key, so no key is ever shared. More R2 objects and a copy on every card create;
  only worth it if cards are expected to diverge (crop/cutout) anyway.

Whichever is chosen, two hardening items apply regardless:

1. **A dangling key must not fail silently.** If a resolved `intro_photo_key` has no object, surface
   it (the user sees "photo missing, re-upload" rather than a broken thumbnail) and log it. Broken
   `<img>` is not an error report.
2. **`intro_cards.py` delete is documented as "best-effort side effect"** — that is acceptable for an
   object the card owns, and unacceptable for one it merely references. Make the comment match the
   enforced rule.

Also decide whether a one-off cleanup is warranted for existing rows whose key has no object: the
correct repair is to CLEAR the dangling key (so the UI shows "no photo" and prompts re-upload), never
to re-point it at a different object.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/intro_cards.py` - card delete; the offending unconditional R2 delete (:331)
- `src/backend/app/routers/profiles.py` - upload/remove endpoints; ownership docstring (:301-363)
- `src/backend/app/services/intro_media.py` - `store_intro_image` / `delete_intro_image` (:97-137)
- `src/backend/app/services/user_db.py` - `intro_photo_key` settings accessors (:615-660)
- `src/frontend/src/components/introcards/introCardDefaults.js` - seeds card `image_key` from profile (:57)
- `src/frontend/src/components/introcards/IntroCardsModal.jsx` - duplicates `image_key` (:69)
- `src/backend/tests/test_t5195_intro_cards.py` - card CRUD tests
- `src/backend/tests/test_t5190_*` / intro media tests - upload/delete coverage

### Related Tasks
- Player Intro epic (`tasks/player-intro/EPIC.md`); photo upload shipped in T5190, card CRUD in T5195
- T6640 (cards) is live work on the same card CRUD surface — coordinate at merge time
- T5230 (children's-data compliance) also calls `delete_intro_image` for purge; its delete is
  intentional and must stay unconditional — the reference check must not weaken the purge

### Technical Notes
- Card `image_key` is also the input to `image_cutout_key` (T5200, deprioritised); a copy-on-default
  design (option B) should decide up front which key the cutout attaches to.
- No schema change is expected under option A. If option B is chosen, no schema change either — only
  new object keys.
- Multi-container QA against one dev account was active on 2026-08-07, but that only explains DB sync
  freezes; object PUTs and DELETEs are independent of DB sync, so it does not explain a missing
  object and must not be offered as the cause.

## Implementation

### Steps
1. [ ] Reproduce on a real account: upload profile photo, create a card (image defaults to it), delete
       the card, observe the profile photo object gone and the key still set.
2. [ ] Pick option A or B and record the decision in this file.
3. [ ] Implement the reference check (or copy-on-default) so a card delete cannot destroy an object
       another owner still references.
4. [ ] Surface a dangling key instead of rendering a broken image.
5. [ ] Decide and implement the repair for existing dangling keys (clear, never re-point).
6. [ ] Tests: card-delete-with-shared-key keeps the object; card-delete-with-exclusive-key still
       removes it; T5230 purge still deletes unconditionally.

### Progress Log

**2026-08-07**: Filed. Root-caused from the live evidence above; the handoff's upload-ordering theory
was checked against the code and refuted (see the refuted-hypothesis section). Not yet reproduced
end-to-end — step 1 is the first job.

## Acceptance Criteria

- [ ] Deleting a card whose `image_key` is also the profile's `intro_photo_key` leaves the object intact
- [ ] Deleting a card whose image nothing else references still removes the object (no orphan growth)
- [ ] Duplicated cards sharing one key survive each other's deletion
- [ ] A key with no object produces a visible, logged "photo missing" state, never a broken thumbnail
- [ ] T5230 compliance purge still deletes intro media unconditionally
- [ ] Tests pass
