# T16520: Finish when sharpening ends

## In plain words

Frame is the step where the parent crops around their athlete and pays to sharpen the result. Today the sharpened highlight (a finished short clip) waits on a "Your highlight is ready" panel, and it only reaches the Highlights tab, where it can be downloaded and shared, if the parent taps Finish while the browser is open. Of 72 exported highlights, 42 never got there: 12 parents left during the 3.5 minute wait, at least 12 saw the panel and none tapped Finish without spotlight, and nobody who came back later finished. We will have the server finish the highlight the moment sharpening ends, so it is in Highlights whether or not the parent is still there, and tell them so. Done when a highlight sharpened on staging with the browser closed is in Highlights on the next visit.

**Status:** TODO
**Impact:** 9
**Complexity:** 5
**Created:** 2026-11-14
**Updated:** 2026-11-14
**Milestone:** Automatic finish (see [EPIC.md](EPIC.md)). Task 2 of 4.

## How we got here

The panel was built as a holding place: watch the result, then finish it or redo it. The owner asked on 2026-11-14 how many parents redo from there and whether the step could be skipped. 13% of highlights were sharpened a second time, nearly all within 25 minutes, and finished highlights were held about 45 seconds before Finish was pressed ([evidence](../../bi/finish-step-evidence-2026-11-14.md)). The redo is worth keeping; the hold is not.

## The problem

Finishing depends on a tap that reads as optional, on a panel whose headline already says the highlight is ready, and on a browser that is often closed by the time the panel would appear. A parent who paid and left has a highlight they cannot find: Home lists it as "In progress".

## What we will do

1. When sharpening completes, the server finishes the highlight: it makes the shareable video and puts it in Highlights. No tap, and no open browser needed.
2. A parent still on the screen sees the result with the message that it is in their Highlights, and is offered Spotlight next, as now.
3. A parent who left sees it in Highlights on their next visit, with the "new" mark the tab already uses.
4. The waiting message stops inviting parents to go and mark more plays as if nothing were at stake; it says the highlight will be in Highlights when it is done.
5. The spotlight render also finishes on the server when it completes, so the second Finish tap goes too.
6. If the automatic finish fails, the highlight stays where it is today with a Finish button, and the failure is logged. The parent is never shown a highlight in Highlights that cannot play.

## Why this and not something else

- **Relabel the panel and add a Finish button to the Home tile.** Cheaper, and it would help parents who are present, but it does nothing for the 12 who left during the wait, and it keeps a tap that nobody uses to deliberate.
- **Email "your highlight is ready".** Useful, and the emails milestone can add it, but it sends a parent back to a screen that still needs the tap.
- **Finish in the browser automatically.** Still loses every closed tab.

## How we will know it worked

- [ ] On staging, start sharpening, close the browser, and return after it completes: the highlight is in Highlights and plays.
- [ ] Staying on the screen: when sharpening ends the parent is told the highlight is in Highlights, and Spotlight is offered.
- [ ] Rendering a spotlight replaces the finished video without a Finish tap, and a share link made before still plays.
- [ ] A forced failure of the automatic finish leaves the highlight in its old state with a working Finish button and a logged error.
- [ ] Credits are charged once for the sharpen, exactly as today.
- [ ] After release, finished out of sharpened on the admin Journey (T16510) is at least 95 of 100.

## For the implementer

### Relevant files
- `src/backend/app/services/export_worker.py` - framing completion; the server-side finish hangs off this.
- `src/backend/app/routers/export/overlay.py` - the no-keyframe synchronous render used by one-tap publish today.
- `src/backend/app/services/publish_final_video.py`, `src/backend/app/services/export_finalize.py` - single publish and finalize writers.
- `src/frontend/src/screens/FocusScreen.jsx` (`handlePublish`, `handleAddSpotlightLater`), `src/frontend/src/components/FocusPublishActionBar.jsx`, `src/frontend/src/screens/OverlayScreen.jsx`.
- `src/frontend/src/utils/handleOverlayExportCompletion.js`, `src/frontend/src/utils/startOverlayPublishRender.js`, `src/frontend/src/stores/publishIntentStore.js` - the browser-driven finish this replaces.
- `src/frontend/src/screens/focusCompletionOffer.js`, `src/frontend/src/utils/resumeFocusCompletion.js` - the ready panel and its return notice.
- `src/frontend/src/config/displayNames.js` - `FOCUS_PUBLISH`, `OVERLAY_PUBLISH`, guide strings `progressExport`, `ready`.

### Notes
- Knowledge docs: `export-pipeline.md` (publish_final_video, T9740, T10660), `persistence-sync.md` (a background writer must prove its copy is current), `guidance.md`.
- Tier L: the finish moves from a browser gesture to a server lifecycle operation. Architect design gate required; state how the server write obeys restore-if-newer.
- Publish archives the project and deletes working data today. T16530 needs the crop and spotlight to be editable afterwards; settle in design whether archive waits or re-edit restores (the re-edit path exists: `useReEditReel.js`).
- Sport-neutral strings; any sport wording goes in the per-sport strings.
