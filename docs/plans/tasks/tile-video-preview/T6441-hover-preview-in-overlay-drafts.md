# T6441: Extend Hover Preview to "In Overlay" Drafts

**Status:** TODO
**Impact:** 5 | **Complexity:** 2
**Epic:** [Tile Video Preview](EPIC.md) — child 4 (follow-up, filed after T6420 shipped)
**Follows:** [T6420](T6420-preview-primitive-desktop-hover.md) — the primitive + wiring this extends,
merged to master 2026-08-10 (STAGING)

## Problem

T6420 gates the inline hover preview on `project.final_video_id` — a draft only gets a preview
once it has a fully rendered FINAL video (state = "Ready"/"Done"). Confirmed working correctly
on staging 2026-08-10. But that's a narrower gate than it needs to be: a draft in **"In
Overlay"** status (`project.has_working_video === true`, framing already exported, sitting in
Overlay before its final export) already has a real rendered video — the WORKING video — with
its own existing same-origin streaming proxy. There's no reason hover preview can't use it too.

**"Not Started" drafts are explicitly OUT of scope** (user decision 2026-08-10) — no rendered
artifact exists at that stage (no working video, no final video), so a preview there would mean
streaming raw unedited source footage in an unknown framing/aspect, a materially different and
not-obviously-useful feature. Not filed.

## Solution

Extend `DraftTile.jsx`'s `previewStreamUrl` to fall back to the working-video stream when there's
no final video yet:

```js
// current (T6420):
const previewStreamUrl = project.final_video_id && !isPreviewing
  ? `${API_BASE}/api/downloads/${project.final_video_id}/stream`
  : null;

// extended:
const previewStreamUrl = isPreviewing
  ? null
  : project.final_video_id
    ? `${API_BASE}/api/downloads/${project.final_video_id}/stream`
    : project.has_working_video
      ? `${API_BASE}/api/projects/${project.id}/working_video/stream`
      : null;
```

No backend change needed — `GET/HEAD /api/projects/{project_id}/working_video/stream`
(`projects.py:1074`) already exists, already same-origin-proxied (same 6-socket-stall fix as the
downloads endpoint), already forwards Range headers correctly, already self-contained MP4 (no
byte-windowing needed, per its own docstring comparing it to the GB-scale-game clip case). It's
literally the same shape as the final-video endpoint T6420 already streams from — this task is
wiring, same as T6420 itself was.

`useTilePreview`/`TilePreviewVideo` need NO changes — they're already stream-URL-agnostic (take
whatever URL the host tile hands them). `ReelTile.jsx` needs NO changes — published reels always
have a final video, this fallback never applies there.

**Explicitly out of scope:** the separate "Preview video" button + full-screen `MediaPlayer`
modal (`DraftTile.jsx` `isPreviewing`/`createPortal` block) is a DIFFERENT feature gated the same
way today (`isComplete && project.final_video_id`) — this task does not touch it. If the user
wants that extended too, that's its own follow-up.

## Context

### Relevant Files
- `src/frontend/src/components/DraftTile.jsx` — `previewStreamUrl` computation (the one line to
  change), `project.has_working_video`/`project.id` already available on the same `project` prop
- `src/backend/app/routers/projects.py:1074` — `stream_working_video`, reused as-is
- `src/backend/app/routers/projects.py:33-50` — `get_working_video_url`, documents why this proxy
  pattern exists (same rationale T6420's endpoint already relies on)

### Related Tasks
- Builds on: [T6420](T6420-preview-primitive-desktop-hover.md) (the primitive)
- Epic siblings: T6430 (touch — will need this same fallback once built), T6440 (setting)

## Classification hint
S/M-tier, frontend-only, one file's gating logic. No schema, no new component, no backend work —
reuses an existing endpoint verbatim. Low risk.

## Implementation

### Steps
1. [ ] Extend `previewStreamUrl` in `DraftTile.jsx` per the Solution section
2. [ ] Unit test: an "In Overlay" draft (`has_working_video=true`, no `final_video_id`) resolves
       `previewStreamUrl` to the working-video endpoint; a "Ready"/"Done" draft still prefers the
       final-video endpoint when both exist (shouldn't happen in practice, but assert the
       precedence anyway); a "Not Started"/"Framing" draft still resolves to `null`
3. [ ] Real-browser verification: hover an actual "In Overlay" draft tile, confirm warm/reveal/
       crossfade behaves identically to the T6420 QA evidence (network request timing, single-
       active registry, teardown on leave)

## Acceptance Criteria

- [ ] Hovering an "In Overlay" draft tile shows the same warm-at-~100ms/reveal-at-~450ms
      poster-first preview as a "Ready" draft, sourced from its working video
- [ ] "Ready"/"Done" drafts and My Reels tiles are unaffected (still use the final-video stream)
- [ ] "Not Started"/"Framing" drafts still show no preview (unchanged, no rendered video exists)
- [ ] No backend changes; `stream_working_video` reused unmodified
- [ ] Tests pass
