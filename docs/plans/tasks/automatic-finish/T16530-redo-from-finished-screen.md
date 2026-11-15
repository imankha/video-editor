# T16530: Redo from the Finished screen

## In plain words

Finished is the screen that shows a highlight (a finished short clip) once it is in the Highlights tab. Today the choices to redo a highlight live on the "Your highlight is ready" panel that comes before Finish: Edit zoom, which reopens the crop and costs credits to sharpen again, and Add or Redo spotlight, which is free. They are used: 9 of 68 highlights were sharpened a second time and 11 of 37 spotlights were rendered again, nearly all within minutes. Once highlights finish on their own (T16520) that panel is no longer a stop, so the choices need a home. We will put Edit zoom and Add or Redo spotlight on the Finished screen, and make the Home tile of a finished highlight open that screen. Done when a parent can change the crop or the spotlight of a finished highlight on a phone and the new version replaces the old one in Highlights.

**Status:** TODO
**Impact:** 8
**Complexity:** 5
**Created:** 2026-11-14
**Updated:** 2026-11-14
**Milestone:** Automatic finish (see [EPIC.md](EPIC.md)). Task 3 of 4.

## How we got here

Frame is the step where the parent crops around their athlete and pays to sharpen the result; Spotlight draws a circle around their athlete. The holding panel existed so a parent could watch the result and redo it before it counted as finished. The 2026-11-14 read of production ([evidence](../../bi/finish-step-evidence-2026-11-14.md)) showed parents do redo, but straight away, and that only 2 highlights were ever edited again after finishing.

## The problem

With T16520 alone, a parent who dislikes the result has a finished highlight and no obvious way to fix it. And on Home today, tapping a sharpened highlight opens the Spotlight editor, where the only main button is "Add spotlight to highlight" and nothing says how to get the video out.

## What we will do

1. The Finished screen gains two choices beside Download and Share: Add spotlight (Redo spotlight when one exists) and Edit zoom, with the same captions as today, including that sharpening again uses credits.
2. A redo replaces the highlight in place. Its name, its place in Highlights and any share link stay.
3. While a redo is rendering, the old version stays watchable and shareable.
4. On Home, a finished highlight appears under Highlights only, and tapping it opens the Finished screen.
5. The ready panel's close button moves out from under the Guidance switch on a phone, on whatever remains of that panel.

## Why this and not something else

Keeping the redo choices only on the panel shown at the end of sharpening would lose them for anyone who left during the wait, which is 12 of the 31 stranded highlights. Putting them on the Finished screen gives one place for everything a parent does with a highlight, which is also where the Finished screen hub (T15810) puts Download, Share and Make the next play.

## How we will know it worked

- [ ] On a phone and on desktop, the Finished screen shows Add or Redo spotlight and Edit zoom, each reachable without scrolling past the video.
- [ ] Redoing the spotlight replaces the video in Highlights at no credit cost; a share link made before the redo plays the new version.
- [ ] Edit zoom states the credit cost before the parent commits, and a second sharpen replaces the video.
- [ ] During a redo the previous version still plays.
- [ ] A finished highlight no longer appears under Plays as "In progress".

## For the implementer

### Relevant files
- `src/frontend/src/components/DraftReelPreview.jsx`, `src/frontend/src/components/collections/CollectionPlayer.jsx`, `src/frontend/src/components/collections/JustPublishedCard.jsx` - the Finished viewer and its actions.
- `src/frontend/src/hooks/useReEditReel.js` - existing re-edit path (restore for edit).
- `src/backend/app/routers/downloads.py` - publish and restore-for-edit endpoints.
- `src/frontend/src/components/DraftTile.jsx`, `src/frontend/src/utils/draftStage.js`, `src/frontend/src/modes/annotate/clipStage.js` - Home tile status and where a tap lands.
- `src/frontend/src/components/FocusPublishActionBar.jsx` and the Overlay action bar - the choices being moved.

### Notes
- Knowledge docs: `export-pipeline.md` (restore, stale_share, T4390), `guidance.md`.
- Design review required before build (two new actions on a phone-width Finished screen; coordinate with T15810 if it has landed).
- Restore-for-edit unpublishes today. In design, decide how a redo keeps the published version live until the replacement is ready (criterion 4 requires it).
- Sport-neutral strings.
