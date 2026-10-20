# T11300: Reels v2 - stitch published highlights into a college highlight reel

**Status:** TODO (thawed 2026-10-20; sequenced after the Video Pre-Shrink milestone)
**Impact:** 8
**Complexity:** 8
**Created:** 2026-09-24
**Updated:** 2026-10-20

## Problem

Parents want one assembled college / recruiting reel. The old Reels feature assembled RAW clips
into a multi-clip EDITABLE project, which forced Framing and Spotlight to handle multiple clips.
It was removed by the [single-clip-editor](single-clip-editor/EPIC.md) epic (T11230 deleted the
Reels tab and the `GameClipSelectorModal` "Create reel" picker on 2026-09-27).

## Solution (vision, user's words 2026-09-24)

"Reels" comes AFTER Published: a place to stitch PUBLISHED clips together, control transitions,
add interstitial text frames, and make a college highlight reel. Framing and Spotlight stay
single-clip forever.

## Design decisions (RULED 2026-10-20)

Wireframes: https://claude.ai/artifact/GvP9djXxXSRmU5WVb3yN35 (five phone-width flow screens,
three entry-point variants, decisions board). Full screen-by-screen UI spec with Tailwind
classes, states and the reuse map: [T11300-ui-proposal.md](T11300-ui-proposal.md).

The user took the ui-designer's recommendation on every decision except 4, where the default
was flipped.

| # | Decision | Ruling |
|---|----------|--------|
| 1 | Entry point | Fourth **Reels** tab after Finished (Games / Clips / Finished / Reels). Path `/home/highlight-reels` (`/home/reels` is the frozen Clips path; `/home/reels-in-progress` is a retired dead link). Empty state uses `EmptyTabGuide`; primary CTA **New reel**, locked with "Finish a highlight first" at zero finished highlights. |
| 2 | Selection model | Checkbox tiles over FINISHED highlights (`final_videos`), never raw clips. Game / tag / Top ranked filter chips are a pure client-side VIEW; the payload is an explicit ordered id list. No filter-driven definition (the old dual client/server filter gotcha). |
| 3 | Default order | **Best first** (rank order, frozen quality where unranked). Sort control Best first / Game date / Custom; any manual drag flips to Custom. |
| 4 | Transitions | **Default = hard cut.** Fade to black is available as a single reel-level setting the user can switch on (Cut / Fade pill in the Arrange settings block). Per-joint choice and crossfade/dissolve are out of scope (Modal never rendered a dissolve). *User override 2026-10-20: the recommendation was fade default; the user chose cut default with fade as the customization.* |
| 5 | Text frames | Title card (existing intro card pre-roll) plus between-clip section cards (title + optional subline, 2.5 s) via the same `compose_serve_time_dispatched` compose with one new minimal "section card" template. Hidden behind a **Text frames** toggle so the simple path stays simple. Branded outro always appended. |
| 6 | Cost and length | Free (inputs were paid at upscale; collection stitches are already free per collections.py Decision 4). Soft advisory at 5:00 ("Coaches rarely watch past the first minute"), hard technical cap around 15:00 / 40 highlights. No cost line in the CtaBar beyond "Included". |
| 7 | Membership after a member changes | Members keyed to the highlight's stable project id. When the project's current `final_video_id` differs from the one stitched, the reel tile shows **Changed** and the kebab gains **Re-export**; Play / Share keep serving the last export so the link matches the video. Never a live self-restitching query; never frozen ids that orphan silently. |
| 8 | Draft persistence | A reel row is created at the **Arrange** gesture; every reorder, text-frame edit, name edit and setting change is a surgical POST from its handler. No save button, no "Saved" copy. Drafts show on the Reels tab as **Not exported** with a Continue action. |
| 9 | Mixed ratio | Ratio pill first (Portrait / Landscape, default = ratio with more finished highlights). Other-ratio highlights are hidden with an empty-state chip to switch. Mono-ratio keeps the stitch a stream copy. Letterboxed mixing is a possible later toggle, not v1. |
| 10 | Where the result lives | Reels tab only. The export creates a `final_videos` row so poster / stream / share / download plumbing is reused unchanged. |
| 11 | Mobile reorder | Always-visible grip handle with pointer capture on the handle only (`touch-none` on the handle, list scrolls elsewhere) plus kebab Move to top / up / down / Remove. No long-press. |
| 12 | Preview fidelity | Reuse `IntroStoryPlayer` + `CompositeScrubber` playing members in order; text frames as static segments; caption "Fade between highlights is added when you export." No server-rendered preview stitch. |

