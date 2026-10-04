# After-Generate UX Decisions (D-A to D-D): DRAFT, awaiting user approval

Evidence reviewed: desktop D6/D7/D8 + screenshots 06/07/08, tablet T-04, iPhone #5/#8; `utils/draftStage.js`, `modes/annotate/clipStage.js`, `config/displayNames.js` (FOCUS_PUBLISH, OVERLAY_PUBLISH, RESULT_PUBLISH, RESULT_RETENTION, STAGE_REASONS), `components/GameTile.jsx`, the T9600 task file, and the shared-vocabulary and clip-ready-screen epics.

## Issues found while auditing (outside the four decisions)

1. **Two statuses mean the same thing to a parent.** In `draftStage.js:82-84`, PRIVATE has the detail "Only you can see it" and PUBLISHED has "Only you can see it until you share a link". Both have the same audience. This is the root of D6 and feeds D-B.
2. **"Saved" chip vs the no-"Saved"-copy rule.** `RESULT_RETENTION` renders "Saved" / "Saved. Link unchanged" (T10670, approved 2026-09-19). That conflicts with the standing feedback that persistence should be silent. The user should rule on this. I recommend dropping the chip and letting the headline carry the moment.
3. **GameTile.jsx:336** reads "N annotations saved — Retry to keep them." It has an em dash, uses "saved" and uses "annotations". Fix it together with D-A.
4. **The shared-vocabulary EPIC.md is stale.** It says the mode names stay "AI Focus"/"Spotlight", but `MODE_NAMES.FRAMING` is now "Framing" (T9860). "AI Focus" also strains the copy-accuracy rule against claiming autonomous framing. The epic should be updated so nobody reverts to it.
5. **"Share" is technically possible before publishing.** `RESULT_PUBLISH` / `PublishLinkFlow` (T10180) already chain publish, visibility review, then create link on the private result surface (`DraftReelPreview.jsx:357`). So "Share this highlight" on the ready screen is buildable, but it would publish without a spotlight in the same gesture (see D-D).

---

## D-A. One status vocabulary and the full ladder

**What's true in the data:** `getDraftStage` returns IN_OVERLAY when `has_working_video` is set, whether or not any spotlight work exists. `has_overlay_edits` can split that bucket. T9860 set the precedent for this kind of split: a label axis, not a fourth DRAFT_STAGE key.

### Option A1: Status word plus a factual "what's done" qualifier (recommended)
The T8470 status words stay (Draft / Private / Published, or whatever D-B picks). The qualifier says what has been done. It never names a mode the item is "in".

| Stage (key + condition) | Group header / detail | Tile badge (short) | Annotate play row status / CTA |
|---|---|---|---|
| NOT_STARTED | "Draft, not framed yet" | "Not framed" | "Marked" / "Frame Highlight" |
| IN_FRAMING | "Draft, framing started" | "Framing" | "Framing started" / "Frame Highlight" |
| IN_OVERLAY, no overlay edits | "Draft, framed" | "Framed" | "Framed" / "Add spotlight" |
| IN_OVERLAY, overlay edits | "Draft, spotlight started" | "Spotlight started" | "Spotlight started" / "Add spotlight" |
| READY, not published | "Private, ready to watch" | "Private" | "Private" / "Preview Highlight" |
| READY, published | "Published" (or the D-B word) | "Published" | "Published" / "View Highlight" |

- **Filter chips** read `DRAFT_STAGE_LABELS` short forms: "All (2)", "Framed (1)", "Not framed (1)". Delete ProjectManager's inline buckets, including "In Overlay" and "Generated" (T9600 single-source rule).
- **DraftTile.jsx:469** and **CollapsibleGroup.jsx:148** literals go away. Both read the short-label map.
- **clipStage.js:139-140**: the status is "Framed" and the CTA becomes "Add spotlight", replacing "Add Overlay to Highlight".
- **Tints:** keep `DRAFT_STAGE_TINTS`. "Spotlight started" reuses `text-blue-300`, with no new color.
- **390px:** the badge is the short form only. Group headers wrap at the comma ("Draft," then "framed"), and no ellipsis is allowed.
- **Game card:** "6 plays · 2 published" replaces "6 annotations · 2 published". It matches "Mark play" (T9520 N05) and fits 390px better than "6 plays marked". If D-B renames, the second half follows it ("2 finished"). The failed-upload line becomes "Upload didn't finish. Retry to keep your 3 marked plays."

