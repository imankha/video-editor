"""
Parallelization Analysis Experiment

Comprehensive test of parallel vs sequential processing to validate cost assumptions.

Tests:
1. Sequential overlay (1 GPU) - baseline
2. Parallel overlay (2, 4 GPUs) - verify overhead
3. CPU overlay - verify cost savings
4. Warm vs cold container impact

This experiment helps us determine:
- Is parallel processing ever cost-effective for overlay?
- What's the real overhead of parallelization?
- How much does cold start impact cost?

Prerequisites:
    - Test video uploaded to R2 (run upload_test_data.py first)
    - Modal functions deployed (modal deploy video_processing.py)

Run from src/backend:
    python experiments/e_parallel_analysis.py
"""

import sys
import os
import time
import json
from pathlib import Path
from datetime import datetime
from typing import Optional

# Load .env file from project root
from dotenv import load_dotenv
env_path = Path(__file__).parent.parent.parent.parent / ".env"
load_dotenv(env_path)

# Add app to path
sys.path.insert(0, str(Path(__file__).parent.parent))

import modal

# ============================================================================
# CONFIGURATION
# ============================================================================

MODAL_APP_NAME = "reel-ballers-video"
TEST_USER_ID = "modal_test"
TEST_VIDEO_KEY = "test_videos/wcfc-carlsbad-trimmed.mp4"

# Highlight regions for overlay test
HIGHLIGHT_REGIONS = [{
    "start_time": 1.0,
    "end_time": 4.0,
    "keyframes": [
        {"time": 1.0, "x": 270, "y": 480, "radiusX": 150, "radiusY": 150, "opacity": 0.15},
        {"time": 4.0, "x": 350, "y": 500, "radiusX": 180, "radiusY": 180, "opacity": 0.15},
    ]
}]

# Modal pricing
T4_RATE = 0.000164  # $/second
CPU_RATE = 0.0000262  # $/second (2 cores)

RESULTS_FILE = Path(__file__).parent / "e_parallel_results.json"


# ============================================================================
# CPU OVERLAY FUNCTION (for comparison)
# ============================================================================

cpu_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "libgl1-mesa-glx", "libglib2.0-0")
    .pip_install(
        "opencv-python-headless>=4.8.0",
        "numpy>=1.24.0",
        "boto3>=1.28.0",
    )
)

cpu_app = modal.App("e-parallel-cpu-overlay")


def get_r2_client():
    """Create R2 client from environment."""
    import boto3
    from botocore.config import Config
    return boto3.client(
        's3',
        endpoint_url=os.environ['R2_ENDPOINT_URL'],
        aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'],
        aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'],
        config=Config(signature_version="s3v4"),
        region_name='auto',
    )


