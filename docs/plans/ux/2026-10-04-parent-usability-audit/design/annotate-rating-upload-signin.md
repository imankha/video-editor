# UX decisions D-E to D-J (Annotate, rating, upload, sign-in)

Status: DRAFT, nothing implemented. Evidence: ux-audit desktop/02-04, iphone/03, 05, 07; desktop D1-D4; iphone #3, #6-#10; tablet T-01. Code facts are from the brief, spot-checked in source.

Two facts from code that change the framing:
- **H3 is already broken in the product.** `AnnotateModeView.jsx:1285-1304` shows an ungated "Make Highlight" stage CTA for any selected play with zero highlight instances, whatever its rating. So today "5 stars is the only way" is only true *inside the editor*. Whichever D-E option wins, this inconsistency has to be fixed one way or the other.
- **The rating labels drifted from the epic.** Round 2 ruling 2 (2026-09-24) said 5-star "Brilliant" becomes "Highlight" in gold. `clipConstants.js:10` still says `5: 'Brilliant'`, with a later comment saying to "keep the rating vocabulary separate from the Highlight creation workflow". The copy below uses the shipped word, "Brilliant".

---

## D-E. The rating gate

Problem: the parent marks a play and sees two rating controls: a slate "Rate this play" pill that looks disabled, and a bare row of five unlabeled stars headed "Rating". Nothing on screen says that 5 stars is what makes a highlight. Separately, the rate modal (T11120) has had no visible exit since T11390, so on touch it is a trap.

### Option 1: Keep H3, make it legible
- **One control.** Delete the bare `StarRating` row (`AnnotateFullscreenOverlay.jsx:466,472`) and turn the pill into an inline labeled row inside the editor's Name/Rating group (ruling 5 hierarchy):
  - Desktop: label `How good was this play?` (text-sm text-gray-300). Below it, five 44px star buttons, left to right 1 to 5. Under each star, an always-visible caption in text-xs text-gray-400: `Mental Lapse`, `Technical Lapse`, `Interesting`, `Good`, `Brilliant`. The selected star and its caption turn amber-400. The Brilliant cell gets a gold ring (H2 palette).
  - 390px: same row, each cell about 66px wide. Captions are text-[11px] and wrap to 2 lines ("Technical / Lapse"). No horizontal scroll.
- Caption under the row (text-sm text-gray-300) while the rating is unset or 1-4: `Rate it 5 stars (Brilliant) to make it a highlight.` Once it is 5: `Brilliant. Press Done to make it a highlight.`
- ModeSwitcher help: `Rate a play 5 stars (Brilliant) to make it a highlight.`
- Gate the main-screen stage CTA to 5-star plays, so H3 is actually true.
- Pros: no ruling reversed; fixes discoverability (the D4 root cause) and the "disabled-looking" pill. Effort S-M.
- Cons: still forces a parent who honestly thinks the play is "Good" to inflate it to 5. That corrupts the data the rating feeds: recap auto-selection (5, then 4 as fallback), the game-card brilliant_count, the poster pick, and T3630 ranking.
- Conflicts: none with H3/H5. The caption is an instruction, not a "Required" tag, so it stays within round 2 ruling 1 (2026-09-24, "acts required but never says Required").

### Option 2: Decouple
- The editor footer becomes `[Delete play]  ...  [Make this a highlight] [Done]`. The primary button is bg-cyan-600 (matching the existing stage CTA), Done is secondary. Rating is optional, and the H5 rate modal on every exit is removed.
- At 390px the footer stacks: a full-width `Make this a highlight` (min-h-[52px]), then a row with `Delete play` on the left and `Done` on the right.
- Pros: matches the audit; uses the fewest concepts; no data inflation.
- Cons: reverses the epic's core premise ("the RATING is the gesture"). Ratings become sparse, which weakens recap/poster/ranking (all null-safe, but they lose signal). Removes T11120 and T11130 behavior that shipped 6 days ago. Effort M.
- Conflicts: H3 and H5 (2026-09-24), T11120, T11130, and the 2026-09-28 prod epic.

