#!/usr/bin/env python3
"""T9970 highlight quality benchmark.

Reproducible measurement tool for the R3 finding: a tight source crop
(~205x365) enlarged ~4x to an 810x1440 / 1080x1920 portrait output "looks
soft". This script does NOT change any product code path; it is a standalone
research instrument that runs the geometric half of the framing pipeline
(source -> crop rectangle -> Lanczos enlarge -> H.264 encode) over an
authorized fixture and captures matched-timestamp frames at each stage, at a
normal-playback sampling cadence (not a single sampled frame), so tight-crop
vs wider-frame framing can be compared with numbers instead of screenshots.

WHAT THIS MEASURES, AND WHAT IT DELIBERATELY DOES NOT
-----------------------------------------------------
Production framing (see .claude/knowledge/modal-gpu.md) is:
    crop-at-frame (Catmull-Rom spline) -> Real-ESRGAN 4x GAN enhance ->
    Lanczos resize to target -> libx264 encode.
On a container with Modal OFF and no CUDA (the sanctioned /dotask verify mode,
T4120) the GAN stage is replaced by `MockVideoUpscaler` (local_processors.py),
which is ffmpeg crop+resize ONLY. This script mirrors the PRODUCTION geometric
path — OpenCV/ffmpeg Lanczos for the enlarge (matching AIVideoUpscaler's
cv2.INTER_LANCZOS4 resize) and libx264 -crf 23 -preset fast for the encode (the
documented Modal final-encode profile). The no-CUDA mock approximates the same
geometry with a bicubic scale / ultrafast preset / hardcoded 810x1440; using the
production resampler+profile here gives the fairest (most generous) no-GAN
estimate. Therefore:

  * The softness attributable to CROP ENLARGEMENT + resampling + encode IS
    measured here (this is the geometric contributor R3 flagged).
  * The Real-ESRGAN GAN's sharpening contribution is NOT exercised and CANNOT
    be measured in this environment. Every "enlarged"/"encoded" number below
    is a NO-GAN LOWER BOUND on delivered sharpness. It is NOT evidence that
    the production upscaler is defective (R3 was explicit about this).

The crop rectangle here is a static box or a linear pan between two boxes.
Production interpolates crop keyframes with a Catmull-Rom spline
(app/interpolation.py); the enlargement-factor / softness relationship this
script measures is spline-independent, so a simpler crop model is sufficient
and is called out in the findings. Jitter is measured against the crop model
actually used, so it reflects THIS tool's motion, not production spline motion.

METRICS (per stage, per sampled timestamp)
------------------------------------------
  lap_var        Variance of the Laplacian. Higher = more high-frequency
                 detail / sharper. A proxy, cross-checked against hf_ratio.
  hf_ratio       Fraction of FFT magnitude energy above a radius cutoff.
                 Second, independent sharpness proxy (less sensitive to noise
                 than lap_var). Compared only between images at the SAME output
                 resolution so the pixel grid is identical and the comparison
                 is fair.
  mean_luma      Mean luma 0-255 (black-gap / exposure sanity).
Whole-clip aggregates (per variant):
  lap_var_mean / lap_var_std  softness level and its temporal stability
                              (std spikes = flicker/softness pumping).
  black_frac                  fraction of sampled frames with mean_luma < 16.
  centroid_jitter_px          mean frame-to-frame crop-centre movement (px in
                              source space) for the crop model in use.

USAGE
-----
    python3 scripts/quality_benchmark.py \
        --fixture "formal annotations/test.short/wcfc-carlsbad-trimmed.mp4" \
        --out /tmp/t9970-benchmark

    # custom scenario (crop boxes, window, cadence, output res):
    python3 scripts/quality_benchmark.py --config my_scenario.json --out ...

Outputs into --out: results.json, per-timestamp stage montage PNGs, one encoded
mp4 per framing variant, and a printed summary table. Requires ffmpeg on PATH
and python cv2 + numpy (present in the /dotask container; no torch needed).
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np

# --- Portrait output resolutions seen in the wild / in the product ----------
# 810x1440 is the resolution the evaluator's export was LABELLED with (R3);
# 1080x1920 is the standard portrait target. Both are 9:16. Default matches R3
# so the benchmark reproduces the exact observed case; override via config.
DEFAULT_OUTPUT_RES = (810, 1440)

# libx264 final-encode profile documented for the Modal path (modal-gpu.md:
# "Modal final encode is libx264 -crf 23 -preset fast").
ENCODE_CRF = 23
ENCODE_PRESET = "fast"

BLACK_LUMA_THRESHOLD = 16.0  # mean luma below this = a "black gap" frame


@dataclass
class Variant:
    """One framing choice to benchmark (e.g. 'tight' vs 'wide')."""

    name: str
    # crop box in SOURCE pixels: (x, y, w, h). If end_box is given, the crop
    # linearly pans/zooms from start_box to end_box across the sample window
    # (a stand-in for a two-focus-point framing; exercises pan + jitter axes).
    start_box: tuple[int, int, int, int]
    end_box: tuple[int, int, int, int] | None = None


@dataclass
class Scenario:
    fixture: str
    output_res: tuple[int, int] = DEFAULT_OUTPUT_RES
    start_s: float = 3.0            # R3 moment was source 0:03-0:09
    end_s: float = 9.0
    sample_fps: float = 4.0         # matched-timestamp cadence across the clip
    # subject box in SOURCE pixels (x, y, w, h): the athlete, used to report
    # how much of each framing the subject fills (subject-visibility axis).
    subject_box: tuple[int, int, int, int] | None = None
    variants: list[Variant] = field(default_factory=list)


# --- Default scenario: the R3 "Great Control Pass" reproduction --------------
# Fixture wcfc-carlsbad-trimmed.mp4 is 1920x1080 Veo sideline footage, 1:29.322
# (matches the evaluator's supplied MP4 duration). The default boxes frame a
# mid-field player around the center-left of the frame during 0:03-0:09.
def default_scenario(fixture: str) -> Scenario:
    # The tight box is the ACTUAL product default: DEFAULT_CROP_SIZES["9:16"] =
    # (205, 365) (default_crop.py), centered in a 1920x1080 source ->
    # x=(1920-205)/2=857, y=(1080-365)/2=357. A parent who never resizes the
    # focus box exports exactly this. A small pan (+64px x) exercises motion.
    return Scenario(
        fixture=fixture,
        variants=[
            Variant("tight_default_205x365", start_box=(825, 357, 205, 365),
                    end_box=(889, 357, 205, 365)),
            # Wider portrait: full-height 9:16 box 608x1080 (~1.33x enlarge).
            # Keeps the athlete + surrounding play; far less enlargement.
            Variant("wide_608x1080", start_box=(624, 0, 608, 1080),
                    end_box=(688, 0, 608, 1080)),
        ],
        subject_box=(890, 500, 70, 130),  # approx one player, source px
    )


def lap_var(bgr: np.ndarray) -> float:
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def hf_ratio(bgr: np.ndarray, cutoff_frac: float = 0.25) -> float:
    """Fraction of FFT magnitude energy outside a central low-freq disc."""
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)
    f = np.fft.fftshift(np.fft.fft2(gray))
    mag = np.abs(f)
    h, w = gray.shape
    cy, cx = h / 2.0, w / 2.0
    yy, xx = np.ogrid[:h, :w]
    r = np.sqrt(((yy - cy) / cy) ** 2 + ((xx - cx) / cx) ** 2)
    total = float(mag.sum()) or 1.0
    high = float(mag[r > cutoff_frac].sum())
    return high / total


def mean_luma(bgr: np.ndarray) -> float:
    return float(cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).mean())


def lerp_box(a: tuple[int, int, int, int], b: tuple[int, int, int, int],
             t: float) -> tuple[int, int, int, int]:
    return tuple(int(round(av + (bv - av) * t)) for av, bv in zip(a, b))


def clamp_box(box: tuple[int, int, int, int], W: int, H: int):
    x, y, w, h = box
    x = max(0, min(W - w, x))
    y = max(0, min(H - h, y))
    return x, y, w, h


def apply_crop(frame: np.ndarray, box: tuple[int, int, int, int]) -> np.ndarray:
    x, y, w, h = box
    return frame[y:y + h, x:x + w]


def metrics(bgr: np.ndarray) -> dict:
    return {
        "lap_var": round(lap_var(bgr), 2),
        "hf_ratio": round(hf_ratio(bgr), 5),
        "mean_luma": round(mean_luma(bgr), 1),
        "dims": [int(bgr.shape[1]), int(bgr.shape[0])],
    }


def encode_variant(fixture: str, variant: Variant, scn: Scenario,
                   out_path: Path) -> str | None:
    """Encode the whole sample window for one variant via ffmpeg crop+scale+x264.

    Mirrors the local MockVideoUpscaler path (crop + Lanczos resize) and the
    documented Modal final-encode profile (libx264 -crf 23 -preset fast). Uses
    the START box for the ffmpeg crop (ffmpeg crop is static); the panning case
    is covered frame-by-frame in the metrics pass. Returns the output path or
    None if ffmpeg failed.
    """
    x, y, w, h = variant.start_box
    ow, oh = scn.output_res
    vf = (f"crop={w}:{h}:{x}:{y},"
          f"scale={ow}:{oh}:flags=lanczos")
    cmd = [
        "ffmpeg", "-v", "error", "-y",
        "-ss", str(scn.start_s), "-to", str(scn.end_s),
        "-i", fixture,
        "-vf", vf,
        "-c:v", "libx264", "-crf", str(ENCODE_CRF), "-preset", ENCODE_PRESET,
        "-pix_fmt", "yuv420p", "-an",
        str(out_path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        print(f"  ! ffmpeg encode failed for {variant.name}: "
              f"{proc.stderr.strip()[:200]}", file=sys.stderr)
        return None
    return str(out_path)


def sample_encoded(path: str, ow: int, oh: int, n: int = 6) -> list[dict]:
    """Re-decode a few frames from an encoded mp4 to measure encode drift."""
    cap = cv2.VideoCapture(path)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1
    out = []
    for i in range(n):
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(total * i / n))
        ok, frame = cap.read()
        if ok:
            out.append(metrics(frame))
    cap.release()
    return out


def run(scn: Scenario, out_dir: Path) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    fixture = scn.fixture
    cap = cv2.VideoCapture(fixture)
    if not cap.isOpened():
        raise SystemExit(f"cannot open fixture: {fixture}")
    W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    src_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    ow, oh = scn.output_res

    timestamps = list(np.arange(scn.start_s, scn.end_s,
                                1.0 / scn.sample_fps))
    print(f"Fixture: {fixture}  {W}x{H} @ {src_fps:.3f}fps")
    print(f"Window: {scn.start_s}-{scn.end_s}s  cadence {scn.sample_fps}fps "
          f"({len(timestamps)} matched timestamps)  output {ow}x{oh}")
    print("!! Upscale stage = Lanczos ONLY (MockVideoUpscaler-equivalent). "
          "Real-ESRGAN GAN NOT exercised: numbers are a no-GAN lower bound.\n")

    result: dict = {
        "fixture": fixture,
        "fixture_dims": [W, H],
        "fixture_fps": round(src_fps, 3),
        "output_res": [ow, oh],
        "window_s": [scn.start_s, scn.end_s],
        "sample_fps": scn.sample_fps,
        "gan_exercised": False,
        "upscaler": "lanczos (MockVideoUpscaler-equivalent); GAN unmeasurable "
                    "in this environment (no CUDA/torch)",
        "variants": {},
    }

    for var in scn.variants:
        ex, ey, ew, eh = var.start_box
        enlarge = ow / ew
        print(f"[{var.name}] source crop {ew}x{eh}  enlarge {enlarge:.2f}x")
        per_ts = []
        prev_centroid = None
        jitter_acc = []
        montage_dir = out_dir / var.name
        montage_dir.mkdir(exist_ok=True)
        for idx, ts in enumerate(timestamps):
            cap.set(cv2.CAP_PROP_POS_MSEC, ts * 1000.0)
            ok, frame = cap.read()
            if not ok:
                continue
            t = 0.0 if var.end_box is None or len(timestamps) < 2 \
                else idx / (len(timestamps) - 1)
            box = var.start_box if var.end_box is None \
                else lerp_box(var.start_box, var.end_box, t)
            box = clamp_box(box, W, H)
            cropped = apply_crop(frame, box)
            enlarged = cv2.resize(cropped, (ow, oh),
                                  interpolation=cv2.INTER_LANCZOS4)

            cx, cy = box[0] + box[2] / 2, box[1] + box[3] / 2
            if prev_centroid is not None:
                jitter_acc.append(
                    float(np.hypot(cx - prev_centroid[0],
                                   cy - prev_centroid[1])))
            prev_centroid = (cx, cy)

            row = {
                "t_s": round(float(ts), 3),
                "crop_box": list(box),
                "enlarge_x": round(enlarge, 3),
                "source_crop": metrics(cropped),
                "enlarged": metrics(enlarged),
            }
            # subject-visibility: subject height as a share of the crop height
            if scn.subject_box is not None:
                _, _, _, sh = scn.subject_box
                row["subject_share_of_crop_h"] = round(sh / box[3], 4)
            per_ts.append(row)

            # save a montage every ~1s of window for visual review
            if idx % max(1, int(scn.sample_fps)) == 0:
                _save_montage(montage_dir / f"t{ts:0.2f}.png",
                              frame, cropped, enlarged)

        enc_path = out_dir / f"{var.name}.mp4"
        encoded = encode_variant(fixture, var, scn, enc_path)
        enc_samples = sample_encoded(encoded, ow, oh) if encoded else []

        lvs = [r["enlarged"]["lap_var"] for r in per_ts]
        lumas = [r["enlarged"]["mean_luma"] for r in per_ts]
        agg = {
            "enlarge_x": round(enlarge, 3),
            "source_crop_dims": [ew, eh],
            "lap_var_mean_enlarged": round(float(np.mean(lvs)), 2) if lvs else None,
            "lap_var_std_enlarged": round(float(np.std(lvs)), 2) if lvs else None,
            "lap_var_mean_source_crop": round(
                float(np.mean([r["source_crop"]["lap_var"] for r in per_ts])), 2)
                if per_ts else None,
            "black_frac": round(
                sum(1 for l in lumas if l < BLACK_LUMA_THRESHOLD) / len(lumas), 4)
                if lumas else None,
            "centroid_jitter_px": round(float(np.mean(jitter_acc)), 3)
                if jitter_acc else 0.0,
            "encoded_mp4": encoded,
            "encoded_lap_var_mean": round(
                float(np.mean([s["lap_var"] for s in enc_samples])), 2)
                if enc_samples else None,
        }
        if scn.subject_box is not None and per_ts:
            agg["subject_share_of_crop_h_mean"] = round(
                float(np.mean([r["subject_share_of_crop_h"] for r in per_ts])), 4)
        result["variants"][var.name] = {"aggregate": agg, "per_timestamp": per_ts}
        print(f"  lap_var enlarged mean={agg['lap_var_mean_enlarged']} "
              f"std={agg['lap_var_std_enlarged']}  "
              f"black_frac={agg['black_frac']}  "
              f"jitter={agg['centroid_jitter_px']}px  "
              f"encoded={agg['encoded_lap_var_mean']}\n")

    cap.release()
    (out_dir / "results.json").write_text(json.dumps(result, indent=2))
    _print_summary(result)
    print(f"\nWrote {out_dir/'results.json'} + montages + encoded mp4s.")
    return result


def _save_montage(path: Path, source: np.ndarray, cropped: np.ndarray,
                  enlarged: np.ndarray) -> None:
    """source (scaled to output height) | crop | enlarged, side by side."""
    oh = enlarged.shape[0]
    def fit_h(img):
        h, w = img.shape[:2]
        return cv2.resize(img, (int(w * oh / h), oh))
    tiles = [fit_h(source), fit_h(cropped), enlarged]
    cv2.imwrite(str(path), cv2.hconcat(tiles))


def _print_summary(result: dict) -> None:
    print("=" * 72)
    print(f"{'variant':<18}{'enlarge':>8}{'src_crop_lv':>13}"
          f"{'enlarged_lv':>13}{'lv_std':>8}{'subj%':>8}")
    print("-" * 72)
    for name, v in result["variants"].items():
        a = v["aggregate"]
        subj = a.get("subject_share_of_crop_h_mean")
        # aggregates are None only for an empty (start_s == end_s) window
        def cell(x):
            return "-" if x is None else x
        print(f"{name:<18}{a['enlarge_x']:>7.2f}x"
              f"{cell(a['lap_var_mean_source_crop']):>13}"
              f"{cell(a['lap_var_mean_enlarged']):>13}"
              f"{cell(a['lap_var_std_enlarged']):>8}"
              f"{(f'{subj*100:.1f}' if subj is not None else '-'):>8}")
    print("=" * 72)
    print("Higher enlarged_lv = sharper. Interpret RELATIVELY (same output "
          "grid); GAN not exercised, so these are no-GAN lower bounds.")


def load_scenario(config_path: str | None, fixture: str | None) -> Scenario:
    if config_path:
        data = json.loads(Path(config_path).read_text())
        variants = [Variant(**v) for v in data.pop("variants", [])]
        # tuples arrive as lists from JSON; normalise the ones we index as tuples
        for v in variants:
            v.start_box = tuple(v.start_box)
            v.end_box = tuple(v.end_box) if v.end_box else None
        scn = Scenario(variants=variants, **data)
        scn.output_res = tuple(scn.output_res)
        if scn.subject_box:
            scn.subject_box = tuple(scn.subject_box)
        return scn
    if not fixture:
        raise SystemExit("provide --fixture or --config")
    return default_scenario(fixture)


def main() -> None:
    ap = argparse.ArgumentParser(description="T9970 highlight quality benchmark")
    ap.add_argument("--fixture", help="path to source video fixture")
    ap.add_argument("--config", help="JSON scenario file (overrides --fixture)")
    ap.add_argument("--out", default="/tmp/t9970-benchmark",
                    help="output directory")
    args = ap.parse_args()

    if not shutil.which("ffmpeg"):
        raise SystemExit("ffmpeg not found on PATH")
    scn = load_scenario(args.config, args.fixture)
    run(scn, Path(args.out))


if __name__ == "__main__":
    main()
