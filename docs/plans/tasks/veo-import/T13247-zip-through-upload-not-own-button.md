# T13247: Upload accepts any zip of clips; drop the separate "Import Veo highlights" button

**Status:** TODO
**Impact:** 5
**Complexity:** 4
**Tier:** M (frontend only, ~6 files: one deletion, copy, one shared zip-to-files step)
**Created:** 2026-10-26
**Updated:** 2026-10-26 (user: wording and behavior generic, "if it's just a zip of clips that is what we should say")
**Epic:** [Veo Highlights Import](EPIC.md). Amends T13220's entry point; builds on T13240's routing.

## Problem (user request 2026-10-26)

Annotate shows a fifth action card, **"Import Veo highlights (.zip)"**, under Mark play / Review
plays / Share plays / Add footage. The user does not want a dedicated button: uploading should
simply accept a zip of clips, and the upload's own text should say so in generic terms. Not "Veo".

Today:

- Annotate's **Add footage** (`AddFootageButton` -> `GameFootagePicker` with `onVeoZip`),
  **Upload game** (`GameDetailsModal` -> picker with `onVeoZip`) and **Add Clip** (`ProjectManager`
  `clip-upload-input`) accept `.zip`, but only a **Veo highlights** zip is understood. Any other zip
  ends in "Only Veo highlights zips are supported." (`VEO_ROUTING` / `VEO_SUGGESTIONS.NOT_VEO`).
- None of their text mentions a zip: "Drop any game video here." / "Drop footage to add to this
  game." / "MP4, MOV, or WebM" / "Add another video to this game."
- The dedicated card duplicates Add footage's existing Veo path (T13240 already hands a Veo zip
  dropped on Add footage to the same import sheet).

## Solution

### 1. Delete the card
Remove `<VeoImportEntry .../>` from
[AnnotateModeView.jsx](../../../../src/frontend/src/modes/AnnotateModeView.jsx) (~line 1362),
delete `modes/annotate/components/VeoImportEntry.jsx`, drop `VEO_SUGGESTIONS.ENTRY_TITLE` /
`ENTRY_DESCRIPTION`. Grep `src/`, `src/frontend/e2e/`, `scripts/` for `veo-import-entry`,
`veo-import-input`, `VeoImportEntry` (2026-10-26: no hits outside those three files). The grid goes
back to four cards.

### 2. Any zip of clips is accepted (new)
One shared step at every zip-accepting intake, before today's routing:

```
zip picked/dropped
  -> readZipEntries(zip)
  -> isVeoHighlightsZip(entries)?  yes -> today's Veo path, unchanged (T13240 / T13220 / T13230 / T13245)
                                   no  -> video entries (.mp4 .mov .m4v .webm, skip __MACOSX/, dotfiles, folders)
                                          none -> "This zip has no videos in it." (picker error line, no dead end)
                                          some -> extractEntry each, ONE AT A TIME, into File objects with the
                                                  entry's base name, and hand them to the intake exactly as if the
                                                  user had picked those files loose
```

- Add footage: the extracted files go into the picker as footage for this game (placement by
  recorded time, as for loose files).
- Upload game: they become the new game's videos (same as picking several videos).
- Add Clip: they become clips via the existing T8370 batch upload.
- Put the helper next to the existing zip code (e.g. `utils/zipClips.js` using `readZipEntries` /
  `extractEntry` from `utils/veoHighlights/zipReader.js`); move `zipReader.js` up to `utils/` only if
  that reads better, as a separate mechanical commit.
- Memory: `extractEntry` inflates a whole entry into a Blob. Keep it one entry at a time, as T13230
  does. If an entry is larger than a cap the worker measures (start from 2 GB), skip it with a named
  line ("{name} is too big to unzip here, upload it on its own"), never a silent drop.
- A zip mixed with loose files in one pick: unzip and merge into the same batch.

### 3. Generic copy wherever a zip is accepted
Only where the intake takes a zip; video-only uses of the picker keep today's text. Literals in the
existing `COPY` objects / `displayNames.js`, next to use. No em dashes, no "Veo".

| Surface | Today | New |
|---|---|---|
| Annotate Add footage card description (`AddFootageButton` card variant) | Add another video to this game. | Add another video or a zip of clips. |
| Add footage modal drop target (`COPY.dropTarget`) | Drop your footage here. We'll place it by when it was filmed. | Drop videos or a zip of clips here. We'll place them by when they were filmed. |
| Picker formats line (`GameFootagePicker` `COPY.formats`), zip mode | MP4, MOV, or WebM | MP4, MOV, WebM, or a zip of clips |
| Picker phone sub-line (`COPY.mobileSub`), zip mode | Tap to choose videos - pick as many as you want | Tap to choose videos or a zip of clips |
| Add Clip notice / picker (`ProjectManager`, T8380 notice) | (videos only) | Pick videos or a zip of clips. |
| Error, non-video zip | Only Veo highlights zips are supported. | This zip has no videos in it. |

A Veo zip still gets its smarter handling (suggested plays, names, tags); the copy just doesn't
advertise it by brand.

### 4. Keep the old card's disabled rules
The old card was disabled when `isSourceExpired || isPlaysOnly`; Add footage uses
`addFootage.disabled`. A Veo zip through Add footage must not open the import sheet in a state the
card blocked: gate `AddFootageButton.handleVeoZip` with the same condition and show the picker's
error line. Do not disable the whole Add footage card for it.

### 5. Docs
T13240 says a game with no or misspelled opponent "is still reachable from its own Annotate Import
Veo highlights (.zip)". Now: open the game, Add footage, pick the zip. Update that sentence in
T13240 and EPIC.md's entry-point table; note the generic-zip path in EPIC.md and
`.claude/knowledge/annotate.md`.

## Acceptance

1. Annotate (no play selected) shows four cards; no "Import Veo highlights" card at 390, 768, 1440.
2. Annotate -> Add footage -> a Veo highlights zip -> the T13220 import sheet opens for this game
   (same as the old card). Drag-dropping it onto Annotate does the same.
3. A plain zip of 3 phone clips (not Veo):
   - Add footage: the 3 videos are added to this game.
   - Upload game: a game with those 3 videos is created.
   - Add Clip: 3 clips are uploaded.
4. A zip with no videos (e.g. only photos) shows "This zip has no videos in it." and the picker stays
   usable.
5. All zip-accepting surfaces say "zip of clips" per the table; none says "Veo"; video-only pickers
   are unchanged.
6. Expired-source / plays-only game: a Veo zip through Add footage does not open the import sheet.

## Tests

- Unit (red first against master): the zip helper (Veo zip -> Veo path; plain zip -> File list with
  base names, junk skipped; empty -> error); picker/AddFootageButton render the generic copy only
  with zip mode on; `AnnotateModeView` no longer renders `veo-import-entry`.
- Regression set: T13240 routing tests, T13220 import sheet test, T13230 pick list test, the
  picker and AddFootageButton tests.
- Fixture: build a small plain zip of 2-3 short mp4s in the test (no binary checked in), plus the
  existing Veo fixtures.
- Live check at 390 and 1440: the four-card grid, Add footage modal text, a plain zip added to a game.

## Knowledge docs
`.claude/knowledge/annotate.md` (Annotate action cards, upload intake).
