"""T11590 gap 2 (proof-verifier MORE_PROOF_REQUIRED): measure composed-download
cache MISS vs HIT latency against REAL R2 -- not the local-disk stand-in the
in-container worker used -- by calling the EXACT production functions
`src/backend/app/routers/downloads.py` uses: `compose_serve_time_dispatched`
(the real compose seam, Modal-or-local) + the real cache key builder
(`_download_cache_key`) + the real global-R2 cache helpers
(`r2_head_object_global` / `download_from_r2_global` / `upload_file_to_r2_global`).

No DB, no FastAPI, no auth -- this isolates the actual R2 I/O + compose cost
the acceptance criterion cares about, using the identical code the endpoint
calls, under a disposable scratch prefix.

Run from src/backend, Git Bash, prefix each with: APP_ENV=staging PYTHONUTF8=1
  .venv/Scripts/python.exe experiments/t11590_latency_measurement.py prepare --yes
  .venv/Scripts/python.exe experiments/t11590_latency_measurement.py miss --yes
  .venv/Scripts/python.exe experiments/t11590_latency_measurement.py hit --yes
  .venv/Scripts/python.exe experiments/t11590_latency_measurement.py cleanup --yes

Without --yes, miss/hit/cleanup only print what they would do.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

if os.environ.get("APP_ENV") != "staging":
    sys.exit("REFUSING: set APP_ENV=staging in the dispatching shell.")

from app.routers.downloads import _download_cache_key  # noqa: E402  reuse the REAL key builder
from app.services.branded_outro import outro_enabled  # noqa: E402
from app.services.serve_time_video import compose_serve_time_dispatched  # noqa: E402
from app.storage import (  # noqa: E402
    download_from_r2_global,
    r2_head_object_global,
    upload_file_to_r2_global,
)

SCRATCH_PREFIX = "staging/calibration/t11590"  # literal {env}/users/{uid}/profiles/{pid}-shaped prefix
USER_ID = "calibration_t11590"
LOCAL_REEL = BACKEND / "experiments" / "t11590_results" / "reel.mp4"
RESULTS = BACKEND / "experiments" / "t11590_results" / "latency.json"
SOURCE_KEY = f"{SCRATCH_PREFIX}/source_reel.mp4"  # simulates the final_video object a real miss fetches

CACHE_KEY = _download_cache_key(
    SCRATCH_PREFIX, "reel.mp4", None, "no-card", "", outro_enabled(),
)


def cmd_prepare(args):
    LOCAL_REEL.parent.mkdir(parents=True, exist_ok=True)
    need_synth = not LOCAL_REEL.exists()
    if need_synth and not args.yes:
        print(f"[dry-run] would synthesize a 60s 810x1440@30 test clip at {LOCAL_REEL}, upload to {SOURCE_KEY}")
        return
    if need_synth:
        # Synthetic content on purpose: this measures the compose/cache MECHANISM's
        # real R2 I/O + ffmpeg cost, not anything content-dependent. 60s targets a
        # realistic highlight-reel duration/filesize so the R2 transfer leg of the
        # MISS path (which a tiny clip would make nearly free) is representative.
        cmd = [
            "ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc=size=810x1440:rate=30:duration=60",
            "-f", "lavfi", "-i", "sine=frequency=440:duration=60",
            "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(LOCAL_REEL),
        ]
        subprocess.run(cmd, check=True, capture_output=True)
        print(f"Synthesized {LOCAL_REEL} ({LOCAL_REEL.stat().st_size} bytes)")
    else:
        print(f"Already present: {LOCAL_REEL} ({LOCAL_REEL.stat().st_size} bytes)")
    existing = r2_head_object_global(SOURCE_KEY)
    if existing is not None:
        print(f"Source already uploaded: {SOURCE_KEY} ({existing.get('ContentLength')} bytes)")
        return
    if not args.yes:
        print(f"[dry-run] would upload {LOCAL_REEL} -> {SOURCE_KEY}")
        return
    upload_file_to_r2_global(SOURCE_KEY, LOCAL_REEL, content_type="video/mp4")
    print(f"Uploaded source -> {SOURCE_KEY}")


def cmd_miss(args):
    print(f"cache key: {CACHE_KEY}")
    existing = r2_head_object_global(CACHE_KEY)
    if existing is not None:
        sys.exit(f"REFUSING: cache key already present ({existing.get('ContentLength')} bytes) -- run cleanup first")
    if not args.yes:
        print("[dry-run] would download_from_r2_global(SOURCE_KEY) then compose_serve_time_dispatched(...) "
              "then upload_file_to_r2_global(...) -- i.e. the full real MISS path, not compose alone")
        return
    with tempfile.TemporaryDirectory() as td:
        # Step 1 of the real endpoint's MISS path: fetch the source reel from R2
        # (download.py's "Download the full reel from R2 to a temp file"). Omitting
        # this would make MISS look artificially cheap relative to HIT.
        fetched_path = os.path.join(td, "fetched_source.mp4")
        t_fetch0 = time.perf_counter()
        fetched = download_from_r2_global(SOURCE_KEY, Path(fetched_path))
        t_fetch = time.perf_counter() - t_fetch0
        if not fetched or not os.path.exists(fetched_path):
            sys.exit(f"download_from_r2_global(SOURCE_KEY) failed: fetched={fetched}")

        out_path = os.path.join(td, "composed.mp4")
        report: dict = {}
        t0 = time.perf_counter()
        ok = compose_serve_time_dispatched(
            fetched_path, out_path, user_id=USER_ID, user_prefix=SCRATCH_PREFIX,
            intro=None, outro=True, report=report,
        )
        t_compose = time.perf_counter() - t0
        if not ok or not os.path.exists(out_path):
            sys.exit(f"compose_serve_time_dispatched returned ok={ok}, report={report}")
        size = os.path.getsize(out_path)
        t1 = time.perf_counter()
        uploaded = upload_file_to_r2_global(CACHE_KEY, Path(out_path), content_type="video/mp4")
        t_upload = time.perf_counter() - t1
        total = t_fetch + t_compose + t_upload
        print(f"fetch source: {t_fetch:.3f}s  compose: {t_compose:.3f}s  upload: {t_upload:.3f}s  "
              f"total MISS: {total:.3f}s  size={size}  full_fidelity={report.get('full_fidelity')}  "
              f"uploaded={uploaded}")
        _record("miss", dict(fetch_s=t_fetch, compose_s=t_compose, upload_s=t_upload, total_s=total,
                              size_bytes=size, full_fidelity=report.get("full_fidelity"),
                              degraded_reason=report.get("degraded_reason")))


def cmd_hit(args):
    print(f"cache key: {CACHE_KEY}")
    if not args.yes:
        print("[dry-run] would r2_head_object_global(...) then download_from_r2_global(...)")
        return
    with tempfile.TemporaryDirectory() as td:
        local_path = Path(os.path.join(td, "hit.mp4"))
        t0 = time.perf_counter()
        head = r2_head_object_global(CACHE_KEY)
        t_head = time.perf_counter() - t0
        if head is None:
            sys.exit("REFUSING: no cache object present -- run `miss --yes` first")
        t1 = time.perf_counter()
        ok = download_from_r2_global(CACHE_KEY, local_path)
        t_download = time.perf_counter() - t1
        if not ok or not local_path.exists():
            sys.exit(f"download_from_r2_global failed: ok={ok}")
        size = local_path.stat().st_size
        total = t_head + t_download
        print(f"HEAD: {t_head:.3f}s  download: {t_download:.3f}s  total HIT: {total:.3f}s  size={size}")
        _record("hit", dict(head_s=t_head, download_s=t_download, total_s=total, size_bytes=size))


def _record(kind, data):
    RESULTS.parent.mkdir(parents=True, exist_ok=True)
    rows = []
    if RESULTS.exists():
        rows = json.loads(RESULTS.read_text())
    rows.append({"kind": kind, **data})
    RESULTS.write_text(json.dumps(rows, indent=1))
    print(f"recorded -> {RESULTS}")


def cmd_cleanup(args):
    from dotenv import dotenv_values

    from app.storage import get_r2_client

    client = get_r2_client()
    bucket = os.environ.get("R2_BUCKET") or dotenv_values(BACKEND.parent.parent / ".env")["R2_BUCKET"]
    print(f"would delete: {CACHE_KEY}")
    if args.yes:
        client.delete_object(Bucket=bucket, Key=CACHE_KEY)
        print("deleted")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("prepare")
    p.add_argument("--yes", action="store_true")
    p = sub.add_parser("miss")
    p.add_argument("--yes", action="store_true")
    p = sub.add_parser("hit")
    p.add_argument("--yes", action="store_true")
    p = sub.add_parser("cleanup")
    p.add_argument("--yes", action="store_true")
    a = ap.parse_args()
    {"prepare": cmd_prepare, "miss": cmd_miss, "hit": cmd_hit, "cleanup": cmd_cleanup}[a.cmd](a)


if __name__ == "__main__":
    main()
