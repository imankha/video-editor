# Clip Upload & Reel Completion

**Status:** WIP
**Started:** 2026-09-04
**Created:** 2026-09-04 (split out of Tutorial Redesign, user order)

## Note on file layout

This epic's four tasks are **not** physically relocated into this folder — they stay at
`docs/plans/tasks/T8390-focus-publish-exit.md`, `T8400-publish-lands-on-reel.md`,
`T8370-precut-clip-upload.md`, `T8380-clips-screen-add-video.md` — because multiple other
files (T8545, T8540, T7620-design.md, T7630, T7640) already reference those exact paths,
and a mechanical file move buys nothing here. This EPIC.md exists purely to give the
grouping a home page and completion criteria, per the task-management skill's epic
convention.

## Goal

Two related product gaps in the create-to-publish flow, both diagnosed during the T7620
guided-tour design round but real regardless of whether the tour ships:

1. **Publish-flow dead ends.** Focus has no visible path toward publishing after a user
   finishes framing (T8390); publishing doesn't land the user on the result with share at
   hand (T8400).
2. **No pre-cut clip upload.** The app only ingests full games; a user arriving with
   already-cut clips (phone captures, Veo/Trace exports, clips from other parents) has no
   real entry point and has burned credits uploading 15-second clips as nonsense "games"
   (T8370 + its UI entry point T8380).

## Why split from Tutorial Redesign

T8390/T8400/T8370/T8380 were filed FROM the T7620 guided-tour design round (the tour needs
each of them live to anchor its steps to), but none of them build any tutorial UI — each
task file independently argues its own product value ("standalone... a product win on its
own" for T8390/T8400; a real observed failure mode for T8370). Bundling them under
"Tutorial Redesign" made them read as tutorial-scoped work and buried their own merit.
Split 2026-09-04 per user request. The dependency direction is unchanged: T7630/T7640 still
wait on these tasks landing (recorded in the Tutorial Redesign epic's own rows) — splitting
the epic doesn't change what blocks what, only how the roadmap represents it.

## Tasks

Row order = dependency order (T7620-design.md 18.3: R3, R4 -> T8370 -> T8380).

| ID | Task | Status |
|----|------|--------|
| T8390 | [Focus gets a publish exit](../T8390-focus-publish-exit.md) | WIP |
| T8400 | [Publishing lands the user on the reel they just made](../T8400-publish-lands-on-reel.md) | TODO |
| T8370 | [Pre-cut clip upload support](../T8370-precut-clip-upload.md) | WIP |
| T8380 | ["Add Video" button on the Clips screen](../T8380-clips-screen-add-video.md) | TODO |

## Sequencing / file-ownership notes

- **T8390 (Focus publish exit): SHIPPED 2026-09-04** (PR #329) — preview-first action bar
  with one-tap Publish. T8370 (backend upload/clip-source work): SHIPPED (PR #328).
- T8380 and T8400 both touch `ProjectManager.jsx` and the published-reels surface — now
  **`PublishedReelsPanel.jsx`** (renamed from DownloadsPanel by
  [T8555](../first-reel-funnel/T8555-published-tab-and-highlights-multiclip-only.md), which
  **SHIPPED 2026-09-04**, PR #335, replacing the old T8545 three-tab redesign with the
  four-tab IA). **The landing surface has LANDED — no wait remains** for either task's
  container implementation; both just need to build against the shipped four-tab structure
  (Games / In Progress Clips / In Progress Reels / Published).
- T8380 depends on T8370 (the upload capability it exposes — SHIPPED).

## Pre-flight finding (2026-09-04, UPDATED)

T8390 SHIPPED tonight (preview-first one-tap Publish). **T8400 may now be fully closed** —
T8390's `openFinishedReel` landing + T8555's `setActiveTab('published')` publish-landing
effect together cover most of "land the user on the published reel with share at hand." Its
task file carries an updated pre-flight note to re-verify against the shipped code before
designing or implementing — closing T8400 as already-satisfied (with evidence recorded) is a
valid, expected outcome, not a shortcut.

## Completion Criteria

- [x] A user finishing in Focus has a visible, one-tap path toward publishing (**T8390
      SHIPPED** — preview-first action bar, one-tap Publish)
- [ ] A successful publish lands the user on the reel with share at hand (T8400, or
      confirmed already true post-T8390/T8530/T8540/T8555 — likely the latter, re-verify)
- [ ] An uploaded pre-cut clip becomes a clip ready for Focus/publish, no full-game
      semantics, no wrapper-game visible to the user (T8370)
- [ ] "Add Video" on the Clips tab is a real, reachable entry point for a zero-content
      account (T8380)
