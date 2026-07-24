# T-hero-video-swap: Swap the homepage before/after demo videos

**Status:** TODO (waiting on new footage from the owner)
**Tier:** S — 1–2 files, no behaviour change
**Owner action required:** yes (supplies the new footage)

## Why this file exists

The owner plans to replace the homepage before/after demo footage. The site was built so
that swap is a config change plus a poster regeneration — but the poster step is easy to
forget, and forgetting it means the still frame shown before playback does not match the
video. This file is the checklist.

## Current state (as of the SEO rebuild)

The hero is a draggable before/after comparison on the homepage, rendered by
`src/landing/src/components/BeforeAfterSlider.tsx`.

| | Before clip | After clip |
|---|---|---|
| URL | `{R2}/before.mp4` | `{R2}/after.mp4` |
| Size | **22.7 MB** | **50.5 MB** |
| Dimensions | 1080×1920 (9:16) | 1080×1920 (9:16) |
| Duration | 49 s | 49 s |
| Poster | `/hero/before-poster.webp` (16 KB) | `/hero/after-poster.webp` (29 KB) |

`{R2}` = `https://pub-8fd2fb93bbed4535849c27ec673e7905.r2.dev`

**Combined that is ~73 MB.** They are hosted on the public R2 bucket, not bundled with the
site, so swapping them does not require a redeploy — but the poster frames DO live in the
repo and do require one.

Single source of truth: **`src/landing/src/config/heroMedia.ts`**. Nothing else references
these URLs.

## The performance problem this is the real fix for

The SEO rebuild mitigated the 73 MB but could not remove it:

- Videos are gated behind viewport visibility + `requestIdleCallback`, with
  `preload="none"`, so they no longer block first paint.
- WebP posters (~45 KB total) paint immediately, so **LCP is the poster** (measured
  324 ms locally) rather than an unbounded video.
- Save-Data connections never auto-load them and get a tap-to-play affordance.

What that does NOT fix: a visitor who stays on the page still eventually streams ~73 MB,
which is real money on mobile data and still hurts field (CrUX) metrics. **Re-encoding the
new footage properly is the actual fix**, and the swap is the natural moment to do it.

## Target encoding specs for the new footage

The player renders at 405×720 CSS px on desktop, less on mobile. 1080×1920 is roughly 2.7×
more resolution than is ever displayed.

| Spec | Target | Why |
|---|---|---|
| Resolution | **720×1280** | ~1.8× the displayed size; still crisp on a 2× DPR phone |
| Duration | **10–15 s, looping** | 49 s is far longer than anyone watches a hero loop |
| Codec | H.264 High, or AV1/WebM with an H.264 fallback | Safari compatibility |
| Bitrate | CRF 26–28, target **< 3 MB per clip** | ~95% smaller than today |
| Audio | **Strip it** (`-an`) | Muted autoplay — audio is dead weight |
| faststart | **Required** (`-movflags +faststart`) | Today's files have the moov atom at the END, so playback cannot start until enough is buffered |

Suggested command:

```bash
ffmpeg -i input.mp4 \
  -t 15 -vf "scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2" \
  -c:v libx264 -profile:v high -crf 27 -preset slow \
  -movflags +faststart -an \
  before.mp4
```

Both clips must be the **same duration and dimensions** — the slider keeps their
`currentTime` in sync, and a mismatch makes the comparison drift.

## Swap procedure

1. **Encode** both clips to the specs above. Keep the 9:16 aspect ratio; the container is
   `aspect-[9/16]`.
2. **Upload** to the public R2 bucket. Keeping the filenames `before.mp4` / `after.mp4`
   means no code change for the URLs; using new filenames means updating `heroMedia.ts`.
3. **Regenerate the posters** — do not skip this:

   ```bash
   cd src/landing
   for v in before after; do
     ffmpeg -y -ss 2 -i "https://pub-8fd2fb93bbed4535849c27ec673e7905.r2.dev/$v.mp4" \
       -frames:v 1 -vf "scale=540:-2" -q:v 7 "/tmp/$v-poster.jpg"
     ffmpeg -y -i "/tmp/$v-poster.jpg" -q:v 72 "public/hero/$v-poster.webp"
   done
   ```

   Pick a frame that represents the clip (`-ss` = seconds in). For the *after* clip choose
   a moment where the follow-framing and spotlight are clearly visible — this is the first
   thing every visitor sees.
4. **Update `heroMedia.ts`** if filenames changed, and **update `HERO_MEDIA.alt`** — it
   describes the sport and effect shown, and it is the accessible label. If the new footage
   is basketball, the current soccer wording becomes wrong.
5. **Purge the Cloudflare cache** for the R2 URLs if you reused the filenames, or the old
   video will keep serving.
6. **Verify:**
   ```bash
   npm run build && node scripts/verify-seo.mjs dist
   npx astro preview --port 4321
   ```
   Check: posters paint immediately, both clips play and stay in sync, the slider drag
   works, and total transfer is now single-digit MB.
7. **Deploy** — poster changes are in the repo, so this needs the normal
   `src/landing/**` → `master` deploy (see the `deploy-landing` skill).

## Gotchas

- The current source files are **not faststart**, which is why generating a poster from a
  partial download fails with `moov atom not found`. ffmpeg reading the full URL works.
  Encode the new ones with `+faststart` so this stops being a problem.
- `og-card.jpg` is a separate image and is unaffected by this swap.
- Do not re-add `.load()` alongside `.play()` in `BeforeAfterSlider` — it aborts the fetch
  `play()` starts and throws `ERR_CACHE_OPERATION_NOT_SUPPORTED`.

## Acceptance

- [ ] Both clips < 3 MB, 720×1280, faststart, no audio, identical duration
- [ ] Posters regenerated and matching the first visible frame
- [ ] `HERO_MEDIA.alt` describes the new footage accurately
- [ ] Homepage total transfer under 10 MB after full playback
- [ ] Slider drag and sync verified in a real browser
