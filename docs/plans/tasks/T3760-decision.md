# T3760 Decision Doc — Framing Clip Cold-Load Over-Fetch

**Status:** Spike complete — awaiting user approval
**Date:** 2026-06-18
**Author:** AI spike (C2, solo)
**Recommendation:** **Close T3760 as won't-fix (premise not reproducible). Resolve T2560 as kept-skip on latency grounds. Do not build edge clamp / MSE / faststart for this issue.**

---

## TL;DR

I reproduced the exact prod scenario against the **real R2 object** for project 46 / clip 48
(`games/1c8a48db…b404.mp4`, 3,051,071,723 bytes, confirmed identical to the HAR) and measured
every quantity the task targets. The over-fetch is **real but harmless**:

- The browser issues an open-ended range and R2 advertises ~1.03 GB `Content-Length` — **but the
  browser buffers only ~3 seconds and actually transfers ~1.8 MB cold.** The 1.03 GB is *advertised*,
  not *downloaded*.
- **Cold time-to-first-frame after a deep seek = 266 ms** (warm = 16 ms). The "~4.3s" in the task was
  the HAR **`receive` duration of a throttled, playing stream** mis-read as TTFF.
- **Seeks resolve in ~300 ms even under deliberate 8-socket saturation** — the "felt seek stall" is
  not reproducible.

A `Content-Length` clamp (edge Worker, MSE, or endpoint) changes *advertised total bytes*. It does
**not** change TTFB (82–151 ms), throughput, or the ~3s the browser actually buffers. So **no clamp
can improve a 266 ms TTFF or a 300 ms seek.** Per the task's own merit gate ("a bounded
`Content-Length` test with no measured TTFF improvement does not pass"), there is nothing to ship.

---

## Method

All numbers are measured against the **real prod R2 object**, not a mock. The dev `.env` R2 creds
reach it because game videos are global (T80) and all envs share bucket `reel-ballers-users`
(account `e41331ed…`).

1. **Object identity + faststart** — minted a fresh presigned URL for the HAR's exact key, probed
   MP4 box headers.
2. **TTFF harness** (`c:/tmp/t3760_ttff.html`) — bare `<video preload=auto>`, deep-seek to the HAR's
   byte fraction (0.6617 → 3566s of a 5389s video), measured `loadedmetadata` → `seeked` →
   `loadeddata` → first `requestVideoFrameCallback`, driven by Playwright.