### Option 3: Hybrid (5 stars still auto-offers; any play can be made a highlight)
- Everything in Option 1 (one labeled control, captions, gold Brilliant), plus:
- When the rating is 1-4 or unset, a low-emphasis text button sits under the caption: `Make a highlight anyway` (text-sm text-cyan-300 hover:text-cyan-200 underline-offset-2, Sparkles 14px). It opens the existing gold HighlightChoiceCard (`Make Highlight Now` / `Keep Annotating`), so there is no new surface.
- Caption becomes: `5 stars (Brilliant) offers to make it a highlight.`
- The rate gate (H5) stays, so ratings keep flowing. The main-screen stage CTA stays ungated, which turns today's accidental inconsistency into the stated rule.
- Pros: discoverable; never forces rating inflation; reuses existing components; small diff. Effort M.
- Cons: two paths to one outcome, so "Brilliant" carries less meaning.
- Conflicts: H3 (2026-09-24). It keeps H5.

### Visible non-rating exit on touch
Today the T11120 rate modal can only be dismissed with Escape, which a phone does not have.
- Option (a) Leave it. Conflicts with nothing, but it is a hard trap on touch.
- Option (b) Restore the `Keep editing` text button. Conflicts with T11390 (owner-reported, 2026-09-28), which removed it because it competed with the rating choices.
- Option (c) **Recommended:** an icon-only `X` in the modal header (style guide modal pattern: `p-2 text-gray-400 hover:text-white`, size 20, aria-label `Back to the play`). It does the same thing as Escape: returns to the editor and writes nothing. It is the platform convention and does not compete visually with the five choices. Backdrop stays inert.

**Recommendation: Option 3 + exit (c).** The audit's failure is invisibility, and Option 1 fixes that. But forcing a 5-star rating to get a highlight converts the rating into a button and degrades the very data (recap, poster, ranking) that justified keeping ratings. The product already lets any play become a highlight from the main screen, so Option 3 only makes the in-editor rule match reality. If the owner wants to keep H3 strictly, ship Option 1 *and* gate the stage CTA. Either way, ship (c).

---

## D-F. Rename "Annotate" / "annotations"

