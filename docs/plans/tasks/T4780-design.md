# T4780 — "Watch the tutorial" as Step 1 of every quest — Design

**Status:** DESIGN — awaiting approval
**Tier:** L (Frontend + Backend, ~10 files, new shared component + new quest steps/achievements)
**Branch:** `feature/T4780-quest-tutorial-videos`

## Summary

Make "Watch the tutorial" the FIRST step of each of the 4 new-user-flow quests. Each
step renders a button that opens a shared `TutorialVideoModal` playing that quest's
narrated video (served as a plain static URL from a public assets domain). The modal
reuses the existing `VideoControls` bar, extended (behind optional props) with a
playback-speed menu (default **0.75x**), a subtitles/CC toggle (default **ON**), and
chapter markers/menu driven entirely by a `*.chapters.vtt` sidecar. The step completes
via a gesture-driven achievement (`recordAchievement`) when the user watches ≥80% or
closes after ≥10s — no reactive persistence. No schema change, no migration.

## The 4 new steps / achievements (1:1 per quest)

| Quest | id | New first step_id | Achievement key | Video base name |
|---|---|---|---|---|
| Get Started | quest_1 | `watch_annotate_tutorial` | `watched_annotate_tutorial` | `annotate` |
| Frame Your Highlight | quest_2 | `watch_framing_tutorial` | `watched_framing_tutorial` | `framing` |
| Configure Your Spotlight | quest_3 | `watch_overlay_tutorial` | `watched_overlay_tutorial` | `overlay` |
| Publish Your Reel | quest_4 | `watch_publish_tutorial` | `watched_publish_tutorial` | `publish` |

Asset URLs (relative to `ASSETS_BASE`): `tutorials/{base}.mp4`, `tutorials/{base}.vtt`,
`tutorials/{base}.chapters.vtt`.

---

## 1. Backend quest steps

**`src/backend/app/quest_config.py`** — prepend the new step_id as the FIRST entry of each
quest's `step_ids`:
- quest_1: `["watch_annotate_tutorial", "upload_game", ...]`
- quest_2: `["watch_framing_tutorial", "open_framing", ...]`
- quest_3: `["watch_overlay_tutorial", "open_overlay", ...]`
- quest_4: `["watch_publish_tutorial", "export_overlay", ...]`

`QUEST_BY_ID` / `ALL_STEP_IDS` are derived, so they update automatically.

