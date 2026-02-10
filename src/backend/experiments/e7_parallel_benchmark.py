"""
E7: Sequential vs Parallel Benchmark for Framing AI

Compares sequential process_framing_ai vs parallel process_framing_ai_parallel
with 2 and 4 chunks.

Based on E6 results:
    - T4 processes at ~1.47 fps (681ms/frame)
    - 6s clip (180 frames) takes ~122s sequential

Expected parallel results:
    - 2 chunks: ~61s processing + ~20s overhead = ~81s (33% faster)
    - 4 chunks: ~31s processing + ~25s overhead = ~56s (54% faster)

Prerequisites:
    - Test video in R2 at modal_test/test_videos/wcfc-carlsbad-trimmed.mp4
    - Modal functions deployed with process_framing_ai_parallel

Run from src/backend:
    python experiments/e7_parallel_benchmark.py
"""

import sys
import os
import time
import json
from pathlib import Path
from datetime import datetime

# Load .env file from project root
from dotenv import load_dotenv
env_path = Path(__file__).parent.parent.parent.parent / ".env"
load_dotenv(env_path)

# Add app to path
sys.path.insert(0, str(Path(__file__).parent.parent))

# Modal app configuration - use v2 (the deployed one)
MODAL_APP_NAME = "reel-ballers-video-v2"

# Test configuration - use real video from user "a"
TEST_USER_ID = "a"
TEST_VIDEO_KEY = "working_videos/working_18_fec5c8fe.mp4"  # 8.61 MB

# Process full video (no trimming to test parallel on real data)
# The parallel orchestrator will get video info automatically
CLIP_START = None
CLIP_END = None

# Crop region (9:16 vertical crop - center of 1920x1080)
CROP_KEYFRAMES = [
    {"time": 0, "x": 420, "y": 0, "width": 1080, "height": 1080}  # Square crop
]

# Output settings
OUTPUT_WIDTH = 810
OUTPUT_HEIGHT = 1440
FPS = 30

# Results file
RESULTS_FILE = Path(__file__).parent / "e7_parallel_benchmark_results.json"

# Modal pricing
T4_RATE = 0.000164  # $/second per GPU


def measure_sequential(job_id: str) -> dict:
    """Run sequential process_framing_ai and measure time."""
    import modal

    fn = modal.Function.from_name(MODAL_APP_NAME, "process_framing_ai")

    print(f"\n{'='*60}")
    print(f"SEQUENTIAL: process_framing_ai")
    print(f"Job ID: {job_id}")
    print(f"Started: {datetime.now().isoformat()}")

    start = time.time()

    # Use remote_gen to stream progress
    # Note: Don't pass segment_data to allow parallel processing comparison
    gen = fn.remote_gen(
        job_id=job_id,
        user_id=TEST_USER_ID,
        input_key=TEST_VIDEO_KEY,
        output_key=f"test_outputs/e7_seq_{job_id}.mp4",
        keyframes=CROP_KEYFRAMES,
        output_width=OUTPUT_WIDTH,
        output_height=OUTPUT_HEIGHT,
        fps=FPS,
    )

    result = None
    for update in gen:
        if "status" in update:
            result = update
            break
        progress = update.get("progress", 0)
        phase = update.get("phase", "")
        if progress % 10 == 0:
            print(f"  Progress: {progress}% ({phase})")

    elapsed = time.time() - start
    status = result.get("status", "unknown") if result else "no_result"
    frames = result.get("frames_processed", 0) if result else 0
    error = result.get("error", "") if result else ""

    print(f"Completed in {elapsed:.1f}s - Status: {status}")
    if error:
        print(f"ERROR: {error}")
    print(f"Frames processed: {frames}")
    print(f"Effective FPS: {frames/elapsed:.2f}")

    return {
        "type": "sequential",
        "elapsed_seconds": elapsed,
        "frames_processed": frames,
        "fps": frames / elapsed if elapsed > 0 else 0,
        "cost": elapsed * T4_RATE,
        "status": status,
        "error": error,
    }


