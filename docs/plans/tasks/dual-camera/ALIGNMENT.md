# Auto-Alignment Algorithm Spec (Game Pools / T5530)

**Status:** DRAFT — companion to [UX-SPEC.md](UX-SPEC.md) §6/§7; supersedes EPIC.md's
one-line "audio cross-correlation" note.
**Problem:** place every feed (full-length camera or short phone clip) on the pool's
shared game clock by computing `wall_offset` per video, with an honest confidence — never
a fabricated offset.

**Signal reality (user-stated, design-driving):** sometimes audio is missing; sometimes
`creation_time` is missing; when present, device clocks are often out of sync. So no
single signal is trusted alone. **When audio exists on both sides and matches reliably,
audio is the most compelling default alignment** — metadata only seeds/bounds it.

---

## 0. Definitions

- **Reference feed** — the pool creator's first full-length feed; its first video's t=0 is
  wall-clock 0 (stored constant on the pool; survives feed deletion). Everything aligns
  against the reference, or transitively against already-aligned feeds (§5).
- **Alignment artifact** — per SOURCE (keyed by `blake3`, computed once ever,
  content-addressed like movement profiles): `alignment/{blake3}.msgpack` in R2 holding
  `{envelope, fingerprints, audio_present, creation_time, duration}`. Computed at feed
  activation by the Modal job; reused for every later pairwise match, waveform strip
  render (UX-SPEC §7), and re-alignment.

## 1. Per-source analysis (runs once per blake3, at activation)

1. **Probe** (rides the upcoming mov-atom probe Modal call; interim: ffprobe):
   - `creation_time`: prefer `com.apple.quicktime.creationdate` (local time + tz, written
     by iPhones) over the container `creation_time` atom (spec says UTC; many cameras
     write local time into it — the single most common failure). Normalization: if both
     atoms exist and disagree by an integral number of half-hours, trust the Apple atom;
     a bare container time is stored with `tz_reliable=false`. Also record whether the
     stamp marks file-open or file-close where detectable (duration-subtraction check
     against sibling uploads from the same device).
   - `audio_present`: `ffprobe -select_streams a` — Veo/Trace exports can be silent;
     screen-recorded or app-edited clips may have replaced audio.
2. **Audio decode** (only if `audio_present`): ffmpeg reads the R2 object via presigned
   URL → mono 8 kHz PCM, band-passed **300–3000 Hz** (kills wind rumble and speech-band
   mud; keeps whistle ~2–4 kHz fundamentals and crowd transients).
3. **Onset envelope**: spectral flux over an STFT (2048 window / 50% hop at 8 kHz →
   ~7.8 ms resolution), log-compressed, max-pooled to **100 Hz** (10 ms bins). Stored in
   the artifact (~36 KB per game hour) — this is also what the §7 waveform strips render.
4. **Fingerprints** (Shazam-family constellation, the audalign/dejavu approach): local
   spectral peaks → pair into hashes `(f1, f2, Δt)` within a target zone. ~200 lines of
   numpy/scipy, no heavy deps. Stored in the artifact (a few hundred KB per game hour).

## 2. Candidate window from metadata (cheap prior, never a verdict)

If both sides carry `creation_time`:
`candidate = creation_diff`, window = **±10 min** (covers real device skew; phones are
NTP-true within ~1 s, standalone cameras drift minutes). If either side lacks it, or
`tz_reliable=false` on either: window = the whole reference duration. A metadata
candidate is NEVER written as an offset by itself for full-length feeds — it only bounds
the audio search (exception: the no-audio fallback, §6).

## 3. Coarse offset — fingerprint match (primary signal)

Hash-join the new feed's fingerprints against the reference's, restricted to the
candidate window. Histogram the implied offsets (0.1 s bins); the modal bin is the
candidate coarse offset.

**Why fingerprints and not plain cross-correlation:** raw xcorr of two 90-minute signals
is both computationally hostile and brittle when the waveforms differ in gain/character
(different mics, different distances, wind on one side) — the documented failure mode of
naive NLE sync. Fingerprint matching is robust to gain and works with a **20-second query
against a 90-minute recording** — exactly the phone-clip case.

**Confidence gate (both required):**
- `matched_hashes(modal_bin) ≥ 8`
- `modal_bin / second_bin ≥ 3×`

## 4. Fine offset — windowed cross-correlation (refinement)

