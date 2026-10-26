# T13247: Take Veo zips through the normal upload, drop the separate "Import Veo highlights" button

**Status:** TODO
**Impact:** 4
**Complexity:** 2
**Tier:** M (frontend only, ~5 files, mostly copy + one deletion)
**Created:** 2026-10-26
**Epic:** [Veo Highlights Import](EPIC.md). Amends T13220's entry point; builds on T13240's routing.

## Problem (user request 2026-10-26)

Annotate shows a fifth action card, **"Import Veo highlights (.zip)"**, under Mark play / Review
plays / Share plays / Add footage. The user does not want a dedicated button: uploading should
simply accept a zip of clips, and the upload's own text should say so.

Most of the plumbing already exists:

- Annotate's **Add footage** (`AddFootageButton` -> `GameFootagePicker` with `onVeoZip`) already
  accepts `.zip` and hands a Veo zip to `suggested.openZip`, the same import sheet the dedicated
  card opens (T13240). So the card is a duplicate entry.
- **Upload game** (`GameDetailsModal` -> picker with `onVeoZip`) and **Add Clip**
  (`ProjectManager` `clip-upload-input`, `accept="video/*,.zip,application/zip"`) also take zips.
- But none of their text mentions a zip: the picker says "Drop any game video here." /
  "Drop footage to add to this game." and "MP4, MOV, or WebM"; the Annotate card says "Add another
  video to this game." A parent has no way to know the zip goes there, which is why the extra
  button looked necessary.

## Solution

1. **Delete the card.** Remove `<VeoImportEntry .../>` from
   [AnnotateModeView.jsx](../../../../src/frontend/src/modes/AnnotateModeView.jsx) (~line 1362),
   delete `modes/annotate/components/VeoImportEntry.jsx`, and drop `VEO_SUGGESTIONS.ENTRY_TITLE` /
   `ENTRY_DESCRIPTION` from `config/displayNames.js`. Grep `src/`, `src/frontend/e2e/`, `scripts/`
   for `veo-import-entry`, `veo-import-input`, `VeoImportEntry` (2026-10-26: no hits outside those
   three files). The action grid goes back to four cards.
2. **Say "zip" wherever a zip is accepted** (only when the intake actually takes one, i.e. the picker
   got `onVeoZip`; the plain video-only uses keep today's text). Literals stay in the existing
   `COPY` objects / `displayNames.js`, next to use:

| Surface | Today | New |
|---|---|---|
| Annotate Add footage card description (`AddFootageButton` card variant) | Add another video to this game. | Add another video, or a Veo highlights .zip. |
| Add footage modal drop target (`COPY.dropTarget`) | Drop your footage here. We'll place it by when it was filmed. | Drop footage or a Veo highlights .zip here. |
| Picker formats line (`GameFootagePicker` `COPY.formats`), zip-accepting mode | MP4, MOV, or WebM | MP4, MOV, WebM, or a .zip of Veo highlight clips |
| Picker phone sub-line (`COPY.mobileSub`), zip-accepting mode | Tap to choose videos - pick as many as you want | Tap to choose videos or a highlights .zip |
| Add Clip consequence notice / picker (`ProjectManager`, T8380 notice) | (video only) | add one line: "You can also pick a Veo highlights .zip." |

   Copy rule: name **Veo**, because only Veo highlights zips are read; any other zip still gets
   "Only Veo highlights zips are supported." A generic "a .zip of clips" would promise something we
   reject. (If the user prefers the generic wording, that is a separate feature: reading any zip of
   videos as plain clips, not in scope here.) No em dashes in copy.
3. **Keep the disabled rules honest.** The old card was disabled when `isSourceExpired || isPlaysOnly`;
   Add footage uses `addFootage.disabled`. Check that a zip cannot reach `openZip` in a state the old
   card blocked (expired source, plays-only game); if it can, gate the zip branch in
   `AddFootageButton.handleVeoZip` with the same condition and show the picker's error line instead
   of opening the sheet. Do not disable the whole Add footage card for it.
4. **T13240 fallback text.** T13240 says a game with no or misspelled opponent "is still reachable
   from its own Annotate Import Veo highlights (.zip)". After this task that path is: open the game,
   Add footage, pick the zip (it already routes to this game's sheet, no opponent match needed).
   Update that sentence in T13240 and in EPIC.md's entry-point table.

## Acceptance

1. Annotate (no play selected) shows four cards; no "Import Veo highlights" card at 390, 768, 1440.
2. Annotate -> Add footage -> pick a Veo highlights zip -> the T13220 import sheet opens for this
   game (same as the old card). Drag-dropping the zip onto Annotate does the same.
3. The Add footage card, its modal drop target and the picker formats line mention the Veo
   highlights .zip; Upload game and Add Clip do too. Video-only uses of the picker are unchanged.
4. A non-Veo zip on any of these still shows "Only Veo highlights zips are supported." (no dead end).
5. Expired-source / plays-only game: a zip through Add footage does not open the import sheet
   (step 3), matching what the old card allowed.

## Tests

- Unit: `AddFootageButton` / `GameFootagePicker` render the zip copy only when `onVeoZip` is set;
  `AnnotateModeView` no longer renders `veo-import-entry`. Red first: assert the new copy and the
  card's absence against current master.
- Existing T13240 routing tests stay green (named set: the T13240 + T13220 test files, the
  picker test, the AddFootageButton test).
- Live check at 390 and 1440: screenshot of the four-card grid and the Add footage modal text.

## Knowledge docs
`.claude/knowledge/annotate.md` (Annotate action cards, upload intake).