def measure_parallel(job_id: str, num_chunks: int) -> dict:
    """Run parallel process_framing_ai_parallel and measure time."""
    import modal

    fn = modal.Function.from_name(MODAL_APP_NAME, "process_framing_ai_parallel")

    print(f"\n{'='*60}")
    print(f"PARALLEL ({num_chunks} chunks): process_framing_ai_parallel")
    print(f"Job ID: {job_id}")
    print(f"Started: {datetime.now().isoformat()}")

    start = time.time()

    # Use remote_gen to stream progress
    gen = fn.remote_gen(
        job_id=job_id,
        user_id=TEST_USER_ID,
        input_key=TEST_VIDEO_KEY,
        output_key=f"test_outputs/e7_par{num_chunks}_{job_id}.mp4",
        keyframes=CROP_KEYFRAMES,
        output_width=OUTPUT_WIDTH,
        output_height=OUTPUT_HEIGHT,
        fps=FPS,
        num_chunks=num_chunks,
    )

    result = None
    for update in gen:
        if "status" in update:
            result = update
            break
        progress = update.get("progress", 0)
        phase = update.get("phase", "")
        message = update.get("message", "")
        print(f"  Progress: {progress}% ({phase}) - {message}")

    elapsed = time.time() - start
    status = result.get("status", "unknown") if result else "no_result"
    frames = result.get("frames_processed", 0) if result else 0
    error = result.get("error", "") if result else ""

    print(f"Completed in {elapsed:.1f}s - Status: {status}")
    if error:
        print(f"ERROR: {error}")
    print(f"Frames processed: {frames}")
    print(f"Effective FPS: {frames/elapsed:.2f}")

    # Cost includes all GPU time (num_chunks * parallel_time + orchestrator)
    # Approximation: assume each chunk runs for elapsed/num_chunks * 0.8 (80% parallelism)
    estimated_gpu_seconds = elapsed * num_chunks * 0.6  # rough estimate

    return {
        "type": f"parallel_{num_chunks}",
        "num_chunks": num_chunks,
        "elapsed_seconds": elapsed,
        "frames_processed": frames,
        "fps": frames / elapsed if elapsed > 0 else 0,
        "cost_estimate": estimated_gpu_seconds * T4_RATE,
        "status": status,
        "error": error,
    }


def run_benchmark():
    """Run sequential vs parallel benchmark."""
    print("=" * 60)
    print("E7: SEQUENTIAL vs PARALLEL BENCHMARK")
    print("=" * 60)
    print(f"Modal App: {MODAL_APP_NAME}")
    print(f"Test User: {TEST_USER_ID}")
    print(f"Test Video: {TEST_VIDEO_KEY}")
    print(f"Output: {OUTPUT_WIDTH}x{OUTPUT_HEIGHT} @ {FPS}fps")
    print()

    job_prefix = f"e7_{int(time.time())}"
    results = []

    # Test 1: Sequential
    print("\n" + "=" * 60)
    print("TEST 1: Sequential (1 GPU)")
    print("=" * 60)
    seq_result = measure_sequential(f"{job_prefix}_seq")
    results.append(seq_result)

    # Test 2: Parallel with 2 chunks
    print("\n" + "=" * 60)
    print("TEST 2: Parallel (2 GPUs)")
    print("=" * 60)
    par2_result = measure_parallel(f"{job_prefix}_par2", num_chunks=2)
    results.append(par2_result)

    # Test 3: Parallel with 4 chunks
    print("\n" + "=" * 60)
    print("TEST 3: Parallel (4 GPUs)")
    print("=" * 60)
    par4_result = measure_parallel(f"{job_prefix}_par4", num_chunks=4)
    results.append(par4_result)

    # Summary
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)

    seq_time = seq_result["elapsed_seconds"]

    print(f"\n{'Config':<20} {'Time':>10} {'Speedup':>10} {'FPS':>8}")
    print("-" * 50)

    for r in results:
        speedup = seq_time / r["elapsed_seconds"] if r["elapsed_seconds"] > 0 else 0
        print(f"{r['type']:<20} {r['elapsed_seconds']:>8.1f}s {speedup:>9.2f}x {r['fps']:>7.2f}")

    # Save results
    output = {
        "timestamp": datetime.now().isoformat(),
        "job_prefix": job_prefix,
        "test_config": {
            "user_id": TEST_USER_ID,
            "video_key": TEST_VIDEO_KEY,
            "output_size": f"{OUTPUT_WIDTH}x{OUTPUT_HEIGHT}",
            "fps": FPS,
        },
        "results": results,
        "analysis": {
            "sequential_time": seq_time,
            "par2_speedup": seq_time / par2_result["elapsed_seconds"] if par2_result["elapsed_seconds"] > 0 else 0,
            "par4_speedup": seq_time / par4_result["elapsed_seconds"] if par4_result["elapsed_seconds"] > 0 else 0,
        }
    }

    with open(RESULTS_FILE, "w") as f:
        json.dump(output, f, indent=2)

    print(f"\nResults saved to: {RESULTS_FILE}")

    return output


if __name__ == "__main__":
    run_benchmark()
