"""T10160 -- shared "skip the GAN for small enlargements" gate (canonical copy).

The Real-ESRGAN cost scales with the crop's INPUT pixel count, not the enlargement
ratio: `RealESRGANer.enhance(img, outscale)` always runs the network at its native
`scale=4` over the whole crop and only trims the trailing resize, so `outscale`
never reduces GAN FLOPs. Skipping the GAN entirely for a small enlargement -- a
high-quality Lanczos resize plus the existing unsharp-mask sharpen -- is therefore
the ONLY lever that removes GAN cost. This module is the single source of truth for
that gate decision.

INERT by default: `GAN_MIN_ENLARGE = 0.0` means `output_w / crop_w < 0.0` is never
true, so the cheap path is dead code and behaviour is byte-identical to pre-T10160.
Flipping the constant to a calibrated value is a follow-up (design Step 5) gated on
a GAN-inclusive CUDA/staging measurement that could not run in the /dotask container
-- see `docs/plans/tasks/T10160-design.md`.

`app/modal_functions/video_processing.py` carries a BYTE-FOR-BYTE copy of
`GAN_MIN_ENLARGE` and `should_skip_gan` because the deployed Modal image does not
mount the `app` package (the same constraint that forces `_resolve_modal_app_name`
to be duplicated). Parity between the two copies is enforced by
`tests/test_upscale_gate.py` so they cannot silently drift.
"""

# Skip the Real-ESRGAN pass when output_width / crop_width is below this ratio.
# 0.0 == never skip (INERT). Do NOT flip without the gated measurement (design Q2).
GAN_MIN_ENLARGE = 0.0


def should_skip_gan(output_width: int, crop_width: int) -> bool:
    """True when the crop's horizontal enlargement is below GAN_MIN_ENLARGE.

    `output_width / crop_width` is the pure-geometry enlargement signal available
    at the enhance site. A non-positive crop width (an impossible upstream state)
    returns False so the GAN path -- never the cheap path -- is taken.
    """
    if crop_width <= 0:
        return False
    return (output_width / crop_width) < GAN_MIN_ENLARGE
