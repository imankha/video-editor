# T9970 — Findings & recommendation

Deliverables 2 & 4 (benchmark procedure + wider-frame/warning recommendation).
This task is an **investigation / quality gate**. It ships **no product code** —
no "Enhanced to HD" copy, no warning UI, no threshold enforcement. Its job is to
produce the measurement that gates those future, separately-scoped tasks.

**Read the two disclosures first, they bound every number below:**
1. **No-GAN lower bound.** This container has no CUDA/torch. The production
   upscaler (Real-ESRGAN 4×, `ai_upscaler/`) could not run. The benchmark
   measures the Lanczos-only path (`MockVideoUpscaler`-equivalent). Sharpness
   numbers are a floor; the GAN can only raise them.
2. **Single real fixture, one lighting/camera condition.** See FIXTURE-INVENTORY.md.

---

## A. Observed outcomes (measured — reported separately from cause)

Command (reproducible):
```
python3 scripts/quality_benchmark.py \
  --fixture "formal annotations/test.short/wcfc-carlsbad-trimmed.mp4" \
  --out /tmp/t9970-benchmark
```
Fixture 1920×1080 @ 29.97fps; window 0:03–0:09 (the "Great Control Pass" moment);
24 matched timestamps @ 4fps; output 810×1440.

| Variant | enlarge | source-crop `lap_var` | **enlarged `lap_var`** | `lap_var` std | encoded `lap_var` | subject % of crop height |
|---|---|---|---|---|---|---|
| `tight_default_205x365` (product default) | 3.95× | 295.2 | **3.18** | 1.08 | 6.48 | 35.6% |
| `wide_608x1080` | 1.33× | 279.0 | **105.0** | 36.84 | 114.86 | 12.0% |

Also measured: `black_frac = 0.0` both variants (no black gaps in this clip);
`centroid_jitter_px ≈ 2.8` for the tool's linear-pan model (indicative only).

### What the measurements show (observation, not diagnosis)

1. **The two source crops are comparably sharp before enlargement** (295 vs 279).
   The quality gap appears *only after enlargement*: enlarged sharpness proxy
   drops to **3.18** for the tight crop vs **105.0** for the wide crop — a ~33×
   gap that tracks the enlargement factor (3.95× vs 1.33×), not source content.
2. **The tight crop is the product default.** `DEFAULT_CROP_SIZES["9:16"] =
   (205, 365)` in `app/services/default_crop.py`, centered regardless of source
   size. A parent who never resizes the focus box exports exactly the tight
   variant — the measured-softest case is the zero-effort path, not an edge case.
3. **Enlargement is worst on high-res sources.** The default box is a fixed
   205×365 independent of source dims, so on a 1080p source it is only ~19% of
   frame height and must be enlarged ~4×; a lower-res source would enlarge less.
   The best footage (sharpest, highest-res) suffers the largest enlargement.
4. **The tradeoff is real, not one-sided.** The tight crop makes the subject ~3×
   more prominent (35.6% vs 12.0% of frame height). "Wider is sharper" costs
   subject size and, at the extreme, "which kid is mine" legibility — the exact
   thing Spotlight exists to preserve (EPIC.md decision 6).
5. **Encode adds no drift here** (encoded ≈ enlarged, both variants); the H.264
   `-crf 23` pass is not a measurable contributor to softness in this sample.

Visual confirmation: `/tmp/t9970-benchmark/<variant>/t*.png` montages
(source | crop | enlarged, side by side) show the enlarged tight crop is visibly
soft while the wide crop stays crisp — consistent with the numbers.

## B. Suspected causes (kept separate from A — NOT presented as fact)

- The softness R3 observed is **consistent with** crop-enlargement being the
  dominant contributor: source detail is fine, the gap opens purely at the
  enlarge step, and it scales with the enlarge factor. This is **not proof the
  Real-ESRGAN upscaler is defective** — the GAN was not exercised here and is
  designed precisely to recover detail the tight crop lacks. R3 said the ~4×
  enlargement is "a plausible contributor to softness, not proof of a faulty
  upscaler," and this benchmark supports that framing without exceeding it.
- Whether the GAN closes the 33× gap to an acceptable level is **unknown** and is
  the single most important follow-up measurement (needs CUDA/staging).

## C. Wider-frame / landscape fallback recommendation (AC 4)

