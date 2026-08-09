# T6510: "Preview image" — rename it, and make it a frame choice, not an upload

**Status:** TODO
**Impact:** 6 | **Complexity:** 3
**Follows:** T5410 (cover photo / poster marker), [T5225](overlay-text/T5225-overlay-text-layer.md)

## Problem

Two pieces of user feedback, 2026-08-04/05, about the same control. They are filed together because
they touch the same component and splitting them means two passes over the same UI.

### A. The name does not say what it does

> I'm not sure "Cover Photo" is a good name for the photo we use as the link poster. Maybe something
> like "preview image" and roll over text saying this image will show up as a preview image.

"Cover photo" reads like an album cover — something decorative inside the app. Its actual job is the
**link preview**: the still shown when a share link is unfurled in a message, a feed or a chat. The
name never tells the user that, so they cannot tell why it matters.

### B. It should be a frame choice, not an upload

> For the preview image in overlay, I don't want the user to be able to upload, they just have to
> choose one of the frames. We should default to one, we should also show them the one we selected,
> they should be able to change it.

The desired model is: **the preview image is always a frame from the reel.** The app picks a sensible
default, shows the user which frame it picked, and lets them move the choice. Uploading an arbitrary
image is removed.

This is the better model for the same reason the poster marker exists — a preview still that is
genuinely from the reel cannot misrepresent the video, and there is no second asset to store, size,
moderate or keep in sync.

## Scope

### Rename (A)
- User-facing label becomes **"Preview image"** everywhere.
- Hover/tooltip copy states the consequence: *"This image is what people see when you share the link."*
  Say where it appears, not what it is.
- The poster marker's `aria-label` and tooltip must match — a screen reader saying "Cover photo
  marker" against a different visible label is worse than either alone.

### Frame-only selection (B)
- **Remove the upload affordance** from the overlay preview-image UI.
- **Always have a default.** The existing auto/marker selection already computes one — make sure it
  is always resolved, never "none".
- **Show the chosen frame.** The user must be able to see the actual still that will be used, not
  just a marker position on a timeline.
- **Make changing it easy** — moving the marker is the existing gesture; confirm it reads as "this
  is the frame" and updates the shown still.

## The part that needs a decision — existing uploads

`poster_source === 'upload'` is a real, shipped state (`/overlay-data` returns `poster_source` +
`poster_filename`; `OverlayScreen` hydrates "Custom image in use" from it). Removing the feature
leaves those reels behind. Decide and state:

- Do existing uploaded posters keep working (grandfathered, read-only, no way to set a new one), or
- are they migrated to a frame choice (and if so, which frame — the marker default?), or
- are they dropped?

**Grandfathering is the likely right answer** — it removes the entry point without invalidating a
poster a user already chose — but it means the upload READ path must survive even though the WRITE
path is gone. Say so explicitly in the code, or the next reader will delete it as dead.

Check whether any share/unfurl path assumes an upload can exist before changing the write side.

## Boundaries
- The rename is **label-only**: no stored field, API key or R2 key is renamed. Frozen derived names
  stay frozen.
- The frame-only change IS behavioural and touches persistence — treat it as the real work.
- Check tutorial/marketing copy for the old wording; a renamed control with a tutorial still saying
  "cover photo" is a new inconsistency.

## Relevant files
- `src/frontend/src/components/OverlaySettingsCard.jsx:216-220` — label + the cover-photo block
- `src/frontend/src/modes/overlay/layers/PosterMarkerLayer.jsx:128,138` — marker tooltip + `aria-label`
- `src/frontend/src/screens/OverlayScreen.jsx` — `posterUploadedFilename` hydration from `poster_source`
- `src/backend/app/routers/export/overlay.py` — `/overlay-data` poster fields; poster generation
- `src/backend/app/services/poster.py` — marker/auto frame resolution
- `.claude/knowledge/export-pipeline.md` § poster

## Classification hint
M-tier. Frontend + Backend. No migration expected (grandfathering reads an existing column). Reviewer
required. Real-browser verification — this is visual selection behaviour.

## Acceptance criteria
- [ ] No user-facing "Cover photo" wording remains, including `aria-label` and marker tooltip.
- [ ] Hover copy states where the image appears (the share link preview), in plain language.
- [ ] The upload entry point is gone from the overlay preview-image UI.
- [ ] A preview frame is ALWAYS resolved — there is no "none" state.
- [ ] The user can SEE the selected frame, not just a marker position.
- [ ] Changing the selection updates the shown frame immediately.
- [ ] The decision on existing `poster_source === 'upload'` reels is implemented and documented; if
      grandfathered, the surviving read path is commented so it is not deleted as dead code.
- [ ] No stored field, API key or R2 key was renamed.
- [ ] Share/unfurl still produces a correct preview for both a frame-chosen reel and (if kept) a
      legacy uploaded one.
