"""
E6 Part 2: Optimized GPU Benchmark for Real-ESRGAN

Tests various optimization techniques on both T4 and L4 GPUs:
1. Baseline (current implementation)
2. cudnn.benchmark enabled
3. torch.compile() with different modes
4. Batch processing (multiple frames at once)
5. Combined optimizations

Run from src/backend:
    modal deploy app/modal_functions/video_processing_optimized.py
    python experiments/e6_optimized_benchmark.py
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

sys.path.insert(0, str(Path(__file__).parent.parent))

MODAL_APP_NAME = "reel-ballers-video-optimized"
TEST_USER_ID = "modal_test"
TEST_VIDEO_KEY = "test_videos/wcfc-carlsbad-trimmed.mp4"

# Test configuration
CLIP_START = 3.0
CLIP_END = 9.0  # 6 seconds = 180 frames
EXPECTED_FRAMES = 180

CROP_KEYFRAMES = [
    {"time": 0, "x": 690, "y": 60, "width": 540, "height": 960}
]

RESULTS_FILE = Path(__file__).parent / "e6_optimized_results.json"

# Modal pricing
T4_RATE = 0.000164
L4_RATE = 0.000222


def measure_modal_function(fn_name: str, **kwargs) -> dict:
    """Call a Modal function and measure execution time."""
    import modal

    try:
        fn = modal.Function.from_name(MODAL_APP_NAME, fn_name)
    except Exception as e:
        print(f"  ERROR: Could not connect to '{fn_name}': {e}")
        return {
            "function": fn_name,
            "elapsed_seconds": 0,
            "status": "connection_error",
            "result": None,
            "error": str(e),
        }

    print(f"\n  Testing: {fn_name}")
    print(f"  Started: {datetime.now().strftime('%H:%M:%S')}")

    start = time.time()
    try:
        result = fn.remote(**kwargs)
        elapsed = time.time() - start
        status = result.get('status', 'unknown') if isinstance(result, dict) else 'completed'

        fps = 0
        if isinstance(result, dict) and 'frames_processed' in result:
            fps = result['frames_processed'] / elapsed

        print(f"  Completed in {elapsed:.1f}s - Status: {status} - FPS: {fps:.2f}")

        return {
            "function": fn_name,
            "elapsed_seconds": elapsed,
            "status": status,
            "result": result,
            "fps": fps,
            "error": None,
        }
    except Exception as e:
        elapsed = time.time() - start
        print(f"  FAILED after {elapsed:.1f}s - Error: {e}")
        return {
            "function": fn_name,
            "elapsed_seconds": elapsed,
            "status": "error",
            "result": None,
            "fps": 0,
            "error": str(e),
        }


def run_benchmark():
    """Run comprehensive optimization benchmark."""
    print("=" * 70)
    print("E6 PART 2: OPTIMIZED GPU BENCHMARK")
    print("=" * 70)
    print(f"Test: {EXPECTED_FRAMES} frames (6s @ 30fps)")
    print(f"Crop: 540x960 -> 4x upscale -> 1080x1920")
    print()

    job_prefix = f"e6opt_{int(time.time())}"
    all_results = []

    # Define test configurations
    tests = [
        # T4 tests
        ("process_framing_ai_t4_baseline", "T4", "baseline"),
        ("process_framing_ai_t4_cudnn", "T4", "cudnn.benchmark"),
        ("process_framing_ai_t4_compiled", "T4", "torch.compile"),
        ("process_framing_ai_t4_optimized", "T4", "all optimizations"),

        # L4 tests
        ("process_framing_ai_l4_baseline", "L4", "baseline"),
        ("process_framing_ai_l4_cudnn", "L4", "cudnn.benchmark"),
        ("process_framing_ai_l4_compiled", "L4", "torch.compile"),
        ("process_framing_ai_l4_optimized", "L4", "all optimizations"),
    ]

    for fn_name, gpu, optimization in tests:
        print(f"\n{'='*70}")
        print(f"TEST: {gpu} GPU - {optimization}")
        print(f"{'='*70}")

        result = measure_modal_function(
            fn_name,
            job_id=f"{job_prefix}_{fn_name}",
            user_id=TEST_USER_ID,
            input_key=TEST_VIDEO_KEY,
            output_key=f"test_outputs/{fn_name}_{job_prefix}.mp4",
            keyframes=CROP_KEYFRAMES,
            output_width=1080,
            output_height=1920,
            fps=30,
            segment_data={"trim_start": CLIP_START, "trim_end": CLIP_END},
        )

        result["gpu"] = gpu
        result["optimization"] = optimization
        result["rate"] = T4_RATE if gpu == "T4" else L4_RATE
        result["cost"] = result["elapsed_seconds"] * result["rate"]

        all_results.append(result)

    # Analysis
    print("\n" + "=" * 70)
    print("BENCHMARK RESULTS")
    print("=" * 70)

    print(f"\n{'GPU':<5} {'Optimization':<20} {'Time':>10} {'FPS':>8} {'Cost':>10} {'Status':<10}")
    print("-" * 70)

    for r in all_results:
        print(f"{r['gpu']:<5} {r['optimization']:<20} {r['elapsed_seconds']:>8.1f}s {r.get('fps', 0):>7.2f} ${r['cost']:>8.4f} {r['status']:<10}")

    # Find best for each GPU
    print("\n" + "=" * 70)
    print("BEST CONFIGURATION PER GPU")
    print("=" * 70)

    for gpu in ["T4", "L4"]:
        gpu_results = [r for r in all_results if r["gpu"] == gpu and r["status"] == "success"]
        if gpu_results:
            best = min(gpu_results, key=lambda x: x["elapsed_seconds"])
            print(f"\n{gpu} Best: {best['optimization']}")
            print(f"  Time: {best['elapsed_seconds']:.1f}s")
            print(f"  FPS: {best.get('fps', 0):.2f}")
            print(f"  Cost: ${best['cost']:.4f}")

    # Compare best T4 vs best L4
    t4_best = [r for r in all_results if r["gpu"] == "T4" and r["status"] == "success"]
    l4_best = [r for r in all_results if r["gpu"] == "L4" and r["status"] == "success"]

    if t4_best and l4_best:
        t4_winner = min(t4_best, key=lambda x: x["elapsed_seconds"])
        l4_winner = min(l4_best, key=lambda x: x["elapsed_seconds"])

        print("\n" + "=" * 70)
        print("OPTIMIZED T4 vs L4 COMPARISON")
        print("=" * 70)

        speedup = t4_winner["elapsed_seconds"] / l4_winner["elapsed_seconds"]
        cost_ratio = l4_winner["cost"] / t4_winner["cost"]

        print(f"\nT4 ({t4_winner['optimization']}): {t4_winner['elapsed_seconds']:.1f}s @ ${t4_winner['cost']:.4f}")
        print(f"L4 ({l4_winner['optimization']}): {l4_winner['elapsed_seconds']:.1f}s @ ${l4_winner['cost']:.4f}")
        print(f"\nL4 is {speedup:.2f}x {'faster' if speedup > 1 else 'slower'} than T4")
        print(f"L4 costs {cost_ratio:.2f}x {'more' if cost_ratio > 1 else 'less'} than T4")

        if l4_winner["cost"] < t4_winner["cost"]:
            print(f"\nRECOMMENDATION: Use L4 with '{l4_winner['optimization']}' - cheaper AND faster!")
        elif l4_winner["elapsed_seconds"] < t4_winner["elapsed_seconds"]:
            print(f"\nRECOMMENDATION: Use L4 if time matters more than cost")
        else:
            print(f"\nRECOMMENDATION: Use T4 with '{t4_winner['optimization']}' - best overall")

    # Save results
    results_data = {
        "timestamp": datetime.now().isoformat(),
        "job_prefix": job_prefix,
        "test_config": {
            "frames": EXPECTED_FRAMES,
            "crop_keyframes": CROP_KEYFRAMES,
        },
        "results": all_results,
    }

    with open(RESULTS_FILE, 'w') as f:
        json.dump(results_data, f, indent=2, default=str)

    print(f"\nResults saved to: {RESULTS_FILE}")
    return results_data


if __name__ == "__main__":
    run_benchmark()
