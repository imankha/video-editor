# T4780: New-User-Flow Quests — "Watch the tutorial" as Step 1 of every quest

**Status:** TODO
**Impact:** 8
**Complexity:** 6
**Priority:** P1
**Created:** 2026-07-05
**Updated:** 2026-07-08

## What we're building (read this first)

We now have four narrated tutorial videos — one per quest of the new-user flow
(annotate → framing → overlay → publish). They are already produced and uploaded.
Your job is to make **watching the right video the FIRST step of each quest**, with a
player the user can launch directly from that quest step.

The player is YouTube-like: a custom control bar with a **playback-speed menu (default
0.75x** — 1x narration runs too fast), a **draggable scrub bar**, a **subtitles toggle**,
and **chapters** so a user can jump straight to the part they care about. See the Player
component step for the full control-bar spec.

You do NOT need to create or edit any videos. They already exist and get re-uploaded
to the same URLs whenever they're re-recorded, so never hard-code anything about their
content (lengths, thumbnails, etc.) — just play them.

## The assets (already uploaded)

R2 bucket `reelballers-assets`, one set per quest:

| Quest | Video | Subtitles (WebVTT) | Chapters (WebVTT) |
|---|---|---|---|
| annotate | `tutorials/annotate.mp4` | `tutorials/annotate.vtt` | `tutorials/annotate.chapters.vtt` |
| framing | `tutorials/framing.mp4` | `tutorials/framing.vtt` | `tutorials/framing.chapters.vtt` |
| overlay | `tutorials/overlay.mp4` | `tutorials/overlay.vtt` | `tutorials/overlay.chapters.vtt` |
| publish | `tutorials/publish.mp4` | `tutorials/publish.vtt` | `tutorials/publish.chapters.vtt` |

All MP4s are 1920×1080, H.264 + AAC, `+faststart` (they begin playing before fully
downloaded). The `.vtt` files are the subtitle tracks — same base name as the video.

**Chapters are a WebVTT `kind="chapters"` file, NOT config.** Chapter timestamps are
per-video content that drifts every time a tutorial is re-recorded, so they must live in a
`*.chapters.vtt` the tutorial pipeline emits and re-uploads alongside the mp4/subtitle
(same self-updating contract as the subtitle track). The frontend just loads whatever
`*.chapters.vtt` is at the URL — never hard-code chapter titles or times.

> **Dependency (separate repo):** `ReelBallersTutroials/` (see its `WORKFLOW.md` +
> `workflow/upload_r2.py`) must produce and upload a `*.chapters.vtt` per quest video. If
> a chapters file is absent for a given video, the player must degrade gracefully (no
> chapter markers, everything else works) — do NOT hard-code a fallback chapter list.

**First sub-task:** figure out with the team how the app should serve these files
(this bucket is separate from the user-data bucket `reel-ballers-users`). Two options —
confirm which one we want before writing code:
1. Make `reelballers-assets` public behind a domain (e.g. `assets.reelballers.com`)
   and use plain URLs, or
2. Add a tiny backend endpoint that 302-redirects/presigns `GET /api/assets/tutorials/{name}`.
Do not copy the user-media presign helpers blindly — these are static shared assets, so
long cache lifetimes and a public URL are fine (there is nothing private in them).

## Step-by-step

1. **Config.** Add a single source of truth mapping quest id → `{videoUrl, vttUrl, title}`
   (e.g. in `src/frontend/src/config/questDefinitions.jsx`, where the quest steps live).