Evidence: the mode bar says "Annotate", the button says "Mark play", game cards say "6 annotations" (iphone #5, #8).

| Option | Mode bar | Game card | Notes |
|---|---|---|---|
| A. Keep | `Annotate / Frame Highlight / Add Spotlight` | `6 annotations` | Zero effort; keeps the jargon |
| B. Noun only | `Annotate` (unchanged) | `6 plays marked` | Effort S. Kills the worst inconsistency |
| C. **Verb phrase** | `Mark Plays / Frame Highlight / Add Spotlight` | `6 plays marked` | All three tabs become verb + object, the pattern H2 set for the other two |
| D. Audit's "Choose moments" | `Choose Moments` | `6 moments` | Adds a third noun ("moment" alongside play/highlight); reject |

- Layout: "Mark Plays" is 10 characters vs 8, and fits the existing 390px tab (scissors icon kept). Route `/annotate`, code identifiers and knowledge-doc names stay unchanged (internal).
- ModeSwitcher help leads with the same verb: `Mark Plays: press Mark play right after a great moment.`
- Conflicts: round 2 ruling 6 (2026-09-24) listed the bar as "Annotate / Frame Highlight / Add Spotlight". That was a ruling on the *other two* tabs, not a defense of "Annotate", but the owner did write it down.
- Effort: C is S-M (MODE_NAMES plus a grep for literal user-facing "Annotate"/"annotation" in copy, tests and e2e selectors by text). It is cheapest before the guided tour (T7630/T7640) anchors on the label.

**Recommendation: C.** The button already says "Mark play". Making the tab match removes the one non-parent word from the 3-step bar and makes the bar read as instructions.

---

## D-G. Annotate progressive disclosure + phone zoom

Today at 390px (iphone/07): frame-step buttons, a `300%` zoom pill, a scrollbar, the layer chips (`My athlete / Team`), video zoom, and the helper text all sit around a single green button.

### Option A: Keep everything visible, fix contrast only
Make the enabled `Share` and `Add footage` text-gray-200 and the disabled `Review plays` text-gray-500, plus the reason `Mark your first play to review it.` Effort S. Density stays.

### Option B (recommended): Derived disclosure while the game has no plays
When `hasAnnotateClips === false` (derived from data, nothing persisted, already computed in `AnnotateModeView`):
- Hide the frame-step buttons (keep play/pause, the 5s back/forward skips, and 1x speed), the timeline zoom pill and its scrollbar, and the `My athlete / Team` chips (there is nothing to filter yet).
- Show a `More controls` text button (SlidersHorizontal 14px, text-sm text-gray-300) under the transport row. It reveals everything for the session, held in memory only.
- Helper text (`ANNOTATE.MARK_PLAY_HELPER`) is promoted to text-base text-gray-200: `Play the game. Right after a great moment, press Mark play. It keeps the 6 seconds before and 2 after.`
- Once the first play exists, everything appears as today. It never re-hides on that game.
- 390px result: video, transport, Mark play, helper, and one action row. No zoom number, no scrollbar.

### Option C: A permanent "Fine tune" toggle
Hidden always, held in memory, so it resets each visit. That annoys returning parents every session. Reject.

### Phone default zoom
- T10780 (2026-09-20) chose 300% so that *existing plays* stay legible and tappable instead of becoming 4-8px slivers. With zero plays that benefit is nil, and the cost is a sideways-scrolling track plus a "300%" number (iphone #9).
- **Recommend: 100% when the game has 0 plays, 300% from the first play.** Derived from data, not persisted. When the switch happens, keep the playhead in view by scrolling the new play to center. Desktop stays at 100%.
- Conflicts: T10780 (2026-09-20) and T10930 set 300% unconditionally on phones. This narrows it to the case it was designed for. The guided tour (T7630/T7640, owner-ruled to ship LAST) must anchor on `Mark play`, not on the hidden controls. Note that in its task file.
- Effort: M (conditional render, a zoom prop keyed on a derived boolean, tests for both states).

**Recommendation: B + conditional zoom, and A's contrast fix regardless.**

---

## D-H. Upload progress model

There is no real alternative to "one number, one sentence". Showing a per-phase % next to the weighted overall % is the bug. Showing MB uploaded next to the bar reintroduces two numbers that disagree, because hashing is 15% of the weighted total. A Prepare/Upload/Finish stepper adds chrome without adding truth.

Spec: one bar showing the overall weighted %, and one sentence with no percent in it. The % appears once, right-aligned in the bar label.

| Phase (`UPLOAD_PHASE`) | Sentence | Sub-line (text-xs text-gray-400) |
|---|---|---|
| HASHING / PREPARING | `Getting your game ready to upload` | `Keep this tab open until it finishes.` |
| UPLOADING | `Uploading your game` | `Keep this tab open until it finishes. You can start marking plays.` |
| FINALIZING | `Finishing up` | (same) |
| COMPLETE | `Your game is uploaded.` | none; the bar is removed after 3s |
| ERROR | `Upload stopped.` + `Retry upload` button | the server's reason, if any |

- Desktop: a bar row above the video, `h-1.5 bg-gray-700` with a `bg-green-500` fill, sentence on the left and `20%` on the right. At 390px the same row runs full-width, and the sub-line wraps.
- Fold `LOCAL_PREVIEW_NOTICE` into the sub-line during upload instead of showing a separate chip. While the player is on the local blob, suppress the "Connecting to server..." buffer overlay: it describes a remote stream that is not playing. That suppression is a bug fix (verify the mechanism), not copy.
- Flag: `UPLOAD_STATE.SAVED = 'Saved'` conflicts with the standing "no Saved UI copy" rule. Use `Uploaded` instead.
- Effort: S-M (presentation layer in `utils/uploadPresentation.js`; `uploadManager` messages become log-only).

---

## D-I. Upload modal copy + cost facts

Hard rule: the AI never frames, tracks, centers or follows the player. The audit's "We'll keep your child centered" is out.

### Copy options (replace `DIVISION_OF_WORK`)
- **I-1 (recommended), one sentence:** `You mark the best plays and frame your player. We smooth the motion, sharpen the picture, and build a highlight you can share.`
- I-2, numbered steps (text-sm, `ol` with gray-500 numerals):
  `1. Upload your game.`
  `2. Mark the plays you want to keep.`
  `3. Frame your player. We smooth the motion and sharpen the picture.`
  `4. Share your highlight.`
- I-3: keep today's copy, minus "AI's player boxes" and "connects the dots". It is still mechanism-first.

Honesty check for I-1: the parent marks and frames; the app smooths the motion between their framing points and upscales ("sharpen the picture"). Picking the player from the AI's boxes is left out rather than misdescribed. That is acceptable at this decision point, and Focus mode explains it in context. I-2 is clearer for a first-timer, but adds 4 lines above the drop zone on a phone and pushes `Upload game` below the fold at 844px.

### Cost facts, stacked (both widths)
Replaces the `justify-between` row. A `dl` inside the existing `bg-gray-800 rounded-lg p-3` panel, Coins icon on the first row only:
```
Cost              2 credits
Your balance      54 credits
Game video kept   30 days
```
- Label is text-sm text-gray-400; value is text-sm text-white text-right.
- At 390px each row still fits on one line ("Game video kept" is about 110px). If needed, `grid-cols-[auto_1fr]` keeps values aligned without wrapping into each other.
- Insufficient balance: the value turns `text-amber-300` and a fourth row adds a `Get credits` link.
- Before shipping, verify the retention promise in the backend: if highlights outlive the game video, add a sub-line `Highlights you make are kept.` Do not add it unverified.
- Effort: S.

**Recommendation: I-1 + stacked facts.**

---

## D-J. Sign-in feedback

Constraint: the Google button is rendered by GIS inside Google's iframe (`googleAuth.js`, popup mode, FedCM prompt). The app *cannot see the click*; it only gets `handleCredential` on success. In an in-app browser the popup fails silently, so no callback ever arrives. A plain "Signing you in... on click" is therefore not buildable as described.

### J-1. Passive fallback, always visible (S)
- Directly under the Google button (text-sm text-gray-400): `Google not opening? ` followed by a link-style button `Get a sign-in code by email` that focuses the email field.
- `Signing you in...` (spinner, replaces the button area) shows from callback receipt until `onAuthSuccess`. That is the backend exchange, the only interval the app can observe.
- Email form: persistent label `Email address` (text-sm text-gray-300, `htmlFor`), keep the placeholder, button `Email me a code`.

### J-2. J-1 + failure detection heuristic (M, recommended)
- When the GIS iframe takes focus (window `blur` while `document.activeElement` is the GIS iframe), start a 2s check. If `document.hasFocus()` is still true (no popup took focus) and no callback has arrived, show an inline amber notice above the email form: `We couldn't open Google sign-in here. Try again, or get a sign-in code by email.` Then focus the email field.
- No user-agent sniffing. Share-page UA sniffing has broken twice; T7350 moved to capability checks.
- Must be verified in real browsers (Chrome popup-blocked, iOS Safari, an Instagram/Facebook in-app view), because focus semantics differ by browser. Desktop and 390px layouts are identical: a single centered column, with the notice full-width in the card.

### J-3. Redirect mode (`ux_mode: 'redirect'`, `login_uri`) (L)
- Needs a backend form-POST endpoint with `g_csrf_token` double-submit, a redirect back to the app, and campaign params carried through. Changes One Tap/FedCM interplay.
- Does **not** fix the main case: Google refuses OAuth inside embedded webviews (`disallowed_useragent`), so in-app browsers still fail. The email code is the only universal path.

**Recommendation: J-2** (J-1 alone if the heuristic proves flaky in real-browser testing). Headline: keep `Share Your Player's Brilliance`, and add the subline `Turn game video into highlights of your player.` The audit's suggested "highlight reel" breaks the vocabulary rule ("reel" is never used for one highlight).

---

## Summary

| # | Recommendation | Rulings it touches | Effort |
|---|---|---|---|
| D-E | Hybrid: one labeled star row + `Make a highlight anyway`; X close on the rate modal | H3 (2026-09-24); T11390 (2026-09-28, X avoids its objection) | M |
| D-F | `Mark Plays` tab, `plays marked` on cards | Round 2 ruling 6 (2026-09-24) | S-M |
| D-G | Hide advanced controls until the first play; 100% phone zoom until the first play; contrast fix | T10780 (2026-09-20), T10930; tour T7630/T7640 anchors | M |
| D-H | One bar %, one sentence per phase; suppress the stale buffer overlay; drop "Saved" | T9430 copy | S-M |
| D-I | I-1 sentence + stacked `dl` cost facts; verify the retention promise | none | S |
| D-J | Passive email fallback + focus heuristic; no redirect mode | none | M |