**Recommendation: prefer a wider default framing as the near-term quality lever,
BUT gate any user-facing change on a GAN-inclusive multi-fixture run first.** The
evidence (no-GAN) shows wider framing recovers ~33× of the sharpness proxy at a
predictable cost to subject size; the geometry is unambiguous. Two concrete,
separately-scoped follow-ups this task's evidence supports:

- **Larger / source-scaled default 9:16 crop box.** The fixed 205×365 default is
  the softest path and the most common one. A default that scales with source
  height (e.g. a fraction of frame height rather than a fixed 205px) would cut
  the enlargement factor on exactly the high-res sources that suffer most. This
  is the highest-leverage, lowest-risk change — but it trades subject prominence,
  so it needs the calibrated run + a product call, not a silent flip here.
- **"Use a wider frame" affordance / landscape fallback.** The brief's proposed
  copy ("This tight crop may look soft. Try a wider frame.") is explicitly
  conditional and must stay disabled until calibrated (see D).

This does **not** recommend abandoning the upscaler or the portrait format. It
recommends reducing enlargement *before* leaning on enhancement — matching the
brief's "Selected implementation decision" ("prefer benchmarked wider framing /
original-wide fallback before enhancement").

## D. Threshold decision (AC 3) — LEAVE CONDITIONAL WARNING DISABLED

**Do not ship calibrated numeric warning thresholds from this run.** Reasons,
each falsifiable:

- **Single fixture, one lighting/camera condition.** A "soft" cut point derived
  from one bright-daylight Veo clip would not generalise to low-light or other
  cameras (unmeasured — FIXTURE-INVENTORY.md gaps).
- **No-GAN.** Any threshold set on Lanczos-only numbers would fire on footage the
  real GAN would have rescued → false "looks soft" warnings on acceptable
  exports. Thresholds MUST be set on GAN-inclusive numbers.
- **`enlarge_x` is the one robust, GAN-independent signal available now.** It is
  pure geometry (output width ÷ source-crop width), needs no quality model, and
  is knowable at framing time. If a *provisional* internal guard is ever wanted
  before calibration, gate it on `enlarge_x` (e.g. flag exports where the crop is
  enlarged beyond ~3×) — NOT on a `lap_var` cut point. Even this should ship
  behind a flag and default OFF until product/QA agree, per EPIC.md decision 3.

Net: **thresholds stay disabled; the rubric defines the dimensions, the cut
points await a calibrated GAN-inclusive multi-fixture run.**

## E. Acceptance-criteria mapping

| AC | Status | Evidence |
|---|---|---|
| Fixture inventory + permissions + reproducible procedure | ✅ | FIXTURE-INVENTORY.md; `scripts/quality_benchmark.py` (one command, deterministic) |
| Observed outcomes separate from suspected causes; no unsupported renderer diagnosis | ✅ | §A (measured) vs §B (suspected, explicitly not proof of a faulty upscaler) |
| Release tolerances from actual results, or explicit insufficiency | ✅ | §D — explicitly insufficient to set universal thresholds; disabled recommended |
| Wider/landscape fallback recommendation + is a conditional warning validated | ✅ | §C (wider framing recommended, gated) + §D (warning NOT yet validated → keep disabled) |

## F. Unresolved gaps / next steps (evidence-gated)

1. **GAN-inclusive re-run on CUDA/staging** — the decisive missing measurement.
   Re-run dimensions 2/4/7 (and add Overlay effects fidelity 11 + audio sync 10)
   through the real `AIVideoUpscaler`. Until then, "does enhancement close the
   gap" is open.
2. **Multi-fixture set** — add low-light, closer-distance, and a second camera
   type before any threshold is calibrated.
3. **Parent "Would you send this?"** — BLOCKED here; the qualitative half of the
   rubric (dimensions 8–12) needs real participants.
4. **Downstream product tasks this gates** (do NOT start without the above): the
   default-crop-box change, the "Use a wider frame" affordance, and any
   conditional softness warning. T9980/T9990 (GATED_DISCOVERY, depend on T9970)
   consume this evidence.

## G. Additive product observation (flagged, NOT implemented — kickoff §"scope")

The measured softest path being the *default* crop suggests the single
highest-leverage safe change is enlarging / source-scaling the default 9:16 crop
box (`app/services/default_crop.py` `DEFAULT_CROP_SIZES` + its mirror in the
frontend at `src/frontend/src/modes/focus/hooks/useCrop.js:19`).
This is flagged for a future, separately-scoped, calibrated task — it is a
behaviour change to a shared default and is deliberately **not** made in this
research task.