2. **Player component.** Build `TutorialVideoModal` (one shared component).

   **Use a CUSTOM control bar, not native `<video controls>`.** Native controls can't do a
   consistent cross-browser speed menu and can't render chapter markers on the scrubber —
   both are required here. Extend the existing shared `VideoControls`
   (`src/frontend/src/components/shared/VideoControls.jsx`, already used by
   `MediaPlayer.jsx`) rather than building a bar from scratch; it already has the scrubber,
   play/pause, volume, fullscreen, keyboard shortcuts, and auto-hide. Render `<video>` with
   `playsInline` and NO `controls` attribute.

   The bar must have (YouTube as the reference for layout/behavior):

   - **Scrubber / seek bar.** Already in `VideoControls` (`onSeek`). Draggable, shows
     current time / duration, buffered range if easy. Chapter ticks overlay on top (below).
   - **Playback speed control.** YouTube-style menu with `0.5 / 0.75 / 1 / 1.25 / 1.5 / 2`.
     **Default 0.75x** (1x runs too fast for narration) — set `video.playbackRate = 0.75`
     on load. Selecting a rate updates `playbackRate`; show the active rate in the button.
   - **Subtitles (CC) toggle.** `<track kind="subtitles" srcLang="en" label="English"
     src={vttUrl} default>`; CC button flips `video.textTracks[i].mode` between `'showing'`
     and `'hidden'` (find the subtitles track by `kind`, don't assume index 0 — the
     chapters track is also a textTrack). **Default ON** so a muted viewer still gets value.
   - **Chapters.** Load `<track kind="chapters" src={chaptersUrl}>` (if present). Read its
     cues (`textTracks[i].cues`, `kind === 'chapters'`) and:
       - Render a tick/segment marker on the scrubber at each chapter start; hovering/tapping
         a marker shows the chapter title and seeks to it on click.
       - Optionally a small chapter menu (list of titles) that seeks on select — this is the
         "let users jump to the info they want" ask. A menu is the higher-value half if you
         have to pick one; scrubber ticks are the polish.
       - If no chapters file loads, hide all chapter UI (no markers, no menu). Do not fake it.
   - **Fullscreen button**, Escape/X to close (already in `MediaPlayer`/`VideoControls`).
   - Mobile: the video is a 16:9 desktop-UI capture. Embedded at portrait width the text
     is small — that's expected; make sure tap-to-fullscreen works (do NOT crop or zoom).
     The speed/chapters menus must be tap-friendly, not hover-only.
   - Don't autoplay with sound (mobile browsers block it). Either wait for a tap on a
     big play button, or autoplay muted with a "tap for sound" affordance.

   Note: `VideoControls` today has no CC / speed / chapters affordances — those are the new
   parts. Add them to the shared component (behind props so `MediaPlayer` is unaffected) or
   compose a tutorial-specific control bar around it; keep `MediaPlayer`'s behavior intact.
3. **Quest integration.** In the quest-step definitions, add a new FIRST step to each of
   the four quests: "Watch the {quest} tutorial (60s)". The step renders a button/link
   that opens `TutorialVideoModal` with that quest's entry.
   - Mark the step complete when the user has opened the video and either watched ≥80%
     (`timeupdate` listener) or closed it after at least 10s. Persist completion the same
     way the other quest steps persist theirs (look at how existing steps record
     completion in the quest state — copy that pattern, don't invent a new one).
4. **Analytics (if the quest panel already logs step events)**: log open / complete with
   the quest id, same shape as existing step events.

## Acceptance criteria

- [ ] Each of the 4 quests shows "Watch the tutorial" as its first step, launchable from
      the quest panel.
- [ ] Video plays in the modal on desktop Chrome + Safari and on a phone (fullscreen OK).
- [ ] Custom control bar (not native `controls`) with a draggable scrub/seek bar.
- [ ] Playback-speed menu (0.5–2x, YouTube-style); **defaults to 0.75x** on load.
- [ ] Subtitles render and can be toggled on/off by the user; default is ON.
- [ ] Chapters: when a `*.chapters.vtt` is present, the user can jump to a chapter (menu
      and/or scrubber markers); when absent, chapter UI is hidden and playback still works.
- [ ] Step completion persists (revisit the quest → step still checked).
- [ ] No hard-coded video content — durations, thumbnails, chapter titles/times: all come
      from the assets (config holds only the URL map).
- [ ] Videos still play when re-uploaded (no cache-busting bugs — assets are served with
      `Cache-Control: public, max-age=3600`).

## Context

### Relevant files
- `src/frontend/src/config/questDefinitions.jsx` — quest step definitions (the NUF copy
  already references UI like the Add Clip button; add the watch-step here)
- `src/frontend/src/components/QuestPanel.jsx` — quest step rendering
- `src/frontend/src/components/MediaPlayer.jsx` — existing video modal to crib from
  (but note it has no subtitle/track/speed/chapters support — that's the new part)
- `src/frontend/src/components/shared/VideoControls.jsx` — shared control bar to extend
  (scrubber/play/volume/fullscreen already here; CC + speed + chapters are the additions)

### How the videos are made (background only)
The tutorials are generated by Playwright capture specs + a build pipeline in
`ReelBallersTutroials/` (see its WORKFLOW.md). Re-recording re-uploads to the same R2
keys via `workflow/upload_r2.py`, so this feature never needs code changes when the
videos change. **New pipeline requirement (chapters):** the pipeline must also emit and
upload a `*.chapters.vtt` per quest video (WebVTT `kind="chapters"`) so chapter markers
stay in sync on re-record. Until it does, the player simply renders no chapters.