Non-negotiables carried from the project rules: a single finished product is a **highlight**, the
assembled product is a **highlight reel** (short form Reels in controls), never "reel" for one;
no "Saved" copy; modals never close on backdrop click; no em dashes in copy; 390 px first.

## Context

Reuse, don't rebuild (audit 2026-09-24): collections already provide ordered play-as-one
(`CollectionPlayer` / `IntroStoryPlayer` composite scrubber), stitched download (T4945 Modal
`stitch_members`, `ffmpeg_concat.py`, T4947 cache), intro cards + branded outro
(`serve_time_video.compose_serve_time_dispatched`), collection share links and Glicko rank
ordering. Transitions and interstitial text frames extend `card_compose_plan` / compose.

### Relevant Files (REQUIRED)

Frontend
- `src/frontend/src/components/ProjectManager.jsx` - tab bar (`TAB_PATHS`), new Reels tab body
- `src/frontend/src/stores/editorStore.js` - `HOME_TAB_PATHS` gains `/home/highlight-reels`
- `src/frontend/src/components/collections/ReelTile.jsx` - `variant="reel"` (poster, Play, Share, kebab, Not exported / Changed chips)
- `src/frontend/src/components/collections/CollectionPlayer.jsx`, `introcards/IntroStoryPlayer.jsx` - review step player (unchanged, consumed)
- `src/frontend/src/components/shared/CtaBar.jsx`, `EmptyTabGuide`, `SettingRow` - consumed
- NEW `src/frontend/src/components/reels/` - `HighlightPicker` (+ `SelectableHighlightTile`), `ReelMemberList` (drag reorder), `TextFrameRow`, `TextFramePreRoll`, `ReelBuilderTakeover` (3-step container with the DraftReelPreview-style phase machine)
- `src/frontend/src/utils/uniqueName.js` + resurrect `GameClipSelectorModal.suggestedName.test.jsx` logic for the seeded name
- `src/frontend/src/constants/displayNames.js` - Reels tab copy, builder copy

Backend
- NEW `src/backend/app/routers/reels.py` - reel CRUD (draft row at Arrange), surgical member/order/text-frame/setting writes, `POST /api/reels/{id}/export`, Changed detection
- `src/backend/app/database.py` - profile_db `reels` + `reel_members` tables (Migration agent; schema in the design doc)
- `src/backend/app/services/ffmpeg_concat.py`, `modal_functions/video_processing.py::stitch_members` - optional per-member fade in/out before concat (Fade setting)
- `src/backend/app/services/serve_time_video.py` - section-card template for text frames
- `src/backend/app/services/publish_final_video.py` - the export lands a `final_videos` row

