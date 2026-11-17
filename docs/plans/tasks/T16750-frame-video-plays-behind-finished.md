# T16750: Frame video plays behind Finished

**Status:** STAGING
**Impact:** 5
**Complexity:** 2
**Created:** 2026-11-16
**Updated:** 2026-11-16

## In plain words

**Today.** In Frame (the step where the parent crops around their athlete and pays to sharpen), a parent often presses Preview and then "Sharpen my highlight" while the preview is still playing. When the sharpened highlight is ready, the Finished screen opens on top. Behind it, the Frame editor's video keeps playing, unmuted at full volume, looping the play.

**The problem.** Found in the staging QA pass on 2026-11-16. Two seconds after the Finished screen opened, the hidden Frame video was still advancing (16.3 s to 18.3 s), `muted: false`, volume 1. The Finished player's own video had already ended. With a game that has sound, the parent hears game audio from a video they cannot see, over or after their new highlight. It stops only when they leave the screen (opening Spotlight paused it).

**What we will do.** Pause the Frame editor's video when the Finished screen opens over it, the same way any other full-screen player takes over playback.

**Why this and not something else.** Muting alone would still burn decoding and battery on phones for a hidden video; pausing is what a parent expects.

**How we will know it worked.** Start Preview in Frame, press Sharpen while it plays, wait for Finished: no video other than the Finished player is playing (every other video element is paused).

## Evidence (staging, build 94928afa1, account e2e@test.local)

- Project 13, 1440x900. Preview playing, then "Sharpen my highlight". After the render, the Finished overlay was shown.
- Page had two videos: the 810x1440 working video (Finished, ended at 8.03 s) and the 1920x1080 game video (Frame editor) with `paused: false, muted: false, volume: 1`, advancing.
- The test fixture had no audio track, so this was observed from the element state, not heard.

## Implementer notes

- Frame screen: `src/frontend/src/screens/` (Framing / "focus" route `/focus/p/{id}`), its preview player, and the Finished overlay that opens after an export.
- Knowledge docs: `.claude/knowledge/keyframes-framing.md`, `.claude/knowledge/export-pipeline.md`.

## Acceptance Criteria

- [ ] With Preview playing, Sharpen, then Finished opens: the Frame video is paused (browser check reading every `<video>` element's `paused`).
- [ ] Closing Finished back to Frame does not auto-resume the Frame video.
