# T5650: "Prepare" stage — large & messy footage ingest (DESIGN SPIKE first)

**Status:** TODO
**Impact:** 6
**Complexity:** 8
**Created:** 2026-07-20
**Updated:** 2026-07-20

> **This task is a design spike, not a blind implementation.** Deliverable of the first pass is a
> spec + a recommended technical approach for user sign-off. Do NOT start building an ingest
> pipeline before the fork below is decided. Implementation is split out once the approach is
> chosen.

## Problem

Three real ingest problems, surfaced by user feedback (2026-07-20) alongside the rotation request:

1. **Files too big to upload.** The user has a 62GB folder of DJI Action 6 footage
   (`C:\Users\imank\projects\video-editor\formal annotations\ECNL Test - DJI Action 6`) that
   needs to be **cropped, trimmed, and assembled** before it's usable — and is far too large to
   upload as-is.
2. **Many raw clips need assembling** into one game before Annotate (e.g. all videos in a folder
   concatenated into a single source).
3. **Issues discovered too late.** Arshia didn't notice his tilted footage until *Framing* —
   after upload. Problems (tilt, framing, black bars, wrong aspect) should be catchable earlier.

**The governing constraint (user's words):** *"I only want users to suffer this complexity if
they need to."* A mandatory pre-Annotate stage would tax the ~95% of users (clean Veo footage)
who don't need it. So the answer is **progressive disclosure**, not a new required step.

## Solution (UX direction — to be firmed up in the spike)

**Principle: an OPTIONAL "Prepare" workspace that only appears when the input demands it.** Clean
single-file uploads flow exactly as today, zero friction. Messy/large inputs get routed into
Prepare.

### Proposed pieces (spike decides which ship, in what order)

1. **Smart ingest triage at add-time.** When files are added, cheaply inspect count, total size,
   resolution, duration, aspect, and obvious issues (tilt via a horizon check on a few sampled
   frames; black bars). Single normal file → today's flow. Oversized / many-files / detected-issue
   → suggest Prepare. This is the "auto-detect" the user asked for.
2. **Client-side "Prepare" workspace (opt-in, auto-suggested).** Dump many files → trim each →
   crop → reorder → **concatenate into one game source**, mostly client-side so only the trimmed/
   assembled result uploads. Feels like *"cutting the raw dump down into the game,"* not
   *"editing."* This is the primary answer to the 62GB problem: you never upload 62GB.
3. **Fix-it-early hooks.** Surface detected tilt with a nudge → route to the Framing rotation fix
   (**T5640**). Rotation-in-Framing already covers "fix tilt after upload," which lowers the
   urgency of doing it pre-upload.

### The technical fork (SPIKE MUST RESOLVE — pick one primary, note fallbacks)

| Approach | Handles 62GB? | Cost | Notes |
|---|---|---|---|
| **ffmpeg.wasm / WebCodecs, client-side** | Trim + concat via **stream-copy** (no re-encode) = cheap & fast even on huge files; only compression/re-encode is expensive | Browser memory/streaming limits on 62GB inputs are the risk | Best "no upload of raw" story; validate stream-copy trim/concat on a real 62GB DJI file |
| **Resumable / chunked background upload** (infra floor) | Yes — raw file *can* get in (resumable, chunked, background), trim/assemble server-side | Server storage + bandwidth for raw; slow | Simplest UX; doesn't dodge the 62GB transfer |
| **Modal server-side transcode** | Yes, after upload | GPU/compute $ | Reuse existing Modal pipeline; pairs with resumable upload |
| **Desktop / CLI companion uploader** | Yes, best for power users w/ 62GB | Build + maintain a second artifact | Heaviest lift; only if this cohort matters |

Likely recommendation to validate: **client-side stream-copy trim+concat as the default**
(never upload raw), with **resumable upload + server transcode** as the fallback for inputs the
browser can't handle. Confirm against a real 62GB file before committing.

## Context

### Relevant Files (to be filled by the spike)
- Upload / add-game entry points (Annotate ingest, game creation).
- Existing Modal export pipeline (reuse for any server-side transcode).
- `.claude/knowledge/annotate.md`, `export-pipeline.md`, `modal-gpu.md` — load before exploring.

### Related Tasks
- **T5640** (Framing rotation) — same feedback thread; the "fix tilt in Framing" answer that
  reduces how much Prepare must catch up-front.
- Likely becomes an **epic** (triage detection, Prepare workspace, client transcode, resumable
  upload) once the approach is chosen — this task is the design gate for that epic.

### Technical Notes / Open Questions
- **Target audience reality check** (memory: highly-engaged soccer parents, 75%+ on Veo): most
  users have clean single-file footage. This feature serves the power-user / alt-camera minority.
  Weight scope accordingly — don't over-build for a small cohort. That's the argument for a cheap
  spike + progressive disclosure over a big always-on stage.
- Can a horizon-tilt check run cheaply client-side on sampled frames without ML? (edge/Hough on a
  few frames.)
- What's the real browser ceiling for ffmpeg.wasm stream-copy on multi-GB / 62GB inputs?
- Where does concat happen if codecs differ across a folder's files (stream-copy needs matching
  codecs/params; otherwise re-encode)?

## Implementation

### Steps (spike)
1. [ ] Load `annotate.md` / `export-pipeline.md` / `modal-gpu.md`; map current ingest + Modal
       transcode entry points.
2. [ ] Prototype/validate **client-side stream-copy trim+concat** against a real large DJI file
       (does ffmpeg.wasm/WebCodecs hold up on multi-GB inputs?).
3. [ ] Draft `docs/plans/tasks/T5650-design.md`: triage rules, Prepare workspace UX flow,
       chosen technical approach + fallbacks, and the epic breakdown for implementation.
4. [ ] **User sign-off on approach** before any implementation task is opened.

## Acceptance Criteria (spike)
- [ ] A written spec + recommended approach with the 62GB case explicitly validated (or ruled
      out with evidence).
- [ ] Progressive-disclosure triage rules defined (when Prepare appears vs stays hidden).
- [ ] Epic/task breakdown ready for user prioritization.
- [ ] User has chosen the technical fork.
