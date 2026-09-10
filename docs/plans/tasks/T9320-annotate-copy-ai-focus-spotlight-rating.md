# T9320: Annotate copy pass - AI Focus, Spotlight, rating intent

**Status:** WIP
**Impact:** 6
**Complexity:** 3
**Created:** 2026-09-09
**Updated:** 2026-09-09 (captions approved by the user; "reel" replaced with "clip from play")

## Problem

Four user-facing copy defects reported 2026-09-09 during an Annotate walkthrough. All four are
strings; none changes behavior.

1. **The empty-tab flow line is noise.** `EmptyTabGuide` prints `Step {n} of {FLOW_STEPS.length}:
   {label}` (`components/shared/EmptyTabGuide.jsx:154` and `:340`, both variants). The user's verdict:
   "not very meaningful or consistent". The numbered flow strip itself stays; only the "Step N of M"
   sentence goes.

2. **"Saved to your library." explains storage, not intent.** `getRatingCaption` /
   `getEditRatingCaption` (`components/shared/clipConstants.js:47-73`) answer a question the user did
   not ask. A first-time user picking a star has no idea they are rating the play's QUALITY. User
   directive: use that space to link the effect to the intent.

3. **"Focus" should be "AI Focus" everywhere** - the mode's value is that the reframing is automatic,
   and the current name does not say so.

4. **"Overlay" should be "Spotlight" in the mode nav** - the product already calls the feature a
   spotlight in every other string (`FOCUS_PUBLISH.ADD_SPOTLIGHT_LABEL`, `OVERLAY_PUBLISH`,
   `FOCUS_ADD_SPOTLIGHT_TOAST`, all in `config/displayNames.js`). The nav item is the last place
   still saying "Overlay" to the user.

## Solution

### Rename table (UI strings only)

| Surface | Was | Becomes |
|---------|-----|---------|
| Mode nav / breadcrumb (`stores/editorStore.js` `SCREENS.FRAMING.label`) | Focus | AI Focus |
| Mode nav (`SCREENS.OVERLAY.label`) | Overlay | Spotlight |
| `OVERLAY_PUBLISH.REAPPLY_FOCUS_LABEL` | Reapply Focus | Reapply AI Focus |
| `OVERLAY_PUBLISH.REAPPLY_OVERLAY_LABEL` | Reapply Overlay | Reapply Spotlight |
| `DraftTile.jsx:352` status label | Focus | AI Focus |
| `SegmentedProgressStrip` segment title | Focus | AI Focus |
| Mode-switch dialogs, toasts, export labels naming either mode | Focus / Overlay | AI Focus / Spotlight |
| `EmptyTabGuide` | `Step 3 of 4: Reels` | removed |

**Explicitly NOT renamed** (greppability + deep-link compat, same split T7700 already established
when Framing became Focus):

- URL paths `/focus` and `/overlay` (`MODE_PATHS`), and their legacy aliases.
- Store keys `EDITOR_MODES.FRAMING` / `EDITOR_MODES.OVERLAY`, `useFocusStore`, `useOverlayStore`,
  `isFramingMode()`, `isOverlayMode()`, component and file names.
- Analytics vocabulary: `framing_exported`, `overlay_exported`, `FLOW_EVENTS` keys, admin column
  ids. The admin panel's own labels are out of scope for this task (T8230 owns the admin
  Focus/Overlay split).
- `ProjectManager.jsx:1826`'s `'Focus Started'` filter option label - admin surface, see above.

Sweep method: grep the frontend for `Focus` / `Overlay` inside JSX text nodes, `title=`, `label:`,
and the `displayNames.js` / `editorStore.js` constant blocks. Skip `onFocus`, `autoFocus`,
`.focus()`, `focus:` Tailwind variants, `focusStore`, `focus-visible`.

### Rating caption rewrite

`RATING_ADJECTIVES` and `RATING_NOTATION` (`clipConstants.js:9-24`) already carry a chess-style
quality vocabulary, and it is the same vocabulary `generateClipName` uses to auto-name the clip
("Brilliants Dribble"). The new captions reuse it so the caption and the clip name explain each
other.

