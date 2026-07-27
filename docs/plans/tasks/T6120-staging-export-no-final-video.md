# T6120: Staging export produced no final video in 480s, and the overlay-export panel never mounts

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-07-27
**Found by:** the full staging E2E on `81a6aad9`

## Two linked symptoms

**A — the export never finished.** `derisk-staging-export.qa.spec.js:83`
(`staging export pipeline + publish (smoke + durability)`) polls `projectState` for up to
**480 seconds** and then asserts:

```js
expect(proj?.has_final_video, 'pipeline produced a final video').toBeTruthy();   // :180
```

It failed — eight minutes of polling and no final video. This is **not** a harness timing artifact
the way the UI-readiness failures are (see T6110); it is a real render never completing.

**B — on the isolated re-run the same spec SKIPPED**, with:

```
[T5420][SKIP] draft id=51 ("Brilliant Pass") did not surface the overlay Export button on staging
within 60s. The Overlay export panel did not mount (framingVideoUrl not hydrated for a pre-framed
single-clip draft opened directly into Overlay). Seed a draft that reaches overlay-export, or file
the overlay-export-mount gap. See e2e/FIXTURE-CONTRACT.md.
```

That skip message names a **product gap** in plain language and has evidently been surfacing for a
while without being actioned — the message itself says "file the overlay-export-mount gap". This
task files it.

## What to work out

1. **Is `framingVideoUrl` failing to hydrate for a pre-framed single-clip draft opened directly
   into Overlay a real user-facing bug?** A user who opens such a draft straight into Overlay would
   get no export panel. If so, that is the actual defect and the E2E skip is just the messenger.
   Reproduce it as a real user before touching test code.
2. **Why did the export not complete in 480s?** Distinguish: never enqueued / enqueued but the
   worker never picked it up / Modal cold-start or failure / completed but `has_final_video` was
   never set (a DB-vs-artifact mismatch — that exact class caused T4010 and T4110). Check the
   backend `export_jobs` rows and the `[Publish]` / `[SYNC]` log markers for the attempt; the
   finalize path logs an explicit success boundary.
3. Only after 1 and 2: decide whether the spec needs changing at all.

## Watch out for

- **Do not "fix" this by raising the 480 s budget or by relaxing the assertion.** If exports can
  take longer than eight minutes on staging, that is the finding, and it needs to be stated with a
  measured number.
- `has_final_video` false while an MP4 exists in R2 is the **T4010 / T4020 class** (re-export
  destroying the previous final video; the redundant post-render save writing an empty "shadow"
  version). If you see that shape, stop and report — it is a data-loss class, not a test problem.
- Staging and prod are both at schema head (verified 2026-07-27), so this is not a migration-window
  symptom.
- This spec was edited on 2026-07-26 to stop a polling probe leaking across tests (`probeRunning`
  guard). Do not revert that.
- Related but SEPARATE: T6100 owns the general video-stage hydration question. If your root cause
  turns out to be the same one, say so and coordinate rather than fixing it twice.

## Acceptance criteria

1. A verdict on the overlay-export-mount gap: real user-facing defect or fixture-only artifact,
   with a real-user reproduction attempt either way.
2. A verdict on the 480 s export failure, naming which stage stalled, with evidence from
   `export_jobs` and/or the render logs.
3. If either is a product defect: the defect named precisely, and reported BEFORE any fix — it may
   block a prod deploy.
4. If the spec changes, the change makes failures more diagnostic, not more tolerant.
