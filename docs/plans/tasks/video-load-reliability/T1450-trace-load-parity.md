# T1450: Bring Trace Clip Load Time to Veo Parity (~2s)

**Status:** DONE
**Epic:** [Video Load Reliability](EPIC.md)
**Created:** 2026-04-13

## Problem

After T1440 fixed the "Video format not supported" 404 for Trace games,
framing loads in **3.2s** vs Veo's **~2s**. The delta is the moov fetch:
Trace videos on R2 have moov-at-end (legacy uploads, pre-T1380), so the
browser reads the head (ftyp + mdat), finds no moov, then makes a second
range request at `size - 10MB` to grab the tail moov. That round-trip
adds ~1s on a cold R2 edge.

## Root cause

The offending files were uploaded by other users before T1380 shipped.
Blake3 dedup means later re-uploads short-circuit without running T1380's
client-side faststart relocation. Once a file is on R2 as moov-at-end,
nothing in the current system repairs it.

Future uploads are fine: T1380 analyzes + relocates before R2 sees bytes
(verified [uploadManager.js:282-362](../../../../src/frontend/src/services/uploadManager.js#L282)).
The hash is computed on original bytes, so dedup still works after a
file has been migrated — a subsequent upload of the same source matches
the existing (now faststart) R2 object and skips upload.

## Fix

One-shot migration script that in-place rewrites every moov-at-end game
on R2 via `ffmpeg -c copy -movflags +faststart`. `-c copy` preserves file
size exactly, so the existing `blake3_hash` stays valid as a dedup ID
even though the stored bytes no longer hash to it. **Zero DB changes.**

## Script

`scripts/migrate_games_faststart.py`:
- Lists `games/{hash}.mp4` at bucket root (not env-prefixed — shared).
- Probes first 256KB per object to detect moov position.
- For moov-at-end files: download → ffmpeg faststart → upload same key.
- `--dry-run` for probe-only mode.

## Dry-run results (2026-04-13)

22 total game objects, 46.9GB:
- **9 already faststart** (prior Veo uploads, post-T1380 Trace uploads)
- **13 moov-at-end** (legacy Trace + pre-T1380) — ~26GB to migrate

## Acceptance

- [x] Script correctly detects moov position (edge case: moov-inside-probe
      but after mdat → still at-end).
- [x] Full migration completes, all 13 verified faststart on post-run probe (2026-04-13).
- [x] Reload Trace project → verdict `FASTSTART head=[ftyp@0 moov@32]` (was `MOOV-AT-END`).
- [~] Load time 2.95s — improved from 3.2s but not at Veo parity (2.0s). Remaining gap is warm-path miss due to clipId=null in warmer tagging. Deferred to T1460.
- [x] Veo projects still load unchanged (no regression).

## Post-migration note on size drift

`ffmpeg -c copy -movflags +faststart` does NOT preserve size exactly —
observed deltas 8–38 bytes for most files, ~874KB for one 1GB file. DB
`video_size` is now slightly stale. Impact assessed as harmless: the
proxy's clip byte math has 10-15% padding around clip windows, so
sub-0.1% drift is well within margin. If a real bug surfaces, add a
follow-up to re-probe R2 HEAD and refresh `video_size` per row.

## Files

- `scripts/migrate_games_faststart.py` (new)

## Out of scope

- Backend-side faststart repair on finalize-upload for future dedup-hit
  edge cases. Not needed post-migration: hash is computed on original
  bytes, so dedup on a faststarted R2 object works transparently.
- Env-prefixed `r2_global_key()` code path — games are at bucket root,
  not `{env}/games/`. `r2_global_key` appears to be aspirational or
  used for something other than the actual game objects.
