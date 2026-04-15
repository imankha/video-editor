# T1534 - Overlay Render Broken Pipe at Frame 299

**Status:** TESTING

## Root cause (confirmed via stderr-tail logging)

FFmpeg ran cleanly to `frame=301 time=00:00:09.93 Lsize=10832kB`, wrote moov atom, exited 0 — i.e. **the encode completed normally**, just early. Python kept writing frames → BrokenPipe at frame 299 (off-by-one is just internal pipe buffering).

The reason ffmpeg stopped early: the overlay command used `-shortest` plus `-i input_path -map 1:a?` to bring the source video's audio along. The multi-clip concat sources had mixed audio (clip 1: present, clips 2/3: missing). `-c copy` concat preserved only clip 1's ~8s audio stream. `-shortest` truncated the overlay output to the audio length (9.93s) instead of the video length (23.97s), exiting before Python finished feeding frames.

## Fix applied

Removed `-shortest` from `_process_overlay`'s ffmpeg command ([video_processing.py:327-330](../../src/backend/app/modal_functions/video_processing.py#L327-L330)). Video duration now drives output length; audio plays as far as it has data and stops.

## Follow-up worth considering (not blocking this RC)

Multi-clip concat with mixed audio is itself a problem — playback of the working_video shows audio only for the first clip. Should either:
- Strip audio from all clips during concat (consistent silence), or
- Insert silent tracks for clips without audio so concat audio matches video duration.

Filed as part of T1533 follow-up if not separately ticketed.
**Priority:** 3.0 (Impact 8, Cmplx 3) — RC blocker if reproducible

## Symptom

Multi-clip framing export succeeds → user clicks Overlay Export → backend returns 500
`Overlay processing failed: Frame writing failed: Pipe error at frame 299: [Errno 32] Broken pipe`.

## Modal log evidence (job $6, project_id=6)

- Input: `working_videos/working_6_b94811b4.mp4` (the multi-clip concat output)
- Detection pass read it as: `2560x1440, 719 frames, 30.00 fps, 23.97s` — fine
- Overlay pass read it as: `2560x1440 @ 29.999592538566226fps, 719 frames`
- FFmpeg launched with: `-r 29.999592538566226 ...`
- Progress logged: 100/719, 200/719 — then died at frame 299
- `_process_overlay` only logged the FIRST 1000 chars of stderr → the actual ffmpeg error message was clipped (only the version banner survived). **Fixed in this commit:** stderr now logs the LAST 2000 chars.

## Likely root cause

Concat with `-c copy` of mismatched-fps source clips (30.0 / 29.9 / 29.9 fps) produces a derived non-clean fps. Passing that float verbatim to FFmpeg's `-r` flag may exceed precision FFmpeg accepts, or causes timestamp drift that ffmpeg eventually rejects. Alternatively the cv2 fps read disagrees with the actual stream timebase causing pipe desync.

## Investigation steps

1. **Get clean stderr** (deploy fix in this commit, retry, capture full ffmpeg error).
2. Run `ffprobe` on the working_video to inspect actual stream parameters: `r_frame_rate`, `avg_frame_rate`, `time_base`, frame count.
3. Check if forcing the overlay encoder to a clean fps (`30000/1001` or `30/1`) instead of the cv2-reported float fixes it.
4. Check if cv2's `cap.get(CAP_PROP_FPS)` is even what should drive `-r`. Better source: `cap.get(CAP_PROP_FRAME_COUNT) / duration` or the input's stream rate.

## Candidate fixes

- **A. Sanitize fps before passing to ffmpeg:** snap to `30000/1001` if within 0.01 of 29.97, else `round(fps)/1`.
- **B. Force concat to a single clean fps in the multi-clip export** (re-encode branch, or `-vf fps=30` on each clip pre-concat) so the working_video always has clean timing.
- **C. Drop `-r` flag entirely** in the overlay ffmpeg invocation and let it derive from the rawvideo stream timing.

## Related

- T1533 (overlay slow first-load) — same working_video, separate symptom (browser metadata timeout).
- The Modal redeploy hotfix earlier today (`r2 is not defined`) is unrelated to this; that error is gone in job $6.

## Files

- [src/backend/app/modal_functions/video_processing.py:389-434](../../src/backend/app/modal_functions/video_processing.py#L389-L434) — overlay frame writer + stderr logging.
