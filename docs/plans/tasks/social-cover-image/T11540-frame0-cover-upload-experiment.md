# T11540: Experiment: does frame 0 set the default cover on upload?

**Status:** TODO
**Impact:** 6
**Complexity:** 2
**Created:** 2026-10-01
**Updated:** 2026-10-01

## Epic Context

This is task 4 of 5 in the Social Cover Image epic. Read [EPIC.md](EPIC.md), design decision 4.

This task is **run by the user**: it needs real phones and real social accounts. It has no code
dependency on the other tasks and can start any time. It gates T11550.

## Problem

The only way to influence the *default* cover when a video *file* is uploaded is the file's first
frame(s). This is believed from platform knowledge, not measured. Before changing what every
download delivers (T11550), confirm which platforms actually default to frame 0, and how many
frames a still needs before a platform picks it up.

There is also one unverified risk. The `attached_pic` mjpeg stream that T6360 embeds could confuse
some uploader, for example by being picked as the cover, or by causing the upload to be rejected.

## Solution

**AI prepares the files. The user uploads them and records the results.**

Starting from one real highlight's download (`GET /api/downloads/{id}/file`, which includes the intro
if attached), build these variants with ffmpeg. Put each variant's first frames on a distinct,
obviously recognisable still, such as the chosen cover with a big "A", "B" or "C" burned in:

| Variant | Content |
|---|---|
| V0 | The download exactly as served today (with the `covr` stream) |
| V1 | V0 with the `attached_pic` stream removed |
| V2 | The cover still held for 1 frame (~33ms), then V1's content |
| V3 | The cover still held for 3 frames (~100ms), then V1's content |
| V4 | The cover still held for 0.5s, then V1's content |

The user manually uploads each variant (as a draft or private post where possible) to:

- Instagram Reels
- Instagram DM
- TikTok
- Facebook Reels
- X
- WhatsApp
- iMessage
- Snapchat
- YouTube Shorts

For each upload, they record the **default** cover or thumbnail before touching any picker.

## Context

### Relevant Files
- `src/backend/app/services/download_metadata.py` (L215-266): how the `covr` stream is added.
- `src/backend/app/services/serve_time_video.py`: the compose seam a real T11550 would use.
- `src/backend/app/routers/downloads.py` (L669-847): the served download.

### Technical Notes
- Build variants with stream copy where possible. For V2-V4, encode the still segment to match the
  highlight's codec, fps and resolution, then concat.
- Keep the variant files out of the repo (scratchpad). Record only results.

## Acceptance Criteria
- [ ] A results table (platform x V0..V4 -> which still the default cover showed) is recorded in
      the Progress Log.
- [ ] A clear finding on whether the `covr` stream causes any upload or cover anomaly (V0 vs V1).
- [ ] The minimum hold duration that wins on Instagram Reels and TikTok, if any.
- [ ] The results are presented to the user with a go / no-go recommendation for T11550.