3. **Scrub + saturation harness** (`c:/tmp/t3760_scrub.html`) — 6 baseline seeks, then 8 held-open
   open-ended `fetch` ranges (emulating the prod HAR's 1 GB sockets), then 6 more seeks under
   saturation.
4. **HAR re-analysis** — `app.reelballers.com.har` (prod) and `localhost.har`, focusing on Range
   headers, `Content-Range`, `Content-Length`, `bodySize`, `wait` vs `receive`, and `httpVersion`.

---

## Measured Findings

| Quantity | Measured | Task's stated claim |
|---|---|---|
| Source faststart (`moov` position) | **YES** — `ftyp` 0–31, `moov` 32–700421 (~684 KB), then `mdat` | "may be non-faststart; deep probe" |
| R2 TTFB at ~2.0 GB offset (cold) | **82–151 ms** (HAR + harness) | — |
| **Cold TTFF after deep seek** | **266 ms** (first painted frame); ~540 ms incl. metadata parse | **"~4.3s"** |
| Warm TTFF after deep seek | **16 ms** | — |
| Bytes the browser **buffers** | **~3 seconds** (`video.buffered = [3566, 3569]`) | "over-buffers far past the clip window" |
| Bytes actually **transferred** cold | **~1.85 MB** (HAR `bodySize`) | "3.4 MB / 4.3s" (the 4.3s is receive, not TTFF) |
| `Content-Length` **advertised** per open range | **~1.03 GB to EOF** | the "over-fetch" — real, but advertised-only |
| Seek latency, baseline | **231–341 ms** (avg ~296 ms) | — |
| Seek latency, **8-socket saturated** | **203–487 ms** (avg ~318 ms — no stall) | "felt playback stalls on every seek" |
| R2 endpoint protocol | **HTTP/1.1** (T2550 premise correct) | (assumed) |

### What the prod HAR actually shows (read correctly)

The three open-ended ranges were NOT three stalls. `receive` time ≠ stall:

| # | Range | Content-Length **offered** | Bytes **transferred** | `wait` (TTFB) | `receive` | What it is |
|---|---|---|---|---|---|---|
| 1 | `bytes=2021818368-` | 1.03 GB | 9.45 MB | 82 ms | 55,803 ms | a full **playing session** holding one socket |
| 2 | `bytes=2020376576-` | 1.03 GB | 0.56 MB | 120 ms | **93 ms** | a seek — **fast** |
| 3 | `bytes=2019000320-` | 1.03 GB | 1.46 MB | 126 ms | **113 ms** | a seek — **fast** |

The only "long" number is range 1's 55.8s — that's the video **playing**, not a stall. Ranges 2–3
(the actual scrubs) completed in **93 ms and 113 ms**. **Even the user's own evidence, read
correctly, does not show a seek stall.** The misdiagnosis came from reading "Content-Length offered"
as "bytes downloaded" and "receive" as "time to first frame."

---

## Options Evaluated (against measured numbers)

| Option | Would it move the measured bottleneck? | Complexity / Risk | Verdict |
|---|---|---|---|
| **(T2580) Faststart-on-upload** | No — source is **already faststart** (`moov` at 32 B). The deep probe is the clip seek, not a moov hunt. | Low | **Ruled out** — nothing to fix here |
| **(a) Edge byte-clamp via CDN Worker (T2560)** | No — clamps *advertised* `Content-Length`; TTFF is 266 ms and gated by TTFB (150 ms) + ~3s buffer, neither of which a clamp changes. **Requires first building all of T2550** (custom domain, HMAC, R2 binding, deploy pipeline — none exist today; `workers/` is stale scaffolding) **then** porting the 3-window clamp, with documented Worker-stall risk on multi-GB R2 bytes. | **Very high** (two infra tasks, P0+P1) | **Reject** — large build, zero measured benefit |
| **(b) MSE client-side bounded fetch** | No — same reason; TTFF and seeks are already fast. Adds a whole client media-source pipeline. | High | **Reject** |
| **Endpoint clamp via Fly `/stream` (flip to primary)** | Would clamp bytes but **reintroduces the ~590 KB/s Fly proxy cap** T3250 removed — *worsens* throughput. Explicitly forbidden by the task. | Medium | **Reject** (forbidden + harmful) |
| **Do nothing (close won't-fix)** | The measured targets are **already met**: TTFF 266 ms cold (target < 1.5s), seeks ~300 ms, 3s buffer. | None | **Recommended** |

---

## Recommendation

1. **Close T3760 as won't-fix / not-reproducible.** Cold TTFF (266 ms) and seek latency (~300 ms) are
   already ~6–8× under the 1.5s target with no change. The over-fetch is advertised-only and does not
   cost the user latency. *(Per CLAUDE.md, I do not change task status — flagging for the user to
   promote/close.)*

2. **Resolve T2560 as KEPT-SKIP, now on latency grounds (not just egress).** The 2026-06-17 note
   un-skipped it on "latency" — this spike shows the latency does not exist: byte-clamping cannot
   improve a 266 ms TTFF or a 300 ms seek. The egress rationale (free on R2) still holds. I will append
   this measured rationale to `T2560-edge-video-worker.md`.

3. **Decouple T2550 from this issue.** T2550 (HTTP/2 + CDN edge caching) retains independent merit for
   *cache-hit* latency on repeat plays and for moving egress off Fly — but it is **not** justified by
   any TTFF/seek problem on the framing clip. Do not let T3760 pull T2560/T2550 forward.

4. **No deterministic clamp test is committed**, because there is no clamp to guard — committing a
   bounded-`Content-Length` test would imply a production clamp the recommendation says not to build
   (violates "correct data, not workarounds"). The reproducible harnesses (`t3760_ttff.html`,
   `t3760_scrub.html`) are preserved in the Progress Log as the evidence of record; if the user elects
   to clamp anyway (see below), the test becomes meaningful and I will commit it.

### Honest caveats (where a real problem *could* still hide)

- **Slow / mobile connections.** All captures show 82–151 ms TTFB on a good connection. On a throttled
  link, throughput dominates — but **clamping `Content-Length` does not raise throughput**; the fix for
  slow links is lower bitrate / adaptive streaming, which is a different task. A clamp still wouldn't help.
- **App-boot, not the R2 read.** ~2.5s of the localhost "perceived delay" is the dev Vite module
  waterfall before the first video byte (collapses in the prod bundle). That belongs to the page-load
  work (T3770), not here.
- **If the user still feels a stall in real use,** the right next step is a HAR captured *at the moment
  of the felt stall* with the throughput column — because neither the existing HARs nor this
  reproduction show one in TTFF or seek timing.

---

## Acceptance-criteria reconciliation

| AC | Outcome |
|---|---|
| Decision doc comparing faststart / edge-clamp / MSE with measured numbers | ✅ This doc |
| Deterministic bounded-`Content-Length` test committed | ⛔ Intentionally not committed — recommendation is no clamp; test would guard a fix that shouldn't exist. Re-enable if user elects to clamp. |
| Cold TTFF < 1.5s (was ~4.3s) | ✅ Measured **266 ms** unclamped — already met; "4.3s" was a HAR mis-read |
| Seek path re-measured, confirmed | ✅ ~300 ms baseline **and** under 8-socket saturation — no stall |
| Fix doesn't reintroduce Fly cap | ✅ N/A — no fix; direct-R2 untouched |
| T2560 "likely skipped" resolved | ✅ Recommend **kept-skip** with measured latency rationale (above) |

---

## Decision required from you

**Approve the recommendation (close T3760 won't-fix; keep T2560 skipped)?** Or, if you have first-hand
evidence of a stall my reproduction misses, I'll instead capture a throughput-annotated HAR at the
moment of the felt stall before deciding. I will not write production code or change any task status
until you say which.
