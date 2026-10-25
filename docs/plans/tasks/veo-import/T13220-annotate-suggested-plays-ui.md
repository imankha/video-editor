# T13220: Annotate: import a Veo zip as suggested plays

**Status:** WIP
**Impact:** 7
**Complexity:** 5
**Tier:** L (frontend, new Annotate surface; ui-designer for the list, timeline ticks and sheet)
**Created:** 2026-10-18
**Updated:** 2026-10-18 (user amendment: one-tap rate-to-keep on the same screen)
**Epic:** [Veo Highlights Import](EPIC.md) (Path A). Depends on T13200, T13210.

## Problem

A parent with the full Veo game in Annotate has to scrub 90 minutes to find moments Veo already
found, timestamped to the second, in the zip they downloaded.

## Solution

1. **Entry:** in Annotate, the Add footage area gets "Import Veo highlights (.zip)" (exact copy per
   V5); the game kebab gets the same row. File picker accepts `.zip` and loose Veo mp4s.
2. **Import sheet** (no backdrop close): reads the zip with T13200 in a worker with a progress bar
   ("Reading 41 highlights..."), shows "35 moments: 4 goals, 27 shots, 3 attacks, 1 highlight", asks which video
   the stamps belong to when the game has 2+ videos (V6), preselecting the one matching the zip name's
   `(1st Half)` / `(2nd Half)` marker, then **Import** (one gesture -> one POST).
3. **Alignment check:** after import, seek to the first suggestion; card: "Does the play start here?"
   with -1 s / +1 s / Looks right. Nudges call the Shift endpoint. A "Remove import" row undoes it.
4. **Timeline:** suggestion ticks on the Annotate timeline in a color distinct from plays (ui-designer;
   respect the guide system and reduced motion). Tapping a tick seeks there.
5. **Suggested plays list with rate-to-keep** (user amendment 2026-10-18: making a play and rating
   it must be very simple, on the same screen, with no switching cost). Filter chips by label
   (Goal 4, Shot on goal 27...) and open/kept/dismissed. Row = label, `mm:ss`, duration.
   - Tap a row: the Annotate video seeks to it and plays; the row expands IN PLACE into a compact
     play form, the same fields the play editor has, never a different screen:
     - **Rating:** the existing `PlayRatingRow` (reuse as-is; presentational, `onRatingChange` is the caller's write).
     - **Name:** a text field prefilled "{Label} {mm:ss}" (V3), editable.
     - **Tags + Notes:** the existing `DetailsFields` (T9830, already shared by three Annotate surfaces:
       `TagSelector` chips with the Goal tag preselected for a Goal suggestion, Notes prefilled
       "Veo: {labels}"). Visible without an extra "details" tap.
     - **Not my player** (dismiss).
     Only one row is expanded at a time.
   - **Before keeping**, name/tag/notes edits are an in-memory draft for that row (no write: the play
     does not exist yet).
   - **Tap a rating cell = make it a play.** One gesture, one save carrying `[start, end]`, the rating
     AND the row's current name, tags and notes (combined endpoint, T13210). No play editor, no modal,
     no navigation.
   - **After keeping, the row STAYS expanded** (user amendment 2026-10-18: "edit the name or notes or
     add/edit tags easily"): its header reads "Play · {rating word}", and rating, name, tags and notes
     stay editable in place. Each edit is its own surgical write through the existing play update path
     (`PUT /api/clips/raw/{id}` with only the changed field): tag toggle = one write, name/notes commit
     on blur or Enter, Escape reverts (the `onTextFieldKeyDown` rule DetailsFields already follows).
   - **Moving on is the parent's choice, never automatic:** a **Next** button on the expanded row
     (and Down / `n` while the list has focus) collapses it and expands + seeks the next open
     suggestion. Tapping any other row does the same. Reduced motion: seek without autoplay.
   - Kept rows can be re-expanded at any time to change rating or details.
   - Undo toast after keep (deletes the play, reopens the suggestion) and after dismiss.
   - "Edit play" on a kept row opens the normal play editor for trim/details: optional, never required.
   - The list and Annotate's own Mark play controls stay on screen together; the list never hides the
     player on desktop (side panel) and on phone sits below the player as a scrollable sheet that keeps
     the video visible (ui-designer lays out both).
   - Keyboard (only while the list has focus, never while a text field has it; check for clashes with
     Annotate's existing shortcuts first): Up/Down moves between suggestions, 1-5 rates (= keep), X dismisses.
6. Guide: add a guide entry for the list per `.claude/knowledge/guidance.md` (scope with the guide owner).

## Acceptance

1. Real-browser e2e on dev with a small synthetic Veo zip built from the Rebels manifest: import ->
   35 rows -> tap the 14:43 goal -> tap rating 5 -> exactly one save request, play exists at the
   right time with tag Goal and rating 5, the URL/screen did not change, the next suggestion is
   expanded -> reload -> kept/dismissed state persists.
2. Rate-to-keep is a single tap from an expanded row (test counts clicks and asserts no route change
   and no play-editor mount).
3. Edit before keeping: rename to "Nice finish", add tag Dribble, then tap rating 4 -> exactly one save
   request carrying name, tags [Goal, Dribble], notes and rating 4.
4. Edit after keeping: the row stays expanded; toggling a tag sends one request with only `tags`;
   editing the name sends one request with only `name` on blur; Escape reverts without a request.
5. Nothing auto-advances after a rating; Next moves to the next open suggestion.
6. No network request to anything except our API during import (asserted in e2e; T2680 rule).
7. Every write traces to a gesture (reviewer checks; no effect-driven writes).
8. Phone (390) and desktop (1440) screenshots of the sheet, list and ticks.

## Knowledge docs
`.claude/knowledge/annotate.md`, `.claude/knowledge/guidance.md`.