**GCC-PHAT** (phase transform — gain-invariant) on the 100 Hz onset envelopes over
**±2 s** around the coarse offset; parabolic peak interpolation → sub-bin (~±10 ms
envelope-limited) precision. Physical floor: sound propagation skews opposite-sideline
cameras by up to ~0.3 s (100 m at 343 m/s) — real, bounded, visually acceptable at v1;
the §7 nudge is the correction. (Sample-clock drift over 45 min on consumer devices is
<100 ms — ignored at v1; a future two-point fit at start+end of overlap can estimate it.)

## 5. Cross-validation and transitivity

Match the new feed against **every already-aligned feed**, not only the reference:
- Offsets compose: clip↔VeoB at `+60:34` with VeoB at `+0:38` implies clip at `+61:12`.
- **Agreement across pairs (≤1 s spread) upgrades confidence**; disagreement >1 s caps the
  verdict at `medium` and logs the pair matrix for the T5530 validation harness.
- A clip that only overlaps the second half can never match the reference's first half —
  transitivity through per-video (`sequence`) matching handles per-half feeds naturally.

## 6. Verdict ladder (what gets written)

| Case | `wall_offset` written | `offset_source` | UX result |
|---|---|---|---|
| Fingerprint pass + fine xcorr agrees | yes | `auto` + confidence | Lined up: included in Main, no badge; §7 opens in confirm mode ("Auto-synced by sound…") |
| Fingerprint medium (gate partially met, or pair disagreement) | yes (best estimate) | `auto`, low confidence | Positioned but **"Not lined up yet"** badge; EXCLUDED from Main until a human confirms in §7 |
| No audio on one side, `creation_time` on both | yes (metadata) | `metadata` | Positioned, badged, excluded from Main; §7 no-audio state ("line it up by eye") |
| No audio, no usable `creation_time` — **full-length feed** | yes, `0` vs reference **only as an explicit low prior** (`metadata`, confidence 0 — both filmed the same game; recordings start near kickoff) | `metadata` | Positioned at game start, badged, excluded from Main |
| No audio, no usable `creation_time` — **clip** | **NULL — never fabricated** | — | Chip parks in the Clips lane's trailing "unplaced" tray state; §7 short-clip variant is the placement gesture |
| Music-overdubbed / replaced-audio clip (fingerprints hit nothing) | falls through to the metadata rows above | | |
| **Manual confirm/nudge (§7)** | yes | `manual` | Authoritative: auto re-runs NEVER overwrite a `manual` offset |

Re-runs: a new feed joining triggers alignment for that feed only; re-aligning existing
`auto` offsets happens only when a strictly higher-confidence match appears, and never
touches `manual`.

## 7. Compute placement & cost

Modal CPU function `align_feed(pool_id, feed_id)` (no GPU), dispatched from feed
activation — same app as the mov-atom probe so a future merged "probe + analyze audio"
call is a refactor, not a re-architecture. Inputs stream via presigned URLs; per-source
work happens once (artifact cache), so aligning the 12th feed costs one decode + cheap
hash joins. Failure → job marked, feed lands in the metadata/no-signal rows above —
alignment failure never blocks upload/activation.

## 8. Validation protocol (T5530 acceptance)

1. **Synthetic truth:** split existing game videos at known offsets (incl. re-encoded,
   volume-shifted, band-limited, and 15–30 s excerpt variants) → assert recovered offset
   within ±0.2 s; excerpts within ±0.3 s.
2. **Real dual recordings:** at least 3 real game pairs (Veo+Veo, Veo+phone,
   phone-clip+Veo), hand-labeled by whistle → same tolerances; publish the pair matrix.
3. **Negative controls:** two different games must produce NO offset (gate holds, verdict
   falls to metadata) — a confident wrong answer is the worst outcome.
4. **Wind/silence stress:** clips with wind-dominated and near-silent audio must land in
   `medium`-or-below, never `auto`-confident.

## Failure-mode table (design inputs, not edge cases)

| Reality | Behavior |
|---|---|
| Veo export with no audio track | Metadata position + badge; §7 by-eye flow |
| Phone clip filmed off a replay screen / with music | No fingerprint match → metadata/unplaced; never a bad confident offset |
| Tournament PA music | Helps — loud shared audio is ideal fingerprint material |
| Both `creation_time`s present but hours apart (tz mangling) | Half-hour-integral disagreement heuristic; else `tz_reliable=false` → full-duration search |
| Cameras on opposite sidelines | ≤~0.3 s propagation skew accepted; §7 nudge corrects |
| One camera paused mid-half | Violates the constant-offset assumption for that video → pair disagreement caps at `medium`, human confirms; per-half videos (separate files) are unaffected |