**`src/frontend/src/data/questDefinitions.js`** — mirror the same four prepends (this is
the frontend copy the store seeds from; it must match the backend's `/definitions`).

**`src/backend/app/routers/quests.py`** — add the 4 keys to the three registries and the
step derivations:
- `KNOWN_ACHIEVEMENT_KEYS`: add the 4 `watched_*_tutorial` keys (so `record_achievement`
  accepts them).
- `_STEP_ACHIEVEMENT_KEYS`: add the 4 keys (so they ride the ONE existing batched
  `SELECT key FROM achievements WHERE key IN (...)` query — no new query).
- `ACHIEVEMENT_TO_MILESTONE`: map each `watched_{q}_tutorial` -> `watched_{q}_tutorial`
  (this is the analytics bridge; `record_achievement` already logs a milestone when a key
  is present here, so no separate analytics event is needed — decision 5).
- `_check_all_steps()` — add 4 lines, each deriving the step purely from its achievement:
  ```python
  steps["watch_annotate_tutorial"] = 'watched_annotate_tutorial' in achieved
  steps["watch_framing_tutorial"]  = 'watched_framing_tutorial' in achieved
  steps["watch_overlay_tutorial"]  = 'watched_overlay_tutorial' in achieved
  steps["watch_publish_tutorial"]  = 'watched_publish_tutorial' in achieved
  ```

**Perf:** the 4 keys are added to the SAME `IN (...)` list, so `_check_all_steps` still runs
exactly its 4 aggregate queries. No N+1, no extra round-trips.

## 2. Existing users (no schema change -> no Migration agent)

- **Achievements table already exists**; we only add new *keys* to it (rows are created on
  demand by `record_achievement`). No `ALTER TABLE`, no new table -> Migration agent = No.
- **Claimed quests:** `get_progress()` overrides every step of an already-claimed quest to
  `True` (quests.py:240) and reports `reward_claimed: True`. So users who already finished a
  quest see the new step as complete and there is **no un-claim / no double-grant** — the
  claim path is gated by the `UNIQUE (user_id, source, reference_id)` index regardless.
- **Mid-flight users** (quest in progress, not yet claimed) get one new *incomplete* first
  step. They must open the tutorial once to re-complete the quest before claiming. **This is
  intended** — it's the whole point of the feature (surface the tutorial to in-flight users).
  No data is lost; their other step booleans are untouched.
- **Risk check:** none. The only way a step flips true is the new achievement key; the only
  way a quest un-claims is impossible (claimed quests are force-True). Confirmed no
  regression.

## 3. `VideoControls` extension (optional props — MediaPlayer untouched)

Add new **optional** props to `src/frontend/src/components/shared/VideoControls.jsx`. When
every new prop is absent, the component renders **identically to today** (MediaPlayer passes
none, so it is unaffected).

| Prop | Type | Behavior |
|---|---|---|
| `rates` | `number[]` | Speed menu options, e.g. `[0.5, 0.75, 1, 1.25, 1.5, 2]`. Absent -> no speed button. |
| `playbackRate` | `number` | Current rate shown on the button (e.g. "0.75x"). |
| `onPlaybackRate` | `(rate) => void` | Called when a rate is picked. |
| `hasSubtitles` | `boolean` | Absent/false -> no CC button. |
| `subtitlesOn` | `boolean` | Drives CC button active state. |
| `onToggleSubtitles` | `() => void` | Called on CC tap. |
| `chapters` | `[{startTime, title}]` | Absent or empty -> NO chapter ticks and NO chapter menu (degrade rule). |
| `onSeekChapter` | `(startTime) => void` | Seek to a chapter start. |

Rendering:
- **Speed menu:** a button in the right group showing the active rate; tap opens a small
  tap-friendly popup list (not hover-only) of `rates`. Reuses the existing right-group
  layout next to fullscreen.
- **CC button:** toggle button in the right group; active styling when `subtitlesOn`.
- **Chapter ticks:** absolute-positioned markers on the existing scrub track at
  `(startTime/duration)*100%`; tapping/clicking a tick calls `onSeekChapter`. A small
  chapter menu (list of titles) is the higher-value half and is included; ticks are the
  polish. Both only render when `chapters?.length > 0`.

The parent (modal) owns all this state; `VideoControls` stays presentational.

## 4. `TutorialVideoModal` (new shared component)

`src/frontend/src/components/TutorialVideoModal.jsx`. Cribs MediaPlayer's container/
fullscreen/auto-hide/keyboard scaffolding and reuses `useStandaloneVideo` for play/seek/
volume state. Differences:

- `<video playsInline>` with **NO `controls`** attribute (custom bar only). `object-contain`,
  no crop/zoom (mobile just shows the 16:9 capture smaller — tap-to-fullscreen handles it).
- Two `<track>` children:
  - `<track kind="subtitles" srcLang="en" label="English" src={vttUrl} default>`
  - `<track kind="chapters" src={chaptersUrl}>`
- On load (`onLoadedMetadata` / a `loadeddata` handler):
  - set `video.playbackRate = 0.75`.
  - **Find the subtitles track by `kind`** (iterate `video.textTracks`, match
    `track.kind === 'subtitles'`) — NOT index 0, because the chapters track is also a
    textTrack. Set its `mode = 'showing'` (default ON).
  - Read the **chapters** track's cues (match `kind === 'chapters'`); build
    `chapters = [{startTime, title: cue.text}]`. Chapter cues may load async — listen for
    the chapters track `load` / `cuechange` and re-read; if the file 404s or yields **no
    cues**, leave `chapters = []` so ALL chapter UI hides (no faked list).
- **Mobile autoplay:** do NOT autoplay with sound. Either a big play button (tap to start)
  or muted-autoplay + a "tap for sound" affordance. Mirror MediaPlayer's big-play-button.
- Fullscreen button + ESC/X to close (same handlers as MediaPlayer).
- Renders `<VideoControls>` wired to the new props: `rates`, `playbackRate`/`onPlaybackRate`
  (updates `video.playbackRate` + local state), `hasSubtitles`/`subtitlesOn`/
  `onToggleSubtitles` (flips the by-kind subtitles track `mode`), `chapters`/`onSeekChapter`
  (`seek(startTime)`).

No hard-coded durations, thumbnails, or chapter titles/times — all read at runtime from the
asset + its VTT sidecars.

## 5. Opening the modal + completion (gesture-driven)

- **`src/frontend/src/stores/useTutorialStore.js`** (tiny Zustand store): holds
  `openQuestId` (or null) + `openTutorial(questId)` and `closeTutorial()`. UI-only, never
  persisted.
- **`WatchTutorialButton`** (small component in `questDefinitions.jsx`, mirroring the
  existing `OpenReelLink` / `navigateToReelDrafts` pattern): a pill button whose `onClick`
  calls `useTutorialStore.getState().openTutorial(questId)`. Added to `STEP_DESCRIPTIONS` for
  each new step id, and titles added to `STEP_TITLES` (e.g. "Watch the tutorial (60s)").
- **Mount once at top level:** `<TutorialVideoModal>` mounts in `App.jsx` (same top level as
  `QuestPanel`), reads `openQuestId` from the store, looks up its config entry, renders when
  set.
- **Completion (gesture, NOT reactive):** the modal fires
  `useQuestStore.getState().recordAchievement('watched_{quest}_tutorial')` when either:
  - a `timeupdate` handler observes `currentTime/duration >= 0.80`, OR
  - the user **closes** the modal (X / ESC / backdrop) after having watched ≥10s
    (tracked via a ref on the video, checked in the close handler).

  Both are direct consequences of a user action (watching / closing) — there is **no
  `useEffect` that watches state and persists**. `recordAchievement` is already
  fire-and-forget, deduped, and drives the backend write + a `fetchProgress` refresh, so the
  step check re-renders. Analytics is handled by the achievement->milestone bridge from
  decision 1; no extra event.

## 6. Config map + `ASSETS_BASE` (RESOLVED: public static domain)

- **`src/frontend/src/config/tutorialVideos.js`** (new) — the ONLY place holding URLs:
  ```js
  const ASSETS_BASE = import.meta.env.VITE_ASSETS_BASE || 'https://assets.reelballers.com';
  const TUTORIAL_BASENAMES = {
    quest_1: 'annotate', quest_2: 'framing',
    quest_3: 'overlay',  quest_4: 'publish',
  };
  export function getTutorialAssets(questId) {
    const base = TUTORIAL_BASENAMES[questId];
    if (!base) return null;                       // no silent fallback — caller guards
    return {
      videoUrl:    `${ASSETS_BASE}/tutorials/${base}.mp4`,
      vttUrl:      `${ASSETS_BASE}/tutorials/${base}.vtt`,
      chaptersUrl: `${ASSETS_BASE}/tutorials/${base}.chapters.vtt`,
    };
  }
  ```
- **No backend asset endpoint, no presign** — the `reelballers-assets` bucket is exposed
  publicly at `https://assets.reelballers.com` (user configures Cloudflare custom domain +
  public access; not in scope here). `VITE_ASSETS_BASE` exists solely so QA can point at
  local fixtures (the real domain won't resolve in-container). Prod/staging use the default.
- Config holds ONLY base + per-quest basenames. Durations, thumbnails, chapter titles/times
  are never in config — they come from the asset/VTT at runtime.

---

## Files to change

| File | Change |
|---|---|
| `src/backend/app/quest_config.py` | Prepend 4 new first-step ids |
| `src/backend/app/routers/quests.py` | +4 keys in 3 registries; +4 lines in `_check_all_steps` |
| `src/frontend/src/data/questDefinitions.js` | Mirror the 4 prepends |
| `src/frontend/src/config/questDefinitions.jsx` | `STEP_TITLES` + `STEP_DESCRIPTIONS` + `WatchTutorialButton` |
| `src/frontend/src/config/tutorialVideos.js` (new) | `ASSETS_BASE` + `getTutorialAssets` |
| `src/frontend/src/components/shared/VideoControls.jsx` | Optional speed/CC/chapters props |
| `src/frontend/src/components/TutorialVideoModal.jsx` (new) | The modal |
| `src/frontend/src/stores/useTutorialStore.js` (new) | `openTutorial`/`closeTutorial` |
| `src/frontend/src/App.jsx` | Mount `<TutorialVideoModal>` once at top level |
| tests | Backend quest-step derivation + `/definitions` order; frontend E2E |

## Risks & open questions

- **R1 — `default` on two tracks / subtitles-by-kind:** Browsers differ on `TextTrack.mode`
  timing; cues can arrive after `loadedmetadata`. Mitigation: set subtitles `showing` by
  kind on load AND re-assert on the subtitles track's `load` event. (Design-level; verify
  in QA on Chrome + Safari.)
- **R2 — chapters async load:** `.chapters.vtt` cues may be empty at first read. Re-read on
  the chapters track `load`/`cuechange`; empty -> hide chapter UI. Covered by the "delete the
  fixture" QA case.
- **R3 — mobile autoplay policy:** muted-autoplay vs big-play-button. Design allows either;
  will implement big-play-button (matches MediaPlayer) to avoid a muted-first-impression.

**Open questions for approval:**
1. **Step title copy** — "Watch the tutorial (60s)" hard-codes "60s". Videos are ~60s but
   lengths drift on re-record and the task says never hard-code durations. Propose dropping
   the duration: **"Watch the tutorial"** (or per-quest, e.g. "Watch the Annotate tutorial").
   Confirm preferred wording.
2. **Big-play-button vs muted-autoplay** on mobile (R3) — confirm big-play-button is
   acceptable, or you'd rather it autoplay muted with a "tap for sound" chip.