@cpu_app.function(
    image=cpu_image,
    cpu=2.0,
    memory=4096,
    timeout=600,
    secrets=[modal.Secret.from_name("r2-credentials")],
)
def render_overlay_cpu_test(
    job_id: str,
    user_id: str,
    input_key: str,
    output_key: str,
    highlight_regions: list,
):
    """CPU-only overlay for cost comparison."""
    import cv2
    import numpy as np
    import tempfile
    import subprocess

    start_total = time.time()

    print(f"[CPU] Starting: {job_id}")
    r2 = get_r2_client()
    bucket = os.environ['R2_BUCKET_NAME']

    # Download
    start_download = time.time()
    with tempfile.NamedTemporaryFile(suffix='.mp4', delete=False) as tmp_in:
        input_path = tmp_in.name
        r2.download_file(bucket, f"{user_id}/{input_key}", input_path)
    download_time = time.time() - start_download
    print(f"[CPU] Download: {download_time:.2f}s")

    # Get video info
    cap = cv2.VideoCapture(input_path)
    fps = cap.get(cv2.CAP_PROP_FPS)
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    cap.release()
    print(f"[CPU] Video: {width}x{height} @ {fps}fps, {frame_count} frames")

    # Process frames
    with tempfile.NamedTemporaryFile(suffix='.mp4', delete=False) as tmp_out:
        output_path = tmp_out.name

    # FFmpeg decode -> process -> encode pipeline
    decode_cmd = [
        'ffmpeg', '-i', input_path,
        '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-'
    ]
    encode_cmd = [
        'ffmpeg', '-y',
        '-f', 'rawvideo', '-pix_fmt', 'bgr24',
        '-s', f'{width}x{height}', '-r', str(fps),
        '-i', '-',
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
        '-pix_fmt', 'yuv420p',
        output_path
    ]

    start_process = time.time()
    decoder = subprocess.Popen(decode_cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    encoder = subprocess.Popen(encode_cmd, stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)

    frame_size = width * height * 3
    frame_idx = 0
    sorted_regions = sorted(highlight_regions, key=lambda r: r["start_time"])

    while True:
        raw_frame = decoder.stdout.read(frame_size)
        if len(raw_frame) < frame_size:
            break

        frame = np.frombuffer(raw_frame, dtype=np.uint8).reshape((height, width, 3)).copy()
        current_time = frame_idx / fps

        # Apply overlay (same logic as GPU version)
        for region in sorted_regions:
            if region["start_time"] <= current_time <= region["end_time"]:
                keyframes = region.get("keyframes", [])
                if keyframes:
                    # Interpolate keyframe
                    kf = keyframes[0]  # Simplified
                    for k in keyframes:
                        if k["time"] <= current_time:
                            kf = k

                    mask = np.zeros((height, width), dtype=np.uint8)
                    center = (int(kf["x"]), int(kf["y"]))
                    axes = (int(kf["radiusX"]), int(kf["radiusY"]))
                    cv2.ellipse(mask, center, axes, 0, 0, 360, 255, -1)

                    opacity = kf.get("opacity", 0.15)
                    darkened = (frame * (1 - opacity)).astype(np.uint8)
                    frame = np.where(mask[:, :, np.newaxis] > 0, frame, darkened)
                break

        encoder.stdin.write(frame.tobytes())
        frame_idx += 1

        if frame_idx % 500 == 0:
            print(f"[CPU] Frame {frame_idx}/{frame_count}")

    decoder.stdout.close()
    encoder.stdin.close()
    decoder.wait()
    encoder.wait()

    process_time = time.time() - start_process
    processing_fps = frame_idx / process_time
    print(f"[CPU] Processing: {process_time:.2f}s ({processing_fps:.1f} FPS)")

    # Upload
    start_upload = time.time()
    r2.upload_file(output_path, bucket, f"{user_id}/{output_key}")
    upload_time = time.time() - start_upload
    print(f"[CPU] Upload: {upload_time:.2f}s")

    # Cleanup
    os.unlink(input_path)
    os.unlink(output_path)

    total_time = time.time() - start_total

    return {
        "status": "success",
        "frames_processed": frame_idx,
        "processing_fps": processing_fps,
        "timing": {
            "download": download_time,
            "processing": process_time,
            "upload": upload_time,
            "total": total_time,
        }
    }


# ============================================================================
# TEST FUNCTIONS
# ============================================================================

def measure_modal_function(fn_name: str, **kwargs) -> dict:
    """Call a Modal function and measure execution time."""
    try:
        fn = modal.Function.from_name(MODAL_APP_NAME, fn_name)
    except Exception as e:
        print(f"  ERROR connecting to '{fn_name}': {e}")
        return {"status": "connection_error", "error": str(e), "elapsed_seconds": 0}

    print(f"\n  Calling {fn_name}...")
    start = time.time()
    try:
        result = fn.remote(**kwargs)
        elapsed = time.time() - start
        status = result.get('status', 'unknown') if isinstance(result, dict) else 'completed'
        print(f"  Completed in {elapsed:.1f}s - Status: {status}")
        return {
            "status": status,
            "elapsed_seconds": elapsed,
            "result": result,
        }
    except Exception as e:
        elapsed = time.time() - start
        print(f"  FAILED after {elapsed:.1f}s: {e}")
        return {"status": "error", "error": str(e), "elapsed_seconds": elapsed}


def run_sequential_gpu_test(job_prefix: str) -> dict:
    """Test sequential GPU overlay (render_overlay)."""
    print("\n" + "=" * 60)
    print("TEST: Sequential GPU (render_overlay)")
    print("=" * 60)

    return measure_modal_function(
        'render_overlay',
        job_id=f"{job_prefix}_seq_gpu",
        user_id=TEST_USER_ID,
        input_key=TEST_VIDEO_KEY,
        output_key=f"test_outputs/{job_prefix}_seq_gpu.mp4",
        highlight_regions=HIGHLIGHT_REGIONS,
        effect_type="dark_overlay",
    )


def run_parallel_gpu_test(job_prefix: str, num_chunks: int) -> dict:
    """Test parallel GPU overlay (render_overlay_parallel)."""
    print("\n" + "=" * 60)
    print(f"TEST: Parallel GPU ({num_chunks} chunks)")
    print("=" * 60)

    return measure_modal_function(
        'render_overlay_parallel',
        job_id=f"{job_prefix}_par{num_chunks}_gpu",
        user_id=TEST_USER_ID,
        input_key=TEST_VIDEO_KEY,
        output_key=f"test_outputs/{job_prefix}_par{num_chunks}_gpu.mp4",
        highlight_regions=HIGHLIGHT_REGIONS,
        effect_type="dark_overlay",
        num_chunks=num_chunks,
    )


def run_cpu_test(job_prefix: str) -> dict:
    """Test CPU overlay."""
    print("\n" + "=" * 60)
    print("TEST: CPU Overlay")
    print("=" * 60)

    print("  Deploying CPU function...")
    start = time.time()

    try:
        with cpu_app.run():
            result = render_overlay_cpu_test.remote(
                job_id=f"{job_prefix}_cpu",
                user_id=TEST_USER_ID,
                input_key=TEST_VIDEO_KEY,
                output_key=f"test_outputs/{job_prefix}_cpu.mp4",
                highlight_regions=HIGHLIGHT_REGIONS,
            )
        elapsed = time.time() - start
        return {
            "status": result.get("status", "unknown"),
            "elapsed_seconds": elapsed,
            "result": result,
        }
    except Exception as e:
        elapsed = time.time() - start
        print(f"  FAILED: {e}")
        return {"status": "error", "error": str(e), "elapsed_seconds": elapsed}


def run_warm_container_test(job_prefix: str) -> list:
    """Run same test twice to measure warm vs cold."""
    print("\n" + "=" * 60)
    print("TEST: Warm Container Analysis (2 sequential calls)")
    print("=" * 60)

    results = []
    for i in range(2):
        label = "cold" if i == 0 else "warm"
        print(f"\n  Run {i+1} ({label})...")

        result = measure_modal_function(
            'render_overlay',
            job_id=f"{job_prefix}_warm_{i}",
            user_id=TEST_USER_ID,
            input_key=TEST_VIDEO_KEY,
            output_key=f"test_outputs/{job_prefix}_warm_{i}.mp4",
            highlight_regions=HIGHLIGHT_REGIONS,
            effect_type="dark_overlay",
        )
        result["run"] = i + 1
        result["container_state"] = label
        results.append(result)

        # Brief pause between runs
        if i == 0:
            print("  Waiting 2s before warm run...")
            time.sleep(2)

    return results


# ============================================================================
# MAIN EXPERIMENT
# ============================================================================

def run_full_experiment():
    """Run complete parallelization analysis."""
    print("=" * 60)
    print("PARALLELIZATION ANALYSIS EXPERIMENT")
    print("=" * 60)
    print(f"Test Video: {TEST_USER_ID}/{TEST_VIDEO_KEY}")
    print(f"Timestamp: {datetime.now().isoformat()}")
    print()

    job_prefix = f"exp_parallel_{int(time.time())}"
    results = {
        "timestamp": datetime.now().isoformat(),
        "job_prefix": job_prefix,
        "config": {
            "video_key": TEST_VIDEO_KEY,
            "user_id": TEST_USER_ID,
            "t4_rate": T4_RATE,
            "cpu_rate": CPU_RATE,
        },
        "tests": {},
    }

    # Test 1: Sequential GPU (baseline)
    results["tests"]["sequential_gpu"] = run_sequential_gpu_test(job_prefix)

    # Test 2: Parallel GPU with 2 chunks
    results["tests"]["parallel_2_gpu"] = run_parallel_gpu_test(job_prefix, num_chunks=2)

    # Test 3: Parallel GPU with 4 chunks
    results["tests"]["parallel_4_gpu"] = run_parallel_gpu_test(job_prefix, num_chunks=4)

    # Test 4: CPU overlay
    results["tests"]["cpu"] = run_cpu_test(job_prefix)

    # Test 5: Warm container analysis
    results["tests"]["warm_analysis"] = run_warm_container_test(job_prefix)

    # ========================================================================
    # ANALYSIS
    # ========================================================================
    print("\n" + "=" * 60)
    print("COST ANALYSIS")
    print("=" * 60)

    analysis = {}

    # Calculate costs
    for test_name, test_result in results["tests"].items():
        if test_name == "warm_analysis":
            # Handle list of results
            for run in test_result:
                elapsed = run.get("elapsed_seconds", 0)
                state = run.get("container_state", "unknown")
                cost = elapsed * T4_RATE
                analysis[f"gpu_{state}"] = {
                    "time": elapsed,
                    "cost": cost,
                    "rate": T4_RATE,
                }
                print(f"GPU ({state}): {elapsed:.1f}s = ${cost:.4f}")
        else:
            elapsed = test_result.get("elapsed_seconds", 0)
            if test_name == "cpu":
                cost = elapsed * CPU_RATE
                rate = CPU_RATE
            elif "parallel" in test_name:
                # Parallel uses multiple GPUs - estimate total GPU-seconds
                # The wall time is shorter, but we pay for all parallel containers
                num_chunks = int(test_name.split("_")[1])
                # Rough estimate: each chunk runs for roughly (wall_time - overhead)
                # Plus orchestrator time (CPU)
                estimated_gpu_seconds = elapsed * num_chunks * 0.8  # 80% is GPU work
                cost = estimated_gpu_seconds * T4_RATE + elapsed * 0.2 * CPU_RATE
                rate = T4_RATE
                analysis[test_name] = {
                    "time": elapsed,
                    "estimated_gpu_seconds": estimated_gpu_seconds,
                    "cost": cost,
                    "rate": rate,
                }
                print(f"{test_name}: {elapsed:.1f}s wall, ~{estimated_gpu_seconds:.1f}s GPU = ${cost:.4f}")
                continue
            else:
                cost = elapsed * T4_RATE
                rate = T4_RATE

            analysis[test_name] = {
                "time": elapsed,
                "cost": cost,
                "rate": rate,
            }
            print(f"{test_name}: {elapsed:.1f}s = ${cost:.4f}")

    results["analysis"] = analysis

    # Comparison
    print("\n" + "=" * 60)
    print("COMPARISON SUMMARY")
    print("=" * 60)

    baseline_cost = analysis.get("sequential_gpu", {}).get("cost", 0)

    comparisons = []
    for name, data in analysis.items():
        if name != "sequential_gpu" and baseline_cost > 0:
            cost = data.get("cost", 0)
            diff = cost - baseline_cost
            pct = (diff / baseline_cost) * 100 if baseline_cost else 0

            if diff < 0:
                verdict = f"CHEAPER by ${abs(diff):.4f} ({abs(pct):.1f}%)"
            else:
                verdict = f"MORE EXPENSIVE by ${diff:.4f} ({pct:.1f}%)"

            comparisons.append({
                "test": name,
                "cost": cost,
                "vs_baseline": diff,
                "vs_baseline_pct": pct,
                "verdict": verdict,
            })
            print(f"{name}: {verdict}")

    results["comparisons"] = comparisons

    # Recommendations
    print("\n" + "=" * 60)
    print("RECOMMENDATIONS")
    print("=" * 60)

    recommendations = []

    # Find cheapest option
    all_costs = [(name, data.get("cost", float("inf"))) for name, data in analysis.items()]
    all_costs.sort(key=lambda x: x[1])

    if all_costs:
        cheapest = all_costs[0]
        recommendations.append(f"CHEAPEST: {cheapest[0]} at ${cheapest[1]:.4f}")
        print(f"CHEAPEST: {cheapest[0]} at ${cheapest[1]:.4f}")

        # Check if parallel is ever worth it
        parallel_costs = [c for c in all_costs if "parallel" in c[0]]
        sequential_cost = analysis.get("sequential_gpu", {}).get("cost", 0)

        if parallel_costs and sequential_cost:
            if all(p[1] > sequential_cost for p in parallel_costs):
                recommendations.append("PARALLEL: Never cost-effective for overlay")
                print("PARALLEL: Never cost-effective for overlay (all parallel options cost more)")

    results["recommendations"] = recommendations

    # Save results
    with open(RESULTS_FILE, 'w') as f:
        json.dump(results, f, indent=2, default=str)

    print(f"\nResults saved to: {RESULTS_FILE}")

    return results


if __name__ == "__main__":
    if not os.getenv("MODAL_TOKEN_ID") or not os.getenv("MODAL_TOKEN_SECRET"):
        print("WARNING: MODAL_TOKEN_ID or MODAL_TOKEN_SECRET not set")

    run_full_experiment()
