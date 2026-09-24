# Highlight-First Annotate Flow

**Status:** TODO (WAITING ON USER: decision artifact + badge/flow mockups, round 2)
**Started:** 2026-09-24
**Impact:** 9 **Complexity:** 6 **Priority:** 1.5
**Sibling epic:** [Single-Clip Editor, Reels removed](../single-clip-editor/EPIC.md) (ships in the same version)
**Decision artifact:** https://claude.ai/artifact/CWHnjGEUCzqMhgeyQGrzwB (answers in its `answers` db collection)
**Mockups:** https://claude.ai/artifact/FFGqtZQnE4a9n9PHjANaeA

## Goal

User's words (2026-09-24): "The point is to get users intuitively making highlights."

Today a parent marks a play, optionally rates it, and then has to discover a separate
"Create clip" / "Frame" / "Frame Now" / "Frame Later" control to turn it into something. The
new flow makes the RATING the gesture.

### Owner rulings (2026-09-24, round 2 feedback)

1. **The rating acts required but never says "Required".** No required tags or to-do styling.
   Pressing Done without a rating opens a **"Rate this play" modal** listing each rating with a
   one-line meaning; picking one sets it and continues the Done.
2. The 5-star adjective **"Brilliant" becomes "Highlight"**, and **Highlight's color is gold**
   (not teal, not light blue).
3. **Done on a Highlight-rated play** opens a popup with two choices:
   - **Make Highlight Now** = old Frame Now (create it, open Frame Highlight).
   - **Highlight Later** = old Frame Later (create it, stay in Annotate). Toast, exact text:
     **"Highlight moved to clips so you can edit it later"**.
4. **The word "clip" leaves the UI entirely.** That toast is the only place it appears.
5. **Play editor hierarchy:** (1) start/end time, (2) Name and Rating, (3) a "Details"
   disclosure holding tags and notes.
6. Mode bar: **Annotate / Frame Highlight / Add Spotlight**; the last two are clickable only once
   the highlight exists.

### Owner rulings (2026-09-24, round 3)

Recorded on the decision artifact (every question answered, with notes). Beyond "agree with all
recommendations":

- **Palette P2** and **editor layout A2** approved.
- **Rate modal** appears ONLY if the play was not rated while editing it. Highlight's meaning
  line is exactly **"Brilliant Play! Everyone should see it."**
- **Highlight popup** second option is now **"Back to Editing"** with subtext **"Saves play in
  clips so you can make your highlight later"** (replaces "Highlight Later"; it still creates
  the saved item). New presentation options requested (mockups round 3).
- **Mode bar:** Frame Highlight / Add Spotlight open a new screen, so desktop hover text on
  locked tabs is fine, but no static text under the tabs. New mobile options requested.
- **Team plays can become highlights** (H13 = b). Task T11160.
- **Port previous "Brilliants" to Highlight** (H10 = b): the rating is an integer, but derived
  names like "Brilliant Goal" were persisted; migration scope in T11110.
- **No more quests** (H11): remove the whole quest system, keep only what a future opt-in
  Guided mode needs. Task T11170.
- **Any unsupported link goes Home** (R6), not just old Reels links (T11230).

### Owner rulings (2026-09-24, round 4)

- **Popup presentation B3**: the editor swaps in place to a gold choice card.
- **Back to Editing closes the editor** and returns to marking plays (M2); toast "Highlight
  moved to Clips so you can edit it later" confirms (M3, follows from M2).
