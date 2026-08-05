# T6510: Rename "Cover photo" to "Preview image" and say what it is for

**Status:** TODO
**Impact:** 4 | **Complexity:** 1
**Follows:** T5410 (cover photo / poster marker)

## Problem

User, 2026-08-04:

> I'm not sure "Cover Photo" is a good name for the photo we use as the link poster. Maybe something
> like "preview image" and roll over text saying this image will show up as a preview image.

"Cover photo" reads like an album cover — something decorative inside the app. Its actual job is the
**link preview**: the still that appears when a share link is unfurled in a message, a feed, or a
chat. The name does not tell the user that, so they cannot tell why it matters or where it shows up.

## Scope

- Rename the user-facing label to **"Preview image"** everywhere it appears.
- Add hover/tooltip copy explaining the consequence, e.g. *"This image is what people see when you
  share the link."* Say where it appears, not what it is.
- Rename the poster marker's `aria-label` and its tooltip copy to match — a screen-reader label
  saying "Cover photo marker" while the visible label says something else is worse than either.

## Boundaries
- **Label only, no data change.** The stored field, R2 keys, API shape and the poster-selection logic
  keep their existing names. This is copy, not a migration.
- Per the project rule that derived names are frozen at publish: renaming a LABEL is safe precisely
  because nothing downstream reads it.
- Check for the old wording in any tutorial/marketing copy before declaring it done — a renamed
  control with a tutorial video still calling it "cover photo" is a new inconsistency.

## Relevant files
- `src/frontend/src/components/OverlaySettingsCard.jsx:216-220` — the label and its comment
- `src/frontend/src/modes/overlay/layers/PosterMarkerLayer.jsx:128,138` — marker tooltip + `aria-label`
- `.claude/references/ui-style-guide.md` — copy conventions

## Classification hint
S-tier, frontend-only, no schema change. Fix directly; targeted test + commit.

## Acceptance criteria
- [ ] No user-facing "Cover photo" wording remains, including the `aria-label` and marker tooltip.
- [ ] Hover copy states where the image appears (the share link preview), in plain language.
- [ ] No stored field, API key or R2 key was renamed.
- [ ] Existing poster tests still pass; a test pins the new label so it cannot silently revert.
