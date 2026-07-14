# T5130: Sport-ball playhead handle on the published-video player

**Status:** TODO
**Impact:** 4
**Complexity:** 3
**Created:** 2026-07-13
**Updated:** 2026-07-13

## Problem

On the video player for **any published video**, the timeline scrubber handle is a plain purple dot ([VideoControls.jsx:267-275](../../src/frontend/src/components/shared/VideoControls.jsx#L267)). Replace that dot with the **sport-ball glyph of the publishing profile's sport** — a soccer ball rides the timeline as the playhead handle (user attached a screenshot of a soccer-ball scrubber on the progress bar). Since the audience is overwhelmingly soccer (see memory: target audience), soccer (⚽) is the primary case, but the icon MUST be driven by the publishing profile's sport so other sports get their own ball (🏈 etc.).

This is brand-delight juice: every shared/published reel carries a small sport-native flourish. POLISH / visual only — no infra, no schema.

## Current State (investigation, 2026-07-13)

### The handle to replace
`VideoControls.jsx` is the **shared** YouTube-style control bar. The "scrub dot" is a `rounded-full bg-purple-500` div positioned at `left: calc(${progress}% - …px)` (lines 267-275). It resizes on hover/coarse-pointer. This one element is the playhead handle for every single-video player.

### VideoControls is shared — keep it store-free
`VideoControls` is a **pure props-only presentational component** (no Zustand, no fetch). Critically, per memory ("Landing shares editor player"), the **landing site reuses `VideoControls` / `useStandaloneVideo` / `timeFormat` via the `@editor` Vite alias**. So the sport MUST arrive as a **prop** — do NOT read `profileStore` inside `VideoControls`, or the landing build breaks. Add an optional prop (e.g. `handleGlyph` / `sportEmoji`); when absent, render today's plain dot (backward compatible, exactly like the existing optional tutorial-player props `rates`/`chapters`).

### The ball glyph already exists
`sportEmoji(sport)` in [tagRegistry.js:68](../../src/frontend/src/modes/annotate/constants/tagRegistry.js#L68) maps sport id -> emoji ball (`soccer`->⚽, `flag_football`/`american_football`->🏈, custom->🏅 medal fallback). `ProfileSportButton.jsx` is the existing precedent for rendering the sport ball as a UI glyph. Reuse `sportEmoji` for the handle; do NOT hardcode ⚽.

### Consumers of the single-video player (where the prop gets threaded)
`VideoControls` is rendered only by `MediaPlayer.jsx` (line 199) and `TutorialVideoModal.jsx`. `MediaPlayer` (`{ src, autoPlay, onClose, onEnded }` — no sport today) is the published-reel player, used by:
- `DownloadsPanel.jsx` — author's My Reels gallery (published reels)
- `SharedVideoOverlay.jsx` — **public** single-reel share viewer
- `RankingGame.jsx`, `ProjectManager.jsx` — author-side playback

`TutorialVideoModal` is NOT a published video — leave it on the plain dot (don't pass the prop).

### Where the publishing profile's sport comes from
The sport must be the **publishing profile's** sport, not the current viewer's, and not hardcoded. Two surfaces, two sources:
- **Author surfaces** (DownloadsPanel / RankingGame / ProjectManager): the active profile's sport is in `profileStore` (`profiles.find(p => p.id === currentProfileId)?.sport`), the same read `ProfileSportButton` uses. For published reels the profile that published == the active profile.
- **Public share** (`SharedVideoOverlay`): the viewer is anonymous, so sport must come from the **share payload**, frozen at publish/share time (see memory: "explicit names frozen into DB at publish" + gesture-based freeze). Precedent already exists: `sharing_db.py` snapshots `sharer_default_sport` on the shares row (postgres `v018_share_sharer_sport.py`, T2915 sport-inheritance family). INVESTIGATE whether the shared-reel API response already carries a sport field; if not, decide between (a) surfacing the existing `sharer_default_sport` snapshot through the share-playback response, or (b) freezing sport onto `final_videos` at publish (profile_db). Prefer reusing the existing snapshot over a new schema change — this task should stay no-migration if possible. If the public payload has no sport and adding one needs a migration, split that into a follow-up and ship the author surfaces first.

## Solution

1. **`VideoControls`**: add an optional `handleGlyph` (string emoji) prop. When present, render the glyph centered at the handle position instead of / on top of the purple dot (size tracks the existing coarse/hover sizing; keep it legible and vertically centered on the track). When absent, behavior is byte-identical to today.
2. **`MediaPlayer`**: accept an optional `sport` (or pre-resolved `handleGlyph`) prop and pass `handleGlyph={sportEmoji(sport)}` to `VideoControls`. Absent -> plain dot.
3. **Author consumers** (DownloadsPanel / RankingGame / ProjectManager): pass the active profile's sport from `profileStore` into `MediaPlayer`.
4. **Public consumer** (`SharedVideoOverlay`): pass the sport frozen in the share payload. If the payload lacks it, do the minimal backend surfacing of the existing `sharer_default_sport` snapshot (no new column) — else defer to a follow-up and leave the public viewer on the plain dot for now (no hardcoded soccer fallback for a non-soccer sharer).
5. **No fallback fabrication**: if sport is genuinely unknown, render the plain dot (today's look), do NOT default to soccer for a profile whose sport we don't know. Soccer only wins because a real soccer profile resolves to ⚽.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/shared/VideoControls.jsx` — the scrub-dot handle (lines 267-275); add optional `handleGlyph` prop, render glyph at handle position
- `src/frontend/src/components/MediaPlayer.jsx` — thread `sport`/`handleGlyph` -> VideoControls (line 199)
- `src/frontend/src/modes/annotate/constants/tagRegistry.js` — `sportEmoji(sport)` (reuse; do NOT hardcode ⚽)
- `src/frontend/src/components/ProfileSportButton.jsx` — precedent for reading `profileStore` sport + rendering the ball
- `src/frontend/src/components/DownloadsPanel.jsx` — author gallery: pass active profile sport
- `src/frontend/src/components/SharedVideoOverlay.jsx` — public share: pass frozen sport from payload
- `src/frontend/src/components/ranking/RankingGame.jsx`, `src/frontend/src/components/ProjectManager.jsx` — author playback: pass active profile sport
- (Backend, only if the public payload lacks sport) `src/backend/app/services/sharing_db.py` (`sharer_default_sport` snapshot already exists), share-playback response builder
- `src/frontend/src/components/shared/VideoControls.test.jsx` (add/create) or `MediaPlayer` test — assert glyph renders when prop present, plain dot when absent

### Landing-site guardrail (REQUIRED read)
Memory "Landing shares editor player": `VideoControls`/`useStandaloneVideo`/`timeFormat` are imported by the landing build via the `@editor` alias and MUST stay store-free. Keep the sport read in the app-side consumers; `VideoControls` only receives a plain string prop. Verify the landing build still compiles if you touch `VideoControls`' import surface.

### Related Tasks
- Pattern: T5100 (compilation timeline hover/click — sibling player-polish task, same player family)
- Sport freeze precedent: T2915 (sport inheritance via link snapshot), postgres `v018_share_sharer_sport`
- Precedent glyph UI: ProfileSportButton (T-series header sport control)

### Technical Notes
- M-tier, frontend-first, ~4-7 files. Frontend-only IF the public share payload already carries sport; if it needs a backend field, that public-surface piece may be a small backend add (reuse `sharer_default_sport`, no new column preferred) or a deferred follow-up. No migration if avoidable.
- MVC: `VideoControls` stays presentational (glyph is a prop); sport resolution lives in the app-side consumers. No reactive persistence — this is pure display, no writes.
- Keep the handle hit/drag behavior unchanged; the glyph is a visual swap for the dot, not a new interaction.
- Coarse-pointer / hover sizing already exists for the dot — mirror it so the ball stays finger-friendly and doesn't overflow the 3-6px track vertically.

## Implementation

### Steps
1. [ ] Add optional `handleGlyph` prop to `VideoControls`; render glyph at handle position, fall back to plain dot when absent (byte-identical to today)
2. [ ] Thread `sport`/`handleGlyph` through `MediaPlayer` -> `VideoControls`
3. [ ] Author consumers (DownloadsPanel/RankingGame/ProjectManager) pass active profile sport from `profileStore`
4. [ ] Public `SharedVideoOverlay`: pass frozen sport from share payload; if payload lacks it, surface existing `sharer_default_sport` (no new column) or defer that surface to a follow-up
5. [ ] Confirm landing build still compiles (VideoControls stays store-free)
6. [ ] Tests: glyph renders for a soccer profile (⚽) and a football profile (🏈); plain dot when sport unknown/prop absent; no hardcoded soccer fallback

### Progress Log

**2026-07-13**: Task created from user direction (screenshot: soccer-ball playhead handle on a published-video timeline). Investigation: single handle to swap is the scrub dot in the shared, store-free `VideoControls` (must stay store-free — landing reuses it via `@editor`); `sportEmoji()` already maps sport->ball; sport source is `profileStore` for author surfaces and the frozen `sharer_default_sport` snapshot for the public share viewer (reuse, prefer no migration). Consumers: MediaPlayer (DownloadsPanel/SharedVideoOverlay/RankingGame/ProjectManager). TutorialVideoModal excluded (not a published video).

## Acceptance Criteria

- [ ] On a published soccer reel, the timeline playhead handle is a soccer ball (⚽) that rides the progress as it plays and can still be dragged to seek
- [ ] The ball reflects the **publishing profile's sport** (e.g. a football profile shows 🏈), not a hardcoded soccer ball
- [ ] Works on both the author's My Reels player and the public shared-reel viewer (or the public surface is explicitly deferred with a documented follow-up, never a hardcoded soccer fallback)
- [ ] When sport is genuinely unknown, the handle falls back to today's plain dot — no soccer fabrication
- [ ] `VideoControls` stays store-free; the landing build still compiles
- [ ] No new interaction regressions (drag-to-seek, hover sizing, coarse-pointer target unchanged)
- [ ] Tests pass
