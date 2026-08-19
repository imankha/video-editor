# T5540: Annotate Camera Lanes + Main + Preference Pill

**Status:** TODO
**Impact:** 9
**Complexity:** 8
**Created:** 2026-07-19
**Updated:** 2026-08-19

## Problem

The payoff task: far-side action is unwatchable on your own camera but another feed
probably filmed it well. With up to 50 feeds (full cameras AND short clips) the old
"one toggle button" design is dead; the normative UX is [UX-SPEC.md §6](UX-SPEC.md) —
**camera LANES** with a resolved **Main** track, appearing only at ≥2 feeds (one feed =
Annotate byte-identical to today; progressive-disclosure ladder).

## Solution

### A. Lane stack (desktop, §6 — implement the spec, don't re-design)

Below the existing clip lanes, only when the pool has ≥2 feeds:
1. **Main lane** first: the resolved feed choice over time as contiguous segments
   (winning feed's color, owner first name in segments ≥~48px, aria switch schedule).
   Precedence **clip stamp → preference spans → reference feed** — computed, never
   editable here. A thin preference strip + `Pin` glyphs under it makes every preference
   span visible (never invisible state).
2. **One lane per FULL-LENGTH camera** (owner initial badge + name, coverage bars via the
   shared `EDGE_PADDING` formula, active-at-playhead full opacity).
3. **Clip-kind feeds PACK into minimal lanes** (greedy interval packing by start time —
   deterministic, stable): non-intersecting clips share a lane; intersecting clips split.
   Chips in the OWNER's feed color; tap = watch that clip's angle (session switch).
4. **ONE height model:** rows `1.625rem`; `totalLayerHeight = 9.75rem + 1.625rem ×
   min(feedLanes + 1, 3)` where `feedLanes` = full camera lanes + PACKED clip lanes;
   beyond the cap the region scrolls with **Main + active lane sticky** and a `+{n} more`
   hint.
5. **Short-viewport fallback:** `window.innerHeight < 800` (any pointer) → no lane stack;
   the mobile chip path renders instead. One rule, no per-surface exceptions.

### B. Mobile: active-camera chip + bottom-sheet picker

Chip in the player controls (≥2 feeds only) → GameTile-style bottom sheet: Main first,
full cameras with coverage notes, then a **Clips section listing only moment-covering
clips** (non-covering omitted, not disabled). Unavailable rows use the single treatment +
inline Renew → T7300's checklist.

### C. Interactions

- Lane/chip/sheet tap and **`C` cycle** (skips no-coverage feeds; existing focus guards in
  `useKeyboardShortcuts.js`) switch the VIEWING camera — session state only, never
  persisted (no-persisted-view-state). Video swaps via the wall-clock mapping with the
  playhead preserved; transient over-video chip (`● Sarah's camera`, 1.5s); gap tap →
  `No coverage here` chip.
- **"Prefer this camera from here" pill — the ONLY preference gesture**, at the player
  (never a lane menu; right-click/long-press do nothing): shown while watched ≠ Main's
  resolution; click writes the span, updates the strip, confirms via chip.
- **One-time coach-mark** on first ≥2-feed render; the Got-it click is the persisting
  gesture (user-prefs flag). First Main render adds the one-line Main helper.
- **Unaligned lane:** yellow badge, feed EXCLUDED from Main until confirmed (Main must
  never cut to a misaligned feed); badge tap opens T5530's §7. **Unavailable lane:**
  single grayscale+Lock treatment; tap → renew popover → T7300. Line-up drag mode exists
  here but is entered only from §7 (T5530 owns it).
- **Live arrivals:** T5520's poll materializes new lanes in place + one-time arrival
  toast; re-lined-up toast derived from `offset_updated_by/at` vs `last_opened_at` —
  no new persisted state.

### D. Time machinery (kept from the original design — still valid)

- Per-feed virtual timelines: `buildFullVideoTimeline(gameVideos.filter(v => v.feed_id ===
  activeFeed))`; remove T5520's temporary own-feed filter in `applyGameData`.
- Pure mapping module `src/frontend/src/modes/annotate/utils/feedTimeMap.js`:
  `toShared` / `fromShared` (→ `{virtualT} | {gap}`) / `mapAcross`, exhaustively
  unit-tested (halves, offsets, gaps, NULL offsets → unavailable). T5550 implements the
  Python twin with SHARED test vectors — name and vectors agreed here.
- **Annotations stay keyed to the member's own primary timeline.** While viewing another
  feed, clip create/edit maps back via `mapAcross`; a mapped moment in a primary coverage
  gap blocks creation with a toast (never extrapolate). Playhead save/resume stays in
  primary time (map before `saveLastPlayhead` on tab-hide).
- Main resolution (`resolveMainFeed(t)`) is a pure function over (clip stamps, preference
  spans, reference feed) — unit-tested; renamed to "Auto" only when T5560 ships.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/modes/annotate/AnnotateTimeline.jsx` + `TimelineBase.jsx` — lane stack, height model, sticky scroll
- NEW `src/frontend/src/modes/annotate/utils/feedTimeMap.js` + `resolveMainFeed.js` + `packClipLanes.js` (pure, unit-tested)
- NEW `src/frontend/src/modes/annotate/constants/feedColors.js` — FEED_COLORS by `member_index % 4` + MAIN_COLOR (§ Conventions; never cyan/amber/green/blue-500/red/yellow)
- `src/frontend/src/modes/annotate/hooks/useVirtualTimeline.js` — per-feed `buildFullVideoTimeline`
- `src/frontend/src/modes/annotate/hooks/useAnnotateState.js` — `activeFeed` session state
- `src/frontend/src/containers/AnnotateContainer.jsx` — remove T5520 filter; source-swap + seek handler; pill wiring
- `src/frontend/src/screens/AnnotateScreen.jsx` — `C` shortcut; mobile chip + bottom sheet
- `src/frontend/e2e/` — NEW lanes/switch spec

### Related Tasks
- Depends on: T5520 (feed rows + poll), T5530 (offsets/verdicts; §7 entry)
- Blocks: T5550 (picker + stamps), T5560 (Main→Auto)
- References: UX-SPEC §6 (normative — all copy/classes/states/gestures), § Conventions (feed colors, unavailable treatment, ladder), [EPIC.md](EPIC.md) decisions 3, 8, 9

### Technical Notes
- Knowledge docs: [annotate.md](../../../../.claude/knowledge/annotate.md) — READ the landmines; virtual-timeline/load-order code is timing-sensitive (T4060, T3960)
- **Preference spans persistence:** gesture = the pill click → `POST /api/pools/{id}/preferences {feed_id, from_shared_t}`; clearing lives ONLY in Manage cameras (§10 `DELETE .../preferences`). Storage home is member-scoped `feed_preferences` — **flag: EPIC decision 1's four-table list omits it; UX-SPEC's cross-cutting table says "Pool, member-scoped". Architect settles the home (5th PG table vs member-local) at design** — either way member-local semantics: only this member's Main reads it
- Gesture-based persistence: viewing switches write NOTHING; the pill click and Got-it
  click are the only new write gestures on this surface
- Keep mapping/packing/resolution pure and the handlers dumb; no reactive effects
- Coarse pointers: transparent `min-h-11` hit overlays per lane row (§6 a11y); color never
  sole signal (initial badges, icons)
- **Real-browser verification required** (source swap + seek, drag, sticky scroll — jsdom
  lies); migrations: none expected frontend-side (preferences schema rides the architect
  call above — never auto-run)

## Implementation

### Steps
1. [ ] `feedTimeMap.js` + `resolveMainFeed.js` + `packClipLanes.js` with exhaustive unit tests (write FIRST — they pin the model; agree shared vectors with T5550)
2. [ ] Architect call: preference-span storage home (see flag) + endpoint
3. [ ] Lane stack: Main lane + strips, camera lanes, packed clip lanes, height model + sticky scroll + short-viewport fallback
4. [ ] Mobile chip + bottom-sheet picker (Clips section, unavailable rows)
5. [ ] Switching: lane/chip/C/session state + transient chips; remove T5520 filter; clip create/edit mapping + gap toast; playhead mapping
6. [ ] Pill + preference write + strip/pin render; coach-mark + Got-it persist
7. [ ] Unaligned/unavailable lane states + badge entry to §7; live-arrival + re-lined-up toasts off the poll
8. [ ] E2E + real-browser verification session

## Acceptance Criteria

- [ ] One feed → Annotate byte-identical to today; ≥2 feeds → lanes (desktop) / chip (mobile, and any viewport <800px tall)
- [ ] Main plays a complete game with zero configuration; precedence (stamp → span → reference) unit-tested; unaligned feeds never enter Main
- [ ] Ten scattered clips pack to one lane (+1 per overlap); chips tap-switch; sheet lists only moment-covering clips
- [ ] Switching preserves the game moment (real-browser verified); C cycles skipping gaps; viewing state never persisted
- [ ] The pill is the only preference gesture; spans always visible via the strip; clearing only in Manage cameras
- [ ] Clips created on another feed land at correct primary-time positions; export behavior unchanged until T5550
- [ ] Mapping/packing/resolution unit tests + E2E pass
