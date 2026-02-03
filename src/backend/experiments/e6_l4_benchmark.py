"""
E6: L4 vs T4 GPU Benchmark for Real-ESRGAN AI Upscaling

Compares T4 and L4 GPU performance for process_framing_ai.
Uses the same test configuration as E1 for apples-to-apples comparison.

T4 Baseline (from E1):
    - 6s clip (180 frames @ 30fps)
    - Time: 192.19 seconds
    - Cost: $0.0315 (at $0.000164/s)
    - FPS: 0.94

Expected L4 Result:
    - If 1.8x faster: ~107s, $0.024 (23% cheaper)
    - If 1.5x faster: ~128s, $0.028 (11% cheaper)
    - Break-even: 1.35x faster needed

Prerequisites:
    - Test video in R2 at modal_test/test_videos/wcfc-carlsbad-trimmed.mp4
    - Modal functions deployed with process_framing_ai_l4

Run from src/backend:
    modal deploy app/modal_functions/video_processing.py
    python experiments/e6_l4_benchmark.py
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

# Modal app configuration
MODAL_APP_NAME = "reel-ballers-video"

# Test configuration - SAME as E1
TEST_USER_ID = "modal_test"
TEST_VIDEO_KEY = "test_videos/wcfc-carlsbad-trimmed.mp4"

# Clip extraction settings (6s clip from 3s to 9s)
CLIP_START = 3.0
CLIP_END = 9.0
CLIP_DURATION = CLIP_END - CLIP_START  # 6s
EXPECTED_FRAMES = 180  # 6s * 30fps

# Crop region (simulate 9:16 vertical crop from 16:9 source)
# Assuming 1920x1080 source, crop to 540x960 region
CROP_KEYFRAMES = [
    {"time": 0, "x": 690, "y": 60, "width": 540, "height": 960}
]

# Output paths
RESULTS_FILE = Path(__file__).parent / "e6_l4_benchmark_results.json"

# Modal pricing (January 2025)
T4_RATE = 0.000164  # $/second
L4_RATE = 0.000222  # $/second


def measure_modal_function(fn_name: str, **kwargs) -> dict:
    """Call a Modal function and measure execution time."""
    import modal

    try:
        fn = modal.Function.from_name(MODAL_APP_NAME, fn_name)
    except Exception as e:
        print(f"  ERROR: Could not connect to Modal function '{fn_name}': {e}")
        return {
            "function": fn_name,
            "elapsed_seconds": 0,
            "status": "connection_error",
            "result": None,
            "error": str(e),
        }

    print(f"\n{'='*60}")
    print(f"Testing: {fn_name}")
    print(f"Started: {datetime.now().isoformat()}")
    print(f"Parameters: {json.dumps({k: v for k, v in kwargs.items()}, indent=2)}")

    start = time.time()
    try:
        result = fn.remote(**kwargs)
        elapsed = time.time() - start
        status = result.get('status', 'unknown') if isinstance(result, dict) else 'completed'
        print(f"Completed in {elapsed:.1f}s - Status: {status}")

        if isinstance(result, dict) and 'error' in result:
            print(f"  Error details: {result.get('error')}")

        return {
            "function": fn_name,
            "elapsed_seconds": elapsed,
            "status": status,
            "result": result,
            "error": None,
        }
    except Exception as e:
        elapsed = time.time() - start
        print(f"FAILED after {elapsed:.1f}s - Error: {e}")
        return {
            "function": fn_name,
            "elapsed_seconds": elapsed,
            "status": "error",
            "result": None,
            "error": str(e),
        }


def run_benchmark():
    """Run T4 vs L4 benchmark."""
    print("=" * 60)
    print("E6: L4 vs T4 GPU BENCHMARK")
    print("=" * 60)
    print(f"Modal App: {MODAL_APP_NAME}")
    print(f"Test User: {TEST_USER_ID}")
    print(f"Test Video: {TEST_VIDEO_KEY}")
    print(f"Clip Duration: {CLIP_DURATION}s ({EXPECTED_FRAMES} frames)")
    print()
    print("Pricing:")
    print(f"  T4: ${T4_RATE}/s (${T4_RATE * 3600:.2f}/hr)")
    print(f"  L4: ${L4_RATE}/s (${L4_RATE * 3600:.2f}/hr)")
    print(f"  L4/T4 ratio: {L4_RATE/T4_RATE:.2f}x")
    print()
    print("Break-even: L4 must be >{:.2f}x faster to be cheaper".format(L4_RATE/T4_RATE))

    results = []
    job_prefix = f"e6_benchmark_{int(time.time())}"

    # =========================================================================
    # Test 1: T4 GPU (control)
    # =========================================================================
    print("\n" + "=" * 60)
    print("TEST 1: process_framing_ai (T4 GPU) - Control")
    print("=" * 60)

    t4_result = measure_modal_function(
        'process_framing_ai',
        job_id=f"{job_prefix}_t4",
        user_id=TEST_USER_ID,
        input_key=TEST_VIDEO_KEY,
        output_key=f"test_outputs/e6_t4_{job_prefix}.mp4",
        keyframes=CROP_KEYFRAMES,
        output_width=1080,
        output_height=1920,
        fps=30,
        segment_data={"trim_start": CLIP_START, "trim_end": CLIP_END},
    )
    results.append(t4_result)

    # =========================================================================
    # Test 2: L4 GPU (experiment)
    # =========================================================================
    print("\n" + "=" * 60)
    print("TEST 2: process_framing_ai_l4 (L4 GPU) - Experiment")
    print("=" * 60)

    l4_result = measure_modal_function(
        'process_framing_ai_l4',
        job_id=f"{job_prefix}_l4",
        user_id=TEST_USER_ID,
        input_key=TEST_VIDEO_KEY,
        output_key=f"test_outputs/e6_l4_{job_prefix}.mp4",
        keyframes=CROP_KEYFRAMES,
        output_width=1080,
        output_height=1920,
        fps=30,
        segment_data={"trim_start": CLIP_START, "trim_end": CLIP_END},
    )
    results.append(l4_result)

    # =========================================================================
    # Analysis
    # =========================================================================
    print("\n" + "=" * 60)
    print("BENCHMARK RESULTS")
    print("=" * 60)

    t4_time = t4_result['elapsed_seconds']
    l4_time = l4_result['elapsed_seconds']

    t4_cost = t4_time * T4_RATE
    l4_cost = l4_time * L4_RATE

    t4_fps = EXPECTED_FRAMES / t4_time if t4_time > 0 else 0
    l4_fps = EXPECTED_FRAMES / l4_time if l4_time > 0 else 0

    speedup = t4_time / l4_time if l4_time > 0 else 0
    cost_ratio = l4_cost / t4_cost if t4_cost > 0 else 0

    print(f"\n{'Metric':<25} {'T4':>15} {'L4':>15} {'Comparison':>20}")
    print("-" * 75)
    print(f"{'Wall Time':<25} {t4_time:>13.1f}s {l4_time:>13.1f}s {f'{speedup:.2f}x speedup':>20}")
    print(f"{'Processing FPS':<25} {t4_fps:>13.2f} {l4_fps:>13.2f} {f'{l4_fps/t4_fps:.2f}x faster' if t4_fps > 0 else '':>20}")
    print(f"{'Cost':<25} {f'${t4_cost:.4f}':>15} {f'${l4_cost:.4f}':>15} {f'{cost_ratio:.2f}x' if cost_ratio < 1 else f'{cost_ratio:.2f}x':>20}")
    print(f"{'Cost per frame':<25} {f'${t4_cost/EXPECTED_FRAMES:.6f}':>15} {f'${l4_cost/EXPECTED_FRAMES:.6f}':>15}")

    print("\n" + "=" * 60)
    print("CONCLUSION")
    print("=" * 60)

    if l4_cost < t4_cost:
        savings_pct = (1 - cost_ratio) * 100
        print(f"\n  L4 is CHEAPER: ${l4_cost:.4f} vs ${t4_cost:.4f}")
        print(f"  Savings: {savings_pct:.1f}% ({speedup:.2f}x faster, costs {cost_ratio:.2f}x)")
        print(f"\n  RECOMMENDATION: Use L4 for AI upscaling")
    else:
        extra_pct = (cost_ratio - 1) * 100
        print(f"\n  T4 is CHEAPER: ${t4_cost:.4f} vs ${l4_cost:.4f}")
        print(f"  L4 extra cost: {extra_pct:.1f}% ({speedup:.2f}x faster but {cost_ratio:.2f}x cost)")
        if speedup > 1.2:
            print(f"\n  RECOMMENDATION: Consider L4 if time matters more than cost")
        else:
            print(f"\n  RECOMMENDATION: Keep using T4")

    # Save results
    print("\n" + "=" * 60)
    print("SAVING RESULTS")
    print("=" * 60)

    results_data = {
        "timestamp": datetime.now().isoformat(),
        "job_prefix": job_prefix,
        "test_config": {
            "user_id": TEST_USER_ID,
            "video_key": TEST_VIDEO_KEY,
            "clip_duration": CLIP_DURATION,
            "expected_frames": EXPECTED_FRAMES,
            "crop_keyframes": CROP_KEYFRAMES,
        },
        "pricing": {
            "T4_per_second": T4_RATE,
            "L4_per_second": L4_RATE,
        },
        "results": {
            "t4": {
                "elapsed_seconds": t4_time,
                "cost": t4_cost,
                "fps": t4_fps,
                "status": t4_result['status'],
            },
            "l4": {
                "elapsed_seconds": l4_time,
                "cost": l4_cost,
                "fps": l4_fps,
                "status": l4_result['status'],
            },
        },
        "analysis": {
            "speedup": speedup,
            "cost_ratio": cost_ratio,
            "l4_is_cheaper": l4_cost < t4_cost,
            "recommendation": "L4" if l4_cost < t4_cost else "T4",
        },
        "raw_results": results,
    }

    with open(RESULTS_FILE, 'w') as f:
        json.dump(results_data, f, indent=2, default=str)

    print(f"Results saved to: {RESULTS_FILE}")

    return results_data


if __name__ == "__main__":
    # Check for Modal credentials
    if not os.getenv("MODAL_TOKEN_ID") or not os.getenv("MODAL_TOKEN_SECRET"):
        print("WARNING: MODAL_TOKEN_ID or MODAL_TOKEN_SECRET not set")
        print("Modal may use cached credentials or fail")

    results = run_benchmark()

    # Exit with error if any tests failed
    if results['results']['t4']['status'] not in ('success', 'completed'):
        print("\nT4 test failed!")
        sys.exit(1)
    if results['results']['l4']['status'] not in ('success', 'completed'):
        print("\nL4 test failed!")
        sys.exit(1)
