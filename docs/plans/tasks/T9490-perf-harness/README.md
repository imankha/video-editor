# T9490 trim-handle / seek latency harness

Real-browser (Playwright + Chromium) measurement of the two mechanisms Andrew's
report conflates, measured SEPARATELY:

- **pointer-to-handle** = pointermove -> the green handle visually moving (render latency)
- **pointer-to-preview** = the pointermove that issued a seek -> the video presenting that frame (seek latency)

This is investigation evidence, not a CI test. It lives here (outside `e2e/`, which
is Playwright's `testDir`) so CI never runs it. The durable CI regression guard is the
jsdom test `ClipScrubRegion coalesced drag-seek (T9490)` in
`src/frontend/src/modes/annotate/components/ClipScrubRegion.test.jsx`.

## Reproduce

```bash
# 1. Generate a realistic long file (90s, 1080p, ~6 Mbps, 10s GOP) with a burned-in
#    timestamp so you can eyeball that the presented frame matches the seek target.
ffmpeg -y -f lavfi -i "testsrc=size=1920x1080:rate=30:duration=90" \
  -vf "noise=alls=40:allf=t+u,drawtext=text='%{pts\:hms}':fontsize=96:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2:box=1:boxcolor=black@0.6" \
  -c:v libx264 -preset medium -b:v 6000k -g 300 -keyint_min 300 -sc_threshold 0 \
  -pix_fmt yuv420p -movflags +faststart t9490.mp4

# 2. Serve this dir + the mp4 and run. COLD = throttled to 8 Mbps/40ms RTT (streaming
#    scenario), WARM = throttle removed and file fully buffered.
mkdir srv && cp t9490-harness.html t9490.mp4 srv/
( cd srv && python3 -m http.server 8791 ) &
node t9490-run.js
```

`mode=current` = seek on every pointermove (the reported build). `mode=coalesced`
= one seek in flight, settle on release (the fix).

## Result (2026-09-11, headless Chromium 1.57, 70-move end-handle drag over ~1.6s)

| mode | cache | pointer-to-handle p95 | seeks issued | browser seeks completed | preview paint (rvfc) mean / p95 / max |
|------|-------|----------------------:|-------------:|------------------------:|--------------------------------------:|
| current   | cold | 0.2 ms | 71 | **1** | 1177 / 2211 / 2344 ms |
| current   | warm | 0.2 ms | 71 | **1** | 1240 / 2273 / 2414 ms |
| coalesced | cold | 0.3 ms | ~72 | ~72 (single-digit ms each) | preview steps through frames |
| coalesced | warm | 0.4 ms | ~65 | ~65 (single-digit ms each) | preview steps through frames |

Notes:
- **pointer-to-handle is excellent in every case (<1 ms)** -- the handle render is NOT the problem.
- Under the current per-move-seek code the browser collapses 71 `currentTime =` writes into
  ONE completed seek, so the preview frame does not paint for ~1.2 s on average (up to ~2.4 s)
  and only settles at release -- the "delay before the video updates" symptom.
- `requestVideoFrameCallback` is an unreliable paint signal for a PAUSED video in headless
  Chromium (fires late/batched); the robust signals are the `seeked`-event count and the
  seeks-issued-vs-completed ratio, which are DOM-level facts independent of compositing.
- Caveat: local serving + testsrc content understates real network cold-cache and real
  decode cost; the numbers are an upper-bound demonstration of the mechanism, not Andrew's
  exact device. Confirming his felt latency exactly would still need his browser/OS + a recording.