- **"Clips" capitalized** in the owner-written strings (M4).
- **Escape is the only no-save exit** from the choice card (M5, ui-designer's call as delegated).
- Still open on the artifact: M6 (rename the rate modal's exit to "Keep editing"), M7 (mobile
  locked-tab tap: D2 toast vs D3 shake), QB1-QB2 (other old "Brilliant" names), T1-T5 (team
  highlight downstream), G1-G6 (quest removal).

## Vocabulary conflict (confirmed by the owner's round-2 wording, see H1)

This **reverses the 2026-09-13 ruling** in PLAN.md ("Clip and Reel both stand. 'Highlight' is a
MODIFIER, not a third object") and renames the mode noun "Framing" chosen the same day. Round 2
("remove the word Clip entirely, that's no longer a part of the mental model") settles the
direction: the parent-facing object is a **highlight**. Open: whether the Home "Clips" tab keeps
its name (the toast names it as a place, H18) and how far the word sweep reaches (H17).

## Tasks

Frontend-heavy; backend touches only rating-label constants (T11110). No schema change.
**Order:** T11100 (design gate) first. T11110 is independent and can land any time. T11150 ->
T11120 -> T11130 are strict (same files: `AnnotateFullscreenOverlay.jsx`, `DetailsFields.jsx`,
`AnnotateModeView.jsx`, `AnnotateContainer.jsx`). T11140 is file-disjoint except `AnnotateScreen.jsx`.

| ID | Task | Tier | Status |
|----|------|------|--------|
| T11100 | [UX design gate: editor layout, rating modal, Highlight popup, mode bar](T11100-ux-design-gate.md) | design | WAITING ON USER |
| T11110 | [Rating 5 becomes "Highlight", in gold](T11110-brilliant-to-highlight-rename.md) | M | TODO |
| T11150 | [Play editor hierarchy (time, name + rating, details) and no "clip" wording in Annotate](T11150-play-editor-hierarchy-no-clip-word.md) | M | TODO |
| T11120 | [Unrated Done opens the "Rate this play" modal](T11120-require-rating-gate.md) | M | TODO |
| T11130 | [Highlight popup: Make Highlight Now / Highlight Later; remove Create clip + Frame CTAs](T11130-done-popup-highlight-choice.md) | L | TODO |
| T11140 | [Mode bar: Frame Highlight / Add Spotlight, gated on the selected play's highlight](T11140-mode-bar-rename-and-gating.md) | M | TODO |
| T11160 | [Team plays become highlights like any other](T11160-team-plays-become-highlights.md) | M | TODO |

## Open questions (answered in the decision artifact)

Recommended default in brackets. Settled by round 2: the old H1 noun choice (now a
confirmation) and round 1's C1/C2 "Required" gate styles (replaced by the rating modal, H12C).

| # | Question |
|---|---|
| H1 | Confirm: parent-facing object is "highlight"; "Reel" is reserved for the future post-publish stitcher (T11300). [yes] |
| H2 | "Framing" -> "Frame Highlight" and "Spotlight" -> "Add Spotlight": tab labels only, or all ~30 derived strings ("Generate Framing", "Framing ready", ...)? [tab labels + screen headings now; process nouns in the T11280 sweep] |
| H3 | Done on a 1-4 star play: just close; rating 5 is the only way to make a highlight. [yes] |
| H4 | Escape on the Highlight popup: back to the editor, nothing written (vs. acting as Highlight Later). Backdrop never closes. [back to editor] |
| H5 | Which exits open the "Rate this play" modal: every exit (Done, X, Escape, timeline click, switching plays, mobile fullscreen exit, mode bar / Home), or only Done? Delete play always allowed. [every exit] |
| H6 | Legacy unrated plays: modal when their editor next closes, no backfill. [yes] |
| H7 | Re-rating: a play re-rated to Highlight without one gets the popup; a play that already is a highlight gets none; downgrading keeps the highlight. [yes] |
| H8 | Post-creation stage buttons ("Frame" / "Apply Spotlight" / "View Final") in the editor and on the main screen: remove from the editor, keep ONE main-screen button with the new nouns. [yes] |
| H9 | Frame Highlight unlock follows the SELECTED play's highlight; no play selected = locked. [yes] |
| H10 | Saved names "Brilliant ...": rename derived names going forward, no backfill. [yes] |
| H11 | Quest step `annotate_brilliant`: keep the persisted id, update copy. [yes] |
| H12A | Editor layout: A2 (big time readouts over the trim bar; name + rating pill that opens the meanings list, same list as the rate modal) or A1 (time fields beside the bar; inline star row). [A2] |
| H12B | Highlight popup: B2 in-place gold card or B1 centered modal. [B2] |
| H12C | "Rate this play" modal wording as mocked (one-line meaning per rating, "Back to editing" as the only way out without a rating). [as shown] |
| H12D | Mode-bar active tab: solid gold, or gold underline (Framing already has a blue primary; one-saturated-element rule). [solid gold] |
| H13 | Team plays rated Highlight: no popup (they never become highlights today) or popup too? [no popup] |
| H14 | Add Spotlight unlock: after Framing is generated (today's rule; Spotlight edits the framed video) vs. as soon as the highlight exists. [after Framing] |
| H15 | Palette: P2 = gold `#F5B700` (5), berry `#AD1457` (2), vermillion `#D55E00` (1), bluish-green `#009E73` (4), blue unchanged (3); fixes the gold clash AND today's red/green color-blind clash. P1 = only 5 and 2. Deuteranopia hand-simulated; protan/tritan still to check in DevTools. [P2] |
| H16 | Play category (My athlete / Team): first row of Details, or level 2 beside Name + Rating (it decides H13's behavior). Sport stays inside Tags as today. [Details] |
| H19 | Drop the desktop edit strip's yellow tint (T8600) for neutral gray so gold only means Highlight. [yes] |
| H20 | Stars stay amber for every rating and Highlight turns the whole control solid gold, vs. stars in each rating's color. [amber stars] |
| H17 | Scope of removing "clip": Annotate only, or every parent-facing screen (Framing, Spotlight, Home, Published, share pages, emails)? [every parent-facing screen, via T11280] |
| H18 | Does the Home "Clips" tab keep its name? The Highlight Later toast names it ("moved to clips"). [keep "Clips" as the place name; it is the one allowed use] |

## Downstream impact (record in those tasks when this epic is placed)

- **T7630 / T7620 guided tour** anchors to Annotate controls and vocabulary that change here.
- **T10320 tutorial reshoot** must be shot after this ships.
- **T9720 release gate** path "two plays -> framed clip" becomes "rate Highlight -> Make
  Highlight Now".
- `RATING_BADGE_COLORS` feeds the timeline, play list, recap and share surfaces, so the gold /
  rating-2 recolor shows up app-wide, not just in Annotate.

## Completion Criteria

- [ ] All six tasks merged with Branch CI green
- [ ] Live-driven on desktop and a 393 px phone: mark play -> Done unrated opens the rating modal
      -> Highlight -> Make Highlight Now lands in Frame Highlight on that play; Highlight Later
      stays in Annotate with the exact toast
- [ ] No "clip", "Create clip", "Frame" CTA or "Required" label in Annotate; no "Brilliant" in UI copy
- [ ] `.claude/knowledge/annotate.md` updated (stale `clipStage.createActions` line fixed)
