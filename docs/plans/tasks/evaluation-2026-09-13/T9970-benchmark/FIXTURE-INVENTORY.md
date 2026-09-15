# T9970 — Fixture inventory & authorization

Deliverable 1 of 4 (AC: "Deliver fixture inventory / permissions and a
reproducible benchmark procedure"). Scope axes required by the brief: source
resolution, distance, light, motion, player-crossings, camera-pan variety.

## Authorization / provenance

Both fixtures are **already committed to this repository** under
`formal annotations/test.short/` — they are the project's own dev/test media,
not newly downloaded or externally sourced material. No new footage was
fabricated, synthesized, or fetched from an unauthorized source (brief §"Out of
scope"). No real parent/child footage was published, shared, or sent anywhere.

## Inventory

| Fixture | Dims | FPS | Duration | Size | Content | Usable for benchmark? |
|---|---|---|---|---|---|---|
| `formal annotations/test.short/wcfc-carlsbad-trimmed.mp4` | 1920×1080 | 29.97 | **1:29.322** | 48 MB | **Real** Veo fixed-sideline youth-soccer recording, bright midday sun | **YES — primary** |
| `formal annotations/test.short/game2-test.mp4` | 640×480 | 25 | 0:05 | 10 KB | Solid-green synthetic clip (pipeline smoke fixture) | No — no real content |

### Why `wcfc-carlsbad-trimmed.mp4` is the right primary fixture

- Its duration is **1:29.322**, matching the evaluator's supplied MP4 duration
  in the brief ("A supplied 1:29.322 MP4 … a six-second moment at source
  0:03–0:09, 'Great Control Pass'"). It is the authorized in-repo equivalent of
  (or the same as) the evaluated source.
- It contains a navy-kit player wearing **#30**, consistent with the brief's
  "unconfirmed blue #30 identity" observation (identity itself is NOT confirmed
  here — see gaps).
- It is a **Veo** auto-tracking sideline camera: a single fixed wide 1080p vantage
  with slow digital pans — exactly the "wide sideline footage has to become a
  phone-shaped video" case the product exists to solve (EPIC.md decision 7).

## Scope-axis coverage (honest gaps marked)

| Axis | Covered by `wcfc` | Gap |
|---|---|---|
| Source resolution | 1080p (the hard case: subjects are small, enlargement is largest) | No 720p / 4K / phone-shot sample to see how enlargement softness scales with source res |
| Distance | Far — players ~40–130 px tall in a 1080p frame | No close/mid-distance footage (a sideline camera never gets close; a different rig would) |
| Light | Bright, harsh midday sun with strong tree shadows | **No low-light / evening / overcast / indoor** sample |
| Motion | Running players, ball movement, direction changes | Adequate |
| Player-crossings | Multiple same-kit players cross and occlude | Adequate |
| Camera pan | Veo slow digital pan | No fast/handheld/whip-pan sample |
| Camera type | One (Veo fixed sideline) | No phone-held, no broadcast, no drone |

**Net:** ONE real fixture covering the highest-severity corner (far subjects,
1080p, one lighting condition, one camera type). It is sufficient to
characterise the crop-enlargement softness mechanism and to compare tight vs
wider framing, but it is a **single-source sample** — not a calibration set
across lighting/distance/camera variety. This directly bounds what thresholds
the findings can responsibly propose (see FINDINGS.md §"Threshold decision").

## Evidence gaps explicitly marked BLOCKED

Per the brief, evidence-gathering that cannot be done in this environment is
marked blocked rather than fabricated:

- **BLOCKED — parent "Would you send this?" feedback.** No real parents/
  participants are available in this container. The qualitative half of the
  rubric (recorded parent reasons) cannot be filled; only the objective/
  measurable half was executed.
- **BLOCKED — real child-identity confirmation** ("blue #30" with the source
  owner). Not verifiable here and not required for the softness measurement.
- **BLOCKED — GAN-path (Real-ESRGAN) quality.** No CUDA/torch in this container,
  so the production upscaler's sharpening contribution is unmeasured. All
  numeric results are a **no-GAN lower bound** (see RUBRIC.md §"Environment
  limits" and FINDINGS.md).
- **PARTIAL — lighting/distance/camera variety.** Only one real fixture exists
  in-repo; the gaps in the table above are unfilled.