| Rating | Was | Becomes |
|--------|-----|---------|
| none | `1-5: how big was this play? 5 starts a reel automatically.` | `How good was this play? Rate it 1 to 5 - five stars creates a clip from the play.` |
| 1 | `Saved to your library.` | `Mental lapse (??) - a play to learn from.` |
| 2 | `Saved to your library.` | `Technical lapse (?) - a play to learn from.` |
| 3 | `Saved to your library.` | `Interesting play (!?) - worth a second look.` |
| 4 | `Big play (!) - saved to your library.` | `Good play (!) - one more star creates a clip.` |
| 5, My Athlete | `Can't-miss play (!!) - reel will be created.` | `Brilliant play (!!) - clip will be created from play.` |
| 5, Team | `Can't-miss team play (!!) - team clips don't start reels.` | `Brilliant team play (!!) - team plays don't create clips.` |

**Vocabulary rule, user directive 2026-09-09: these captions never say "reel".** What a five-star
play produces is a CLIP, and the phrase the user chose is "clip will be created from play". This is
the T8130 naming table applied correctly - a play is the annotation, a clip is the single-play draft
it produces, and "Highlight Reel" is reserved for the published multi-clip noun.

**Consequence to reconcile in the same task:** `ClipDetailsEditor.jsx:394-445` labels the adjacent
control `Reel` and its button `Create Reel` / `Reel Created`, sitting directly under a caption that
now says "clip". Rename that control's label to `Clip` and its buttons to `Create Clip` /
`Clip Created` so the two lines agree. Same reasoning, same T8130 table. Note this ALSO touches
`ClipDetailsEditor.reel.test.jsx`, and coordinate with T9330, which replaces the stage branches of
that same control.

`getEditRatingCaption`'s edit-mode 5-star variants keep their `hasReel` branch, reworded to match
(`Brilliant play (!!) - clip already created from play.` / `Brilliant play (!!) - create a clip below.`).

Notation symbols come from `RATING_NOTATION`, never hardcoded - the existing captions already
interpolate it and that stays.

## Files

- `src/frontend/src/components/shared/EmptyTabGuide.jsx` - drop the Step line in both variants
- `src/frontend/src/components/shared/clipConstants.js` - both caption functions
- `src/frontend/src/stores/editorStore.js` - `SCREENS` labels
- `src/frontend/src/config/displayNames.js` - `OVERLAY_PUBLISH` reapply labels
- `src/frontend/src/components/DraftTile.jsx`, `components/shared/SegmentedProgressStrip.jsx`
- `src/frontend/src/modes/annotate/components/ClipDetailsEditor.jsx` - the Reel control's label and buttons
- plus whatever the grep sweep turns up in mode-switch dialogs / toasts

## Tests

Relevant set (~10), curated:

- `components/shared/clipConstants.test.js` - both caption functions, every branch
- `components/shared/EmptyTabGuide.test.jsx` - the two `Step 3 of 4: Reels` assertions must be
  replaced with an assertion that the line is ABSENT (do not just delete them)
- `modes/annotate/components/AnnotateFullscreenOverlay.layer.test.jsx` - asserts the caption text
- `components/DraftTile.test.jsx` - asserts the `Focus` status label
- `components/SegmentedProgressStrip.test.jsx` - asserts segment titles by name
- `components/ExportButtonView.test.jsx` - asserts a Focus CTA label
- `components/OverlayPublishActionBar.test.jsx` - reapply labels
- the e2e spec covering the mode nav, if one asserts the nav text

## Notes

- Tier M, frontend only, no schema change, no persistence change.
- ASCII only in all new copy (no em dashes) - CF Pages rejects non-ASCII in commit messages and the
  project style guide bans em dashes in shipped copy.
- Sequence AGAINST T9330: T9330 introduces the "Apply AI Focus" CTA and must use the same words.
  Whichever lands second reconciles rather than overwrites.