### Related Tasks
- Depends on: T11250, T11260 (single-clip-editor epic) landing first
- Sequenced after: the Video Pre-Shrink milestone (T8845, T8850, T8860, T8865) per user direction 2026-10-20
- Related: season-highlights-spec.md section 3 (collections verbs Play / Share / Video), T11500 (dev account picker's Full preset waits on this reel)

### Technical Notes
- L-tier, design-gated: the Architect writes `T11300-design.md` covering the `reels` schema
  (members as project ids + stitched `final_video_id` snapshot, order, text frames, transition,
  title card, exported `final_video_id`), the surgical endpoint contract, the fade step, and the
  Changed detection query (batched like T10860's `stale_share`, never N+1).
- Gesture-based persistence only: no `useEffect` may write a reel. The draft row is born on the
  Arrange click; each later write names its gesture.
- Exporting shows a spinner strip, never a fake progress bar (compose reports no byte progress,
  T7050 rule). Closing the takeover mid-export is allowed; the tile reads Not exported until the
  export lands.
- Vocabulary sweep T11280 already settled "Finished" and "highlight"; keep `SECTION_NAMES.REELS`
  as the internal key.

## Salvaged notes from single-clip-editor removal

- **`GameClipSelectorModal.jsx` clip-assembly picker (deleted by T11230, 2026-09-27).** Read it at
  its last commit before T11230 for the interaction design (a surviving copy also sits in the
  t8630 container checkout). Worth re-reading:
  - **Live totals card:** selected count + summed duration with the hours case (`formatDuration`
    -> `utils/timeFormat`, `1:03:20` not `63:20`). Reused as the picker's sticky footer.
  - **Inline single-clip preview player** inside the modal. Reused as the tile's Play chip
    opening the single-reel `CollectionPlayer`.
  - **Suggested project name** from the selected games (`suggestedName` memo) de-duplicated via
    `utils/uniqueName.ensureUniqueName`; its unit test is worth resurrecting.
  - **Gotcha:** the filter logic existed twice (client + `_build_clips_filter_query`) and had to
    agree exactly. Decision 2 avoids this by making filters a view and the payload an id list.

## Implementation

### Steps
1. [ ] Architect design gate (`T11300-design.md`): schema, endpoints, fade step, Changed query
2. [ ] Migration: profile_db `reels` + `reel_members` tables
3. [ ] Backend: reel CRUD + surgical writes + export endpoint + Changed detection
4. [ ] Frontend: Reels tab + empty state + reel tiles
5. [ ] Frontend: Pick step (`HighlightPicker`, filters as view, live totals footer)
6. [ ] Frontend: Arrange step (drag list, text frames, settings block, seeded name)
7. [ ] Frontend: Review step (composite player, phase machine, exporting / failed / ready)
8. [ ] Stitch: optional fade, section-card template, outro
9. [ ] Tests: behavioral tests per acceptance criterion; e2e for the full build flow at 390 px and desktop

### Progress Log

**2026-09-24**: Filed, ICE (not next version).

**2026-10-20**: User reviewed the wireframe canvas and ruled all 12 decisions (recommendations
accepted; decision 4 flipped to cut default with fade available). Thawed to TODO and sequenced
after the Video Pre-Shrink milestone. No code written.

## Acceptance Criteria

- [ ] AC1 Home shows Games / Clips / Finished / Reels; the Reels tab lives at `/home/highlight-reels` and the old `/home/reels-in-progress` link still resolves to Home, not to Reels
- [ ] AC2 With zero finished highlights the Reels tab shows the empty guide and New reel is locked with "Finish a highlight first"
- [ ] AC3 Pick step lists only FINISHED highlights of the chosen ratio; switching the ratio pill hides the other ratio and clears the selection; filter chips never change the payload beyond which ids the user tapped
- [ ] AC4 The sticky footer shows live count + total length (hours case correct) and turns advisory above 5:00; Arrange is disabled at zero selected
- [ ] AC5 Clicking Arrange creates the reel row (one POST); reload lands on the Reels tab with the draft tile reading Not exported and Continue reopens it with the same members and order
- [ ] AC6 Default order is Best first; dragging a row flips the control to Custom and persists the new order with one surgical write; kebab Move up / down / to top do the same
- [ ] AC7 Transition defaults to Cut; switching to Fade persists and the exported file carries a fade to black between members; Cut exports a stream-copy concat
- [ ] AC8 With Text frames on, Add text frame inserts a 2.5 s section card at that joint; the preview shows it as a static segment and the export renders it via the card compose
- [ ] AC9 A member whose highlight was deleted renders the deleted-row state and locks Preview until removed
- [ ] AC10 Export creates a `final_videos` row; the tile's Play, Share and Download use it; no credits are debited
- [ ] AC11 Re-exporting a member highlight flips its reel tile to Changed and adds Re-export; Play and Share keep serving the previous export until Re-export completes
- [ ] AC12 Export failure shows the amber strip with Retry and leaves the draft intact; no "Saved" copy anywhere in the flow
- [ ] AC13 Every write in the flow traces to a named gesture (unit test asserting no effect-driven persistence) and the full build flow passes an e2e at 390 px and at desktop width