**Pros:** Every word is true. "Framed" can't be read as "the app added a spotlight". The stage keys, tile sizing and row grouping stay the same. It finishes T9600's job.
**Cons:** It adds a second IN_OVERLAY label, so the label map needs one predicate (`has_overlay_edits`). Snapshot and copy tests need updating.
**Conflicts:** T8470 (upheld 2026-09-10): compatible, because the status words are unchanged. T9860 (2026-09) deliberately chose "Draft, in Spotlight"; this reverses it. Record that as a decision. T9600 (2026-09-10) "no fourth word": compatible, because "Framed" etc. become the single source's words and every surface reads them.
**Effort:** M, about 7 files (draftStage, DraftTile, CollapsibleGroup, ProjectManager, clipStage, GameTile, displayNames) plus tests.

### Option A2: Next-step labels (the iPhone audit's "Ready to..." style)
The ladder becomes "Ready to frame" / "Framing" / "Ready for spotlight" / "Spotlight started" / "Ready to watch" / "Published".
**Pros:** Labels are action-oriented and scan well.
**Cons:** "Ready for spotlight" implies the spotlight is required, but it's optional and a framed clip can already be finished. It drops "Draft", which conflicts with T8470 (2026-09-10). And "Ready to..." collides with "Ready to watch".
**Effort:** M.

### Option A3: Minimal patch
Only IN_OVERLAY changes, to "Draft, framed" with the badge "Framed". The filter chips read the map. There's no has_overlay_edits split.
**Pros:** Smallest diff, and it fixes the critical D8 contradiction.
**Cons:** A clip with spotlight work in progress still reads "Framed", so the next audit will flag it. Leaves the ladder half-done.
**Effort:** S-M.

**Recommendation: A1.** D8 is a critical trust bug ("did the app change my video?"). The fix is to describe what happened rather than which mode the item sits in. A1 does that with no new stage key and inside T8470's frame. A3 is an acceptable stopgap if this has to ship before the D-B decision.

---

## D-B. Rename "Publish" or keep it

**What publishing does:** it moves the item from Clips to the owner's Published tab and archives the working data. It creates no link and no audience. Sharing is a separate gesture. A parent hears "publish" as "other people can see it", and the app needs a caption to undo that word.

### Option B1: Keep "Publish", tighten the caption. Tab stays "Published"
- Tile: "Publish without spotlight" / "Moves it to your Published tab. Private until you share a link."
- Status detail for Published: "Private until you share a link".

**Pros:** Zero reversals. T9530 N12, T10180's "Publish and get link" and the analytics vocabulary stay aligned.
**Cons:** Audit D6 survives. The word still means the opposite of what it does, and issue 1 above (Private vs Published, same audience) remains.
**Conflicts:** None.
**Effort:** S.

