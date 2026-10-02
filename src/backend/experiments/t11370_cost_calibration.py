"""T11370: calibrate export_cost_guard.per_frame_cost against REAL Modal STAGING runs.

Calls the PRODUCTION export function (`process_clips_ai`, the path the T11320 guard
models) on the STAGING Modal app. One job = several clips of the SAME 1080p30 source at
DIFFERENT static crop sizes, all in ONE container, so the per-clip in-loop rate isolates
crop-size scaling from cold start / container-to-container variance. Every streamed
progress item is timestamped client-side and appended to a JSONL file as it arrives
(a crash/timeout still leaves usable data).

Subcommands (run from src/backend, Git Bash), prefix each with: APP_ENV=staging PYTHONUTF8=1
  .venv/Scripts/python.exe experiments/t11370_cost_calibration.py plan
  .venv/Scripts/python.exe experiments/t11370_cost_calibration.py prepare --yes
  .venv/Scripts/python.exe experiments/t11370_cost_calibration.py run A --yes   (then B, C)
  .venv/Scripts/python.exe experiments/t11370_cost_calibration.py analyze
  .venv/Scripts/python.exe experiments/t11370_cost_calibration.py billing --start 2026-10-02T18 --end 2026-10-02T21
  .venv/Scripts/python.exe experiments/t11370_cost_calibration.py cleanup --yes

Without --yes, prepare/run/cleanup only print what they WOULD do.
Modal auth: ~/.modal.toml (or MODAL_TOKEN_ID/MODAL_TOKEN_SECRET). R2: root .env R2_* keys,
read with dotenv_values so the .env APP_ENV=dev is NEVER loaded into os.environ.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
from datetime import UTC, datetime
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(BACKEND))

# --- Hard staging gate (before importing anything app-side) -----------------------
if os.environ.get("APP_ENV") != "staging":
    sys.exit("REFUSING: set APP_ENV=staging in the dispatching shell (never prod, never the .env dev value).")

from app.services.modal_client import resolve_modal_app_name  # noqa: E402  single source of truth

# The PRE-T11370 anchor this calibration superseded (now deleted from export_cost_guard.py --
# that module has since been updated WITH this script's findings, so importing its live
# per_frame_cost here would be circular). Hardcoded for historical comparison only.
_OLD_ANCHOR_SECONDS_PER_FRAME = 0.681
_OLD_ANCHOR_CROP_PIXELS = 540 * 960


def _old_model_per_frame_cost(w: int, h: int) -> float:
    return _OLD_ANCHOR_SECONDS_PER_FRAME * (w * h) / _OLD_ANCHOR_CROP_PIXELS


MODAL_APP_NAME = resolve_modal_app_name("staging")
assert MODAL_APP_NAME == "reel-ballers-video-v2-staging", MODAL_APP_NAME
MODAL_FUNCTION = "process_clips_ai"

# --- Fixture ----------------------------------------------------------------------
# staging game: 1920x1080 h264 30/1 fps, 1959.5s (probed 2026-10-02). GAN cost is
# content-independent (fixed conv graph), so any mid-game window works.
GAME_KEY = "staging/games/0d3fa6b94b956b487f070d90a3c9eb0efeea89036aac4258a61f62e6ecbe63e8.mp4"
SEGMENT_START_S = 600.0
SEGMENT_LEN_S = 12.0
CAL_PREFIX = "staging/calibration/t11370"          # passed to Modal as user_id
SOURCE_REL_KEY = "source_1080p30.mp4"               # -> staging/calibration/t11370/source_1080p30.mp4
SRC_W, SRC_H, FPS = 1920, 1080, 30

MEASURE_TRIM = (1.0, 11.0)   # 300 emitted frames per measured clip
WARMUP_TRIM = (1.0, 3.0)     # 60 frames, absorbs CUDA/first-alloc warmup, NOT analyzed

T4_RATE = 0.000164  # $/s (modal-gpu.md)

# job -> (target_w, target_h, [(label, crop_w, crop_h, trim)]). Targets are what
# multi_clip.calculate_multi_clip_resolution produces in prod: 9:16 -> 810x1440
# (for any crop >= ~203 wide), 16:9 1280x720 / 1920x1080 -> 2560x1440.
JOBS = {
    "A": (810, 1440, [
        ("warmup", 205, 365, WARMUP_TRIM),
        ("c205x365", 205, 365, MEASURE_TRIM),
        ("c410x730", 410, 730, MEASURE_TRIM),
        ("c540x960", 540, 960, MEASURE_TRIM),
        ("c607x1080", 607, 1080, MEASURE_TRIM),
    ]),
    "B": (2560, 1440, [
        ("warmup", 205, 365, WARMUP_TRIM),
        ("c205x365", 205, 365, MEASURE_TRIM),
        ("c540x960", 540, 960, MEASURE_TRIM),
        ("c1280x720", 1280, 720, MEASURE_TRIM),
        ("c1920x1080", 1920, 1080, MEASURE_TRIM),
    ]),
    # Replicate of A in a fresh container, REVERSED order: run-to-run (T4 host) variance
    # + rules out in-container drift (thermal / memory growth) masquerading as scaling.
    "C": (810, 1440, [
        ("warmup", 205, 365, WARMUP_TRIM),
        ("c607x1080", 607, 1080, MEASURE_TRIM),
        ("c540x960", 540, 960, MEASURE_TRIM),
        ("c410x730", 410, 730, MEASURE_TRIM),
        ("c205x365", 205, 365, MEASURE_TRIM),
    ]),
}

RESULTS_DIR = BACKEND / "experiments" / "t11370_results"


def _r2():
    import boto3
    from dotenv import dotenv_values
    v = dotenv_values(REPO_ROOT / ".env")
    client = boto3.client(
        "s3", endpoint_url=v["R2_ENDPOINT"], aws_access_key_id=v["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=v["R2_SECRET_ACCESS_KEY"], region_name="auto",
    )
    return client, v["R2_BUCKET"]


def _frames(trim):
    return int(trim[1] * FPS) - int(trim[0] * FPS)


def _clips_data(job):
    _, _, clips = JOBS[job]
    out = []
    for i, (label, w, h, trim) in enumerate(clips):
        out.append({
            "keyframes": [{"time": 0, "x": (SRC_W - w) // 2, "y": (SRC_H - h) // 2, "width": w, "height": h}],
            "segment_data": {"trim_start": trim[0], "trim_end": trim[1]},
            "clipIndex": i,
            "rotation": 0,
            "clipName": label,
        })
    return out


def cmd_plan(_args):
    print(f"Modal app: {MODAL_APP_NAME} / {MODAL_FUNCTION}")
    print(f"Source: {CAL_PREFIX}/{SOURCE_REL_KEY} (from {GAME_KEY} @ {SEGMENT_START_S}s +{SEGMENT_LEN_S}s)")
    grand = 0.0
    for job, (tw, th, clips) in JOBS.items():
        tot = 0.0
        print(f"\nJob {job}: target {tw}x{th}")
        for label, w, h, trim in clips:
            n = _frames(trim)
            est = n * _old_model_per_frame_cost(w, h)
            tot += est
            print(f"  {label:<12} {w}x{h:<5} px={w*h:>8} frames={n:>4}  current-model GAN est={est:7.1f}s")
        print(f"  current-model GAN total ~{tot:.0f}s (+ model load / extract / encode overhead)")
        grand += tot
    print(f"\nAll jobs GAN est ~{grand:.0f}s ~= ${grand * T4_RATE:.2f} T4 (before overhead + CPU/mem)")


def cmd_prepare(args):
    r2, bucket = _r2()
    dest = f"{CAL_PREFIX}/{SOURCE_REL_KEY}"
    try:
        head = r2.head_object(Bucket=bucket, Key=dest)
        print(f"Already present: {dest} ({head['ContentLength']} bytes), nothing to do")
        return
    except r2.exceptions.ClientError:
        pass
    url = r2.generate_presigned_url("get_object", Params={"Bucket": bucket, "Key": GAME_KEY}, ExpiresIn=3600)
    if not args.yes:
        print(f"[dry-run] would extract {SEGMENT_LEN_S}s at {SEGMENT_START_S}s of {GAME_KEY}, re-encode CFR 30fps, upload to {dest}")
        return
    with tempfile.TemporaryDirectory() as td:
        local = os.path.join(td, "src.mp4")
        cmd = ["ffmpeg", "-y", "-ss", str(SEGMENT_START_S), "-i", url, "-t", str(SEGMENT_LEN_S),
               "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "fast", "-crf", "16",
               "-r", str(FPS), "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k",
               "-movflags", "+faststart", local]
        subprocess.run(cmd, check=True, capture_output=True)
        probe_cmd = ["ffprobe", "-v", "error", "-select_streams", "v:0", "-count_frames",
                     "-show_entries", "stream=width,height,r_frame_rate,nb_read_frames", "-of", "json", local]
        probe = json.loads(subprocess.run(probe_cmd, check=True, capture_output=True, text=True).stdout)["streams"][0]
        print(f"Extracted: {probe}")
        need = int(MEASURE_TRIM[1] * FPS)
        geometry_ok = (probe["width"], probe["height"], probe["r_frame_rate"]) == (SRC_W, SRC_H, f"{FPS}/1")
        if not geometry_ok or int(probe["nb_read_frames"]) < need:
            sys.exit(f"REFUSING: extracted source is not {SRC_W}x{SRC_H}@{FPS} with >= {need} frames")
        r2.upload_file(local, bucket, dest, ExtraArgs={"ContentType": "video/mp4"})
        print(f"Uploaded to {dest}")


def cmd_run(args):
    job = args.job
    tw, th, clips = JOBS[job]
    clips_data = _clips_data(job)
    ts = int(time.time())
    job_id = f"t11370_{job}_{ts}"
    out_key = f"out_{job}_{ts}.mp4"
    kwargs = dict(job_id=job_id, user_id=CAL_PREFIX, source_keys=[SOURCE_REL_KEY] * len(clips_data),
                  output_key=out_key, clips_data=clips_data, target_width=tw, target_height=th,
                  fps=FPS, include_audio=True, transition=None)
    print(json.dumps({k: v for k, v in kwargs.items() if k != "clips_data"}, indent=1))
    for c in clips_data:
        print("  ", c["clipName"], c["keyframes"][0], c["segment_data"])
    if not args.yes:
        print(f"[dry-run] would dispatch {MODAL_APP_NAME}/{MODAL_FUNCTION}.remote_gen(...); rerun with --yes")
        return

    import modal
    fn = modal.Function.from_name(MODAL_APP_NAME, MODAL_FUNCTION)
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    path = RESULTS_DIR / f"{job_id}.jsonl"
    meta = {"kind": "meta", "job": job, "job_id": job_id, "app": MODAL_APP_NAME, "fn": MODAL_FUNCTION,
            "target": [tw, th], "clips": [[lab, w, h, list(t)] for (lab, w, h, t) in clips],
            "dispatch_utc": datetime.now(UTC).isoformat()}
    final = None
    with open(path, "w", encoding="utf-8") as f:
        f.write(json.dumps(meta) + "\n")
        t0 = time.perf_counter()
        try:
            for item in fn.remote_gen(**kwargs):
                rec = {"kind": "item", "t": time.perf_counter() - t0, **item}
                f.write(json.dumps(rec, default=str) + "\n")
                f.flush()
                if "current_frame" not in item or item.get("current_frame", 0) % 150 == 0:
                    print(f"{rec['t']:8.1f}s {item.get('phase')} clip={item.get('clip')} {item.get('message')}")
                if item.get("status") in ("success", "error"):
                    final = item
        except Exception as e:  # record, then re-raise: a failed calibration run must be visible
            f.write(json.dumps({"kind": "exception", "t": time.perf_counter() - t0, "error": repr(e)}) + "\n")
            raise
        f.write(json.dumps({"kind": "end", "t": time.perf_counter() - t0,
                            "end_utc": datetime.now(UTC).isoformat()}) + "\n")
    print(f"\nFinal: {final}\nRecorded: {path}")
    if not final or final.get("status") != "success":
        sys.exit(1)


def _linfit(xs, ys):
    import numpy as np
    x, y = np.asarray(xs, float), np.asarray(ys, float)
    b, a = np.polyfit(x, y, 1)
    pred = a + b * x
    ss_res = float(((y - pred) ** 2).sum())
    ss_tot = float(((y - y.mean()) ** 2).sum()) or 1e-12
    return a, b, 1 - ss_res / ss_tot, (y - pred) / pred


def _first_t(items, pred):
    return next((i["t"] for i in items if pred(i)), None)


def _analyze_file(path):
    with open(path, encoding="utf-8") as fh:
        lines = [json.loads(x) for x in fh]
    meta = lines[0]
    items = [x for x in lines if x["kind"] == "item"]
    clips = meta["clips"]
    first_t = items[0]["t"]
    complete = next((i for i in items if i.get("status") == "success"), None)
    t_load0 = _first_t(items, lambda i: i.get("phase") == "loading_model" and i.get("progress") == 12)
    t_load1 = _first_t(items, lambda i: i.get("phase") == "loading_model" and i.get("progress") == 15)
    print(f"\n== {meta['job_id']} target {meta['target']} ==")
    print(f"queue+cold start (call to first item): {first_t:.1f}s")
    if t_load0 is not None and t_load1 is not None:
        print(f"model load: {t_load1 - t_load0:.1f}s")
    if complete:
        print(f"in-function wall (first item to success; what timeout=3600 bounds): {complete['t'] - first_t:.1f}s")
    rows = []
    for ci, (label, w, h, trim) in enumerate(clips, start=1):
        start = _first_t(items, lambda i, ci=ci: i.get("phase") == "upscaling" and i.get("clip") == ci
                         and "current_frame" not in i)
        pts = [(i["current_frame"], i["t"]) for i in items
               if i.get("phase") == "upscaling" and i.get("clip") == ci and "current_frame" in i]
        enc = _first_t(items, lambda i, ci=ci: i.get("phase") == "encoding" and i.get("clip") == ci)
        nxt = None
        if enc is not None:
            nxt = _first_t(items, lambda i, ci=ci, enc=enc: i["t"] > enc and (
                i.get("phase") == "concatenating"
                or (i.get("phase") == "upscaling" and i.get("clip") == ci + 1)))
        if len(pts) < 3:
            print(f"  {label}: insufficient frame yields ({len(pts)})")
            continue
        pts = pts[1:]  # drop first window (per-clip first-frame effects)
        a_c, slope, r2, _ = _linfit([p[0] for p in pts], [p[1] for p in pts])
        extract_overhead = (a_c - start) if start is not None else float("nan")
        encode_s = (nxt - enc) if (enc is not None and nxt is not None) else float("nan")
        n = _frames(trim)
        model = _old_model_per_frame_cost(w, h)
        rows.append(dict(label=label, w=w, h=h, px=w * h, slope=slope, fit_r2=r2, extract=extract_overhead,
                         encode=encode_s, encode_per_frame=encode_s / n, model=model))
        print(f"  {label:<12} px={w*h:>8} loop={slope:.4f}s/f (r2={r2:.4f}) model={model:.4f}s/f "
              f"ratio={slope / model:.2f}  extract+seek={extract_overhead:.1f}s "
              f"encode+cleanup={encode_s:.1f}s ({encode_s / n:.4f}s/f)")
    meas = [r for r in rows if r["label"] != "warmup"]
    if len(meas) >= 3:
        a, b, r2, resid = _linfit([r["px"] for r in meas], [r["slope"] for r in meas])
        print(f"  FIT loop s/frame = {a:.4f} + {b * 1e6:.4f}e-6 * px   R2={r2:.5f}  "
              f"residuals%={[round(100 * float(x), 1) for x in resid]}")
        print(f"  current model:     0 + {0.681 / 518400 * 1e6:.4f}e-6 * px   "
              f"(fit intercept share at 410x730: {100 * a / (a + b * 299300):.0f}%)")
    return meta, rows


def cmd_analyze(_args):
    files = sorted(RESULTS_DIR.glob("t11370_*.jsonl"))
    if not files:
        sys.exit(f"no results in {RESULTS_DIR}")
    pooled = {}
    for p in files:
        meta, rows = _analyze_file(p)
        pooled.setdefault(tuple(meta["target"]), []).extend(r for r in rows if r["label"] != "warmup")
    for key, rows in pooled.items():
        if len({r["label"] for r in rows}) >= 3:
            a, b, r2, resid = _linfit([r["px"] for r in rows], [r["slope"] for r in rows])
            worst = 100 * max(abs(float(x)) for x in resid)
            print(f"\nPOOLED target {key}: s/frame = {a:.4f} + {b * 1e6:.4f}e-6*px  R2={r2:.5f}  "
                  f"n={len(rows)}  max|resid|={worst:.1f}%")


def cmd_billing(args):
    import modal.billing
    start = datetime.fromisoformat(args.start).replace(tzinfo=UTC)
    end = datetime.fromisoformat(args.end).replace(tzinfo=UTC)
    rows = modal.billing.workspace_billing_report(start=start, end=end, resolution="h")
    tot = 0.0
    for r in rows:
        if r["description"] == MODAL_APP_NAME:
            tot += float(r["cost"])
            print(r["interval_start"], r["cost"])
    print(f"staging app billed ${tot:.4f} in window (GPU+CPU+mem; / T4_RATE = {tot / T4_RATE:.0f}s "
          f"T4-equivalent upper bound)")
    print("NOTE: hourly UTC buckets; only clean if nothing else ran on staging Modal in those hours.")


def cmd_cleanup(args):
    r2, bucket = _r2()
    listing = r2.list_objects_v2(Bucket=bucket, Prefix=CAL_PREFIX + "/")
    keys = [o["Key"] for o in listing.get("Contents", [])]
    assert all(k.startswith("staging/calibration/t11370/") for k in keys)
    print("\n".join(keys) or "(nothing)")
    if args.yes and keys:
        r2.delete_objects(Bucket=bucket, Delete={"Objects": [{"Key": k} for k in keys]})
        print(f"deleted {len(keys)}")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("plan")
    p = sub.add_parser("prepare")
    p.add_argument("--yes", action="store_true")
    p = sub.add_parser("run")
    p.add_argument("job", choices=sorted(JOBS))
    p.add_argument("--yes", action="store_true")
    sub.add_parser("analyze")
    p = sub.add_parser("billing")
    p.add_argument("--start", required=True)
    p.add_argument("--end", required=True)
    p = sub.add_parser("cleanup")
    p.add_argument("--yes", action="store_true")
    a = ap.parse_args()
    handlers = {"plan": cmd_plan, "prepare": cmd_prepare, "run": cmd_run, "analyze": cmd_analyze,
                "billing": cmd_billing, "cleanup": cmd_cleanup}
    handlers[a.cmd](a)


if __name__ == "__main__":
    main()
