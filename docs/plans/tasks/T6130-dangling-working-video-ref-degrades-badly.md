# T6130: A dangling working-video ref degrades into a dead Overlay screen instead of the re-export prompt

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-07-27
**Found by:** T6100 and T6120 independently, during the 2026-07-27 staging E2E investigation

## The shape

`GET /api/projects/{id}/working_video/playback-url`
(`app/routers/projects.py:1172`, `get_working_video_playback_url`) resolves
`working_videos.filename` from the DB and returns a presigned R2 URL. It **never checks that the
object exists** — `_generate_working_video_presigned_url` only fails if presigning itself fails,
which it does not for a missing key. So a row whose R2 object is gone yields a cheerful **200 with
a URL that 404s**.

What the user then sees (traced by T6100/T6120, verified against source):
`OverlayScreen.effectiveOverlayVideoUrl = workingVideo?.url` (`OverlayScreen.jsx:204`) feeds the
export-button gate (`OverlayModeView.jsx:836`). `extractVideoMetadataFromUrl` fails on the 404,
`workingVideo` never hydrates, and because `project.working_video_url` stays truthy,
`shouldWaitForWorkingVideo` stays true — so `effectiveOverlayVideoUrl` stays **null forever**. The
Overlay export panel never mounts, "Export required" never appears, and the retry can never
succeed. A permanent spinner, not an error.

The app already HAS a graceful state for this: the **T5440 "re-export to rebuild"** prompt. The
dangling-ref path just never reaches it.

## Measured blast radius (do not re-derive — verified 2026-07-27)

> **CORRECTION 2026-07-27 (supervisor).** An earlier version of this section claimed prod held one
> dangling `working_videos` ref. **That was wrong.** The audit constructed R2 keys as
> `users/{uid}/profiles/{pid}/...`, omitting the mandatory environment prefix — the real scheme is
> `{APP_ENV}/users/{uid}/profiles/{pid}/...` (`storage.py:279`, and `APP_ENV` is `production` on
> prod, `staging` on staging). Every HEAD therefore 404'd, and with exactly one row present it
> reported "1 of 1 dangling". Re-audited with the correct prefix:
> **prod = 87 media rows (final_videos + working_videos) across all profiles, 0 dangling.**
> Prod is clean. Any prod-impact argument built on the old number is void.

- **Prod:** **0 dangling** out of 87 media rows. Not affected.
- **Staging:** 3 of 5 pre-framed drafts (31, 33, 51) dangle; the freshest (37, 54) are intact.
- **Staging, final_videos too (found 2026-07-27 by a real user report):** `imankh` profile
  `9fa7378c` has 41 `final_videos` rows and **1 dangling** — fv_id 41, project 31,
  *"Brilliant Control"*, `final_31_eda94512.mp4` → 404 while the other 94 objects under
  `staging/users/.../final_videos/` are present. So the dangling class is not confined to
  intermediate working videos; it reaches **published reels**, where the user-visible symptom is a
  black player with `MEDIA_ELEMENT_ERROR: Format error` / `NotSupportedError: no supported sources`.
  Note project 31 is dangling on BOTH its working video and its final video.
- **No code path deletes `working_videos/*.mp4`** — checked across `clips.py`, `overlay.py`,
  `project_archive.py` and the sweep. The dangling refs are env-copy/wipe provenance, not something
  the app does.

That last point is why this is Impact 5 and not 8: the *cause* is not prod-reachable. What IS
prod-reachable is the **degradation**, if a ref ever dangles for any reason (a failed upload, a
partial restore, a future bug).

## The tension you must resolve — read before choosing a fix

CLAUDE.md § *No Defensive Fixes for Internal Bugs* says do not add defensive code to work around
bugs in code we control — fix the source. **A blind "HEAD before presign, else pretend there's no
working video" is exactly the defensive fallback that rule forbids**, and it would also add an R2
round-trip to a hot path.

But there is a real distinction here: the object store is an **external** dependency, and "the
artifact this row points at no longer exists" is a genuine external-failure state, not an
impossible internal one. The rule's own carve-out is that defensive handling is appropriate for
things outside our control.

So the question this task must answer, explicitly: **is a dangling ref an invariant violation we
should make loud, or an external condition we should degrade gracefully on?** Argue it, then build
to the answer. Candidate shapes, none pre-blessed:

1. Verify on the read path and return a distinct signal (e.g. 404 with a `reason` the frontend maps
   to the existing T5440 re-export state) — graceful, costs a HEAD.
2. Leave the endpoint alone and fix the **frontend gate** so a failed metadata extraction resolves
   `shouldWaitForWorkingVideo` to false and falls through to T5440 — no extra R2 call, and it fixes
   the whole class of "URL returned but unloadable".
3. Make it loud: log CRITICAL and surface an explicit error, on the argument that a dangling ref
   means something upstream is broken and silence is how it stayed unnoticed.

Option 2 is the cheapest and closest to "fix the real gate", but do not take that on faith —
check whether anything else depends on `shouldWaitForWorkingVideo` staying true.

## Watch out for

- Do NOT add a HEAD to every playback-url call without measuring the cost; this is on the Overlay
  open path. If you go that route, show the latency delta.
- The sibling `clips.py:get_clip_playback_url` (`:1904`) has the same shape. Decide whether it needs
  the same treatment and say so either way — do not silently fix one and leave the other.
- Do not "repair" the prod dangling row as part of this task. That is a data operation and the
  user's call; this task is about behaviour when a ref dangles.
- T6110 is hardening the E2E specs around video readiness. Coordinate: this task must not make
  those specs' readiness signal ambiguous.

## Acceptance criteria

1. A written answer to the invariant-vs-external question, with the CLAUDE.md rule addressed
   head-on rather than ignored.
2. The chosen fix, with a test proving a dangling ref now reaches a *terminal, actionable* state
   (the T5440 re-export prompt or an explicit error) instead of an infinite wait.
3. A stated decision on `clips.py:get_clip_playback_url`.
4. If a HEAD is added anywhere on a hot path, the measured latency cost.