### Option B2: "Finish". Tab "Finished" (recommended)
- Focus tile: "Finish without spotlight" / "Moves it to Finished. Only you can see it until you share a link."
- Overlay primary tile: "Finish" / same caption.
- Library action: "Finish highlight" (was "Publish highlight").
- Tabs: "Games · Clips · Finished". At 390px "Finished" is 8 characters, which fits the existing three-tab bar.
- Status ladder end: "Private, ready to watch" then "Finished" (detail "Only you until you share a link"). Where the data can prove a share link exists, show "Shared" (T8470's original "Shared" word). Don't invent it otherwise.
- T10180 flow strings: "Publish and get link" becomes "Get share link". The review title becomes `Share "${name}"?`. The body stays as is ("Anyone with the link can watch. Creating a link does not send it.").
- Game card: "6 plays · 2 finished".

**Pros:** The verb describes a state change the owner controls, with no implied audience. "Share" becomes the only audience word, which is what a parent expects.
**Cons:** It's a broad copy sweep: tab, quest/guide copy, toasts, e2e selectors, JustPublishedCard copy. Internal ids stay (`published_at`, `is_published`, `/published` route), per the shared-vocabulary standing rule.
**Conflicts:** T8555 (Published tab), T9530 N12 (2026-09-10) and T10180 (2026-09) are all reversed. T9860 D5 (2026-09) kept "Publish" and fixed only the caption. The audit is the newer evidence. Per the "external review can override" rule, take this to the user with those dates.
**Effort:** L (wide copy surface, though mechanical). It needs its own task.

### Option B3: "Save to my highlights". Tab "My highlights"
**Pros:** Warm, and obviously private.
**Cons:** It uses the "Save" verb, which violates the no-"Saved" rule and T10670's acceptance criterion "no Save verb anywhere on the screen" (2026-09-19). "Highlights" is also the object noun: the Clips tab already holds highlights, so a "My highlights" tab blurs the two.
**Effort:** L.
**Not recommended.**

### Option B4: Make sharing the only forward gesture
The ready screen offers "Share" (publish plus create link in one step, via the existing T10180 flow). Not sharing is just "Done for now". The Published state stops being shown as a status at all.
**Pros:** The cleanest mental model: Draft, then Shared.
**Cons:** It's a behavior change, not copy. Archiving working data would be tied to sharing, and owners who want a finished but unshared library lose that state.
**Effort:** L+ and needs an architecture review.

**Recommendation: B2, "Finish" / "Finished".** It removes the false-audience word at its source, makes "Share" unambiguous, and resolves issue 1. If the user wants to keep "Publish", ship B1 now so the caption at least leads with "private".

---

## D-C. Where "Done for now" lands

**What's true now:** T8390 chose Annotate on purpose, so parents can keep marking plays in the same game. The bug is that the play isn't re-selected (`AnnotateContainer.jsx:1408-1456`). That leaves Frame/Spotlight looking locked and the page looking empty. The bug needs fixing whatever is decided here.

### Option C1: Clips tab, new card ringed and scrolled into view
On desktop, land on the Clips tab and `scrollIntoView({block:'center'})` the new tile. The tile gets `ring-2 ring-cyan-400 ring-offset-2 ring-offset-gray-900` for about 2.5s. Above the grid sits a consume-once card reusing the JustPublishedCard (T11580) shell: "Play 1 is in Clips" / "Framed, no spotlight yet." with buttons "Add spotlight" (primary cyan) and "Back to game" (ghost). At 390px the card is full width and the buttons stack at h-11.
**Pros:** Strongest proof the work exists, and it reuses an existing pattern (memory-only marker).
**Cons:** It breaks the mark-another-play loop T8390 was built for, so the parent needs an extra tap to get back to the game.
**Conflicts:** Reverses T8390's destination.
**Effort:** M.

### Option C2: Stay on Annotate, re-select the play, inline confirmation (recommended)
Fix the breadcrumb consumer so Play 1 is selected. Its row gets `bg-gray-800 ring-1 ring-cyan-500/60`, and the mode buttons unlock. The toast is replaced by a consume-once banner above the video: `bg-gray-800 border border-cyan-500/40 rounded-lg p-3`.
- Content: `CheckCircle2` 16px `text-green-400`, then "Play 1 is framed" (`text-sm font-medium`), then "It's in Clips as a draft. Add a spotlight or finish it any time." (`text-xs text-gray-400`).
- Buttons: "Add spotlight" (primary cyan) and "View in Clips" (ghost), plus an X with the accessible name "Dismiss".
- At 390px the banner pins under the header and the buttons are full width, stacked at 44px.
- The marker is memory-only. It clears when dismissed, when another play is selected, or when the user leaves the screen.

**Pros:** Keeps the T8390 loop and fixes the actual defect. Confirmation and both next steps sit where the parent already is, and it removes the empty-page impression.
**Cons:** A banner competes with the video on small screens, so it needs a pin/dismiss rule.
**Conflicts:** None. It's consistent with T8390 and the toast copy intent.
**Effort:** M (bug fix plus banner plus test).
**Edge case:** when the edit didn't start from Annotate (a Clips-tab upload with no game), fall back to C1.

### Option C3: Confirmation sheet before leaving
A modal sheet ("Play 1 is in Clips") with "Mark another play" (primary) and "View in Clips" (secondary). It has no backdrop close, per the standing rule.
**Pros:** The choice is explicit.
**Cons:** It's an extra tap after the parent already said "done". The parent chose to leave, and a modal second-guesses that.
**Effort:** M.

**Visual weight of "Done for now":** it shouldn't be a tile, because it's an exit and not an outcome. It should be more than the current small chip, though. Proposal:
- Desktop: a secondary button centered under the tiles, `h-10 px-5 rounded-lg border border-gray-600 text-sm font-medium text-gray-200 hover:bg-gray-800`, label "Done for now".
- 390px: full width, h-11, last in the stack.
- No caption needed if C2 ships, because the landing explains itself.

**Recommendation: C2, with C1 as the fallback for edits that didn't start from Annotate.**

---

## D-D. Ready-screen tile labels and captions

**Constraints:** the copy can't claim the app finds or tracks the player. The parent points the player out. No em dashes. "Share" is only real via the publish-plus-link flow.

### Option D1: The audit's labels
"Point out my child" / "Save privately" / "Share this highlight".
**Pros:** Goal language.
**Cons:**
- "Save" breaks the no-"Saved" rule and the T10670 criterion (2026-09-19).
- "Share" here would publish the clip without a spotlight in one tap, skipping the main upsell, and it needs the T10180 review step on the Focus screen.
- "my child" switches person: the rest of the app says "your athlete".
- "Edit framing" disappears.

**Effort:** M.

### Option D2: Outcome labels in house vocabulary, paired with B2 (recommended)
- Headline: "Your highlight is ready" (sentence case; "highlight" isn't a proper noun).
- **Primary** (Sparkles): "Add spotlight" / "Show everyone watching which player is yours."
- **Secondary** (FolderCheck): "Finish without spotlight" / "Moves it to Finished. Only you can see it until you share a link."
- **Tertiary** (Pencil): "Edit framing" / "Change the framing and generate again. Uses credits."
- **Exit:** "Done for now" (the D-C button).
- Overlay bar in lockstep:
  - Primary "Finish" / the same caption.
  - "Redo spotlight" / "Go back and change the spotlight." (replaces "Reapply spotlight")
  - "Edit framing" / "Change the framing and generate again. Uses credits." (replaces "Reapply Framing")
- Layout is unchanged from T10670 V2: three tiles in a row at 1024px+, three stacked rows at 390px.

**Pros:** Each label is an outcome, every caption states its audience or cost, there's one verb per concept, and Focus and Overlay match.
**Cons:** It depends on the B2 decision. With B1, swap in "Publish without spotlight" / "Moves it to your Published tab. Private until you share a link."
**Conflicts:** T10670 copy section B (approved 2026-09-19) changes for the captions and "Reapply" wording. The V2 layout is kept.
**Effort:** S-M (displayNames plus two bars' tests).

### Option D3: Two tiles plus a text link
The tiles are "Add spotlight" and "Finish without spotlight". "Edit framing (uses credits)" becomes a `text-sm text-gray-400 underline` link beside "Done for now".
**Pros:** Fewer choices. Paid re-renders get the quiet weight they deserve, and the 390px stack is shorter.
**Cons:** Reverses T9590/T10670's three-level hierarchy (2026-09-10 and 2026-09-19).
**Effort:** S-M.

### Option D4: Add a "Share" tile now
Keep D2's tiles and make the secondary tile "Share without spotlight". It opens the T10180 review card ("Anyone with the link can watch...") and then the link-ready state, all inside the bar.
**Pros:** Delivers the audit's share intent with an honest review step.
**Cons:**
- It makes the no-spotlight path the shortest route to an audience, which works against the product's spotlight value.
- It needs the publish to run from a working video on the Focus screen. That's unverified, and the expert should check it before committing.

**Effort:** M-L.

**Recommendation: D2 with B2.** If the user wants fewer choices, D3's layout tweak can stack on top. Defer D4 until the Finish/Share split is live and measured.

---

**Status: DRAFT. Nothing here is implemented or recorded in task files. All four decisions are user-gated.** Suggested order if approved: A1 (critical, independent), then the C2 bug fix and banner, then D2 strings together with B2.
