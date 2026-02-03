"""
E1: Baseline Measurements

Measures actual runtime and cost for each Modal function.
Run BEFORE making any optimizations to establish baseline costs.

Prerequisites:
    - Test video uploaded to R2 (run upload_test_data.py first)
    - Modal functions deployed
    - MODAL_TOKEN_ID and MODAL_TOKEN_SECRET set in environment

Run from src/backend:
    python experiments/e1_baseline.py
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

# Test configuration
TEST_USER_ID = "modal_test"
TEST_VIDEO_KEY = "test_videos/wcfc-carlsbad-trimmed.mp4"

# Clip extraction settings (6s clip from 3s to 9s)
CLIP_START = 3.0
CLIP_END = 9.0
CLIP_DURATION = CLIP_END - CLIP_START  # 6s

# Crop region (simulate 9:16 vertical crop from 16:9 source)
# Assuming 1920x1080 source, crop to 540x960 region
CROP_KEYFRAMES = [
    {"time": 0, "x": 690, "y": 60, "width": 540, "height": 960}
]

# Highlight region for overlay
HIGHLIGHT_REGIONS = [{
    "start_time": 1.0,
    "end_time": 4.0,
    "keyframes": [
        {"time": 1.0, "x": 270, "y": 480, "radiusX": 150, "radiusY": 150, "opacity": 0.15},
        {"time": 4.0, "x": 350, "y": 500, "radiusX": 180, "radiusY": 180, "opacity": 0.15},
    ]
}]

# Output paths
RESULTS_FILE = Path(__file__).parent / "e1_results.json"


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
    print(f"Parameters: {json.dumps({k: v for k, v in kwargs.items() if k != 'highlight_regions'}, indent=2)}")

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


def run_baseline_tests():
    """Run all baseline measurements."""
    print("=" * 60)
    print("E1: BASELINE MEASUREMENTS")
    print("=" * 60)
    print(f"Modal App: {MODAL_APP_NAME}")
    print(f"Test User: {TEST_USER_ID}")
    print(f"Test Video: {TEST_VIDEO_KEY}")
    print(f"Clip Duration: {CLIP_DURATION}s")

    results = []
    job_prefix = f"e1_baseline_{int(time.time())}"

    # =========================================================================
    # Test 1: render_overlay (currently on T4 GPU)
    # Process full video (90s) with highlight overlay
    # =========================================================================
    print("\n" + "=" * 60)
    print("TEST 1: render_overlay (T4 GPU)")
    print("  - Processes full 90s video")
    print("  - Applies highlight overlay effect")
    print("  - Currently runs on T4 GPU")
    print("=" * 60)

    results.append(measure_modal_function(
        'render_overlay',
        job_id=f"{job_prefix}_overlay",
        user_id=TEST_USER_ID,
        input_key=TEST_VIDEO_KEY,
        output_key=f"test_outputs/e1_overlay_{job_prefix}.mp4",
        highlight_regions=HIGHLIGHT_REGIONS,
        effect_type="dark_overlay",
    ))

    # =========================================================================
    # Test 2: process_framing (currently on T4 GPU, FFmpeg only)
    # Crop and scale a 6s clip without AI upscaling
    # =========================================================================
    print("\n" + "=" * 60)
    print("TEST 2: process_framing (T4 GPU, FFmpeg only)")
    print(f"  - Extracts {CLIP_DURATION}s clip")
    print("  - Crops and scales to 1080x1920")
    print("  - No AI upscaling (pure FFmpeg)")
    print("  - Currently runs on T4 GPU")
    print("=" * 60)

    results.append(measure_modal_function(
        'process_framing',
        job_id=f"{job_prefix}_framing",
        user_id=TEST_USER_ID,
        input_key=TEST_VIDEO_KEY,
        output_key=f"test_outputs/e1_framing_{job_prefix}.mp4",
        keyframes=CROP_KEYFRAMES,
        output_width=1080,
        output_height=1920,
        fps=30,
        segment_data={"trim_start": CLIP_START, "trim_end": CLIP_END},
    ))

    # =========================================================================
    # Test 3: process_framing_ai (T4 GPU, Real-ESRGAN)
    # AI upscale a 6s clip
    # =========================================================================
    print("\n" + "=" * 60)
    print("TEST 3: process_framing_ai (T4 GPU, Real-ESRGAN)")
    print(f"  - Extracts {CLIP_DURATION}s clip")
    print("  - Crops to 540x960")
    print("  - AI upscales 4x to 2160x3840, then scales to 1080x1920")
    print("  - Uses Real-ESRGAN on T4 GPU")
    print("=" * 60)

    results.append(measure_modal_function(
        'process_framing_ai',
        job_id=f"{job_prefix}_ai",
        user_id=TEST_USER_ID,
        input_key=TEST_VIDEO_KEY,
        output_key=f"test_outputs/e1_ai_{job_prefix}.mp4",
        keyframes=CROP_KEYFRAMES,
        output_width=1080,
        output_height=1920,
        fps=30,
        segment_data={"trim_start": CLIP_START, "trim_end": CLIP_END},
    ))

    # =========================================================================
    # Print Summary
    # =========================================================================
    print("\n" + "=" * 60)
    print("BASELINE RESULTS SUMMARY")
    print("=" * 60)

    # Modal pricing
    T4_RATE = 0.000164  # $/second
    CPU_RATE = 0.0000262  # $/second (2 cores)

    print(f"\n{'Function':<25} {'Time':>10} {'Status':>12} {'T4 Cost':>10}")
    print("-" * 60)

    for r in results:
        cost = r['elapsed_seconds'] * T4_RATE
        status_short = r['status'][:12] if len(r['status']) > 12 else r['status']
        print(f"{r['function']:<25} {r['elapsed_seconds']:>8.1f}s {status_short:>12} ${cost:>8.4f}")

    # Calculate totals
    total_time = sum(r['elapsed_seconds'] for r in results if r['status'] == 'success')
    total_cost = total_time * T4_RATE

    print("-" * 60)
    print(f"{'TOTAL':<25} {total_time:>8.1f}s {'':>12} ${total_cost:>8.4f}")

    # Analysis
    print("\n" + "=" * 60)
    print("ANALYSIS")
    print("=" * 60)

    for r in results:
        if r['status'] == 'success':
            fn = r['function']
            t = r['elapsed_seconds']

            # Calculate what CPU would cost at same time
            cpu_cost_same_time = t * CPU_RATE
            gpu_cost = t * T4_RATE

            print(f"\n{fn}:")
            print(f"  Time: {t:.1f}s")
            print(f"  T4 cost: ${gpu_cost:.4f}")
            print(f"  If same time on CPU: ${cpu_cost_same_time:.4f} ({gpu_cost/cpu_cost_same_time:.1f}x cheaper)")
            print(f"  Break-even: CPU would need to be {gpu_cost/CPU_RATE:.1f}s to cost the same")

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
            "crop_keyframes": CROP_KEYFRAMES,
        },
        "pricing": {
            "T4_per_second": T4_RATE,
            "CPU_per_second": CPU_RATE,
        },
        "results": results,
    }

    with open(RESULTS_FILE, 'w') as f:
        json.dump(results_data, f, indent=2, default=str)

    print(f"Results saved to: {RESULTS_FILE}")

    return results


if __name__ == "__main__":
    # Check for Modal credentials
    if not os.getenv("MODAL_TOKEN_ID") or not os.getenv("MODAL_TOKEN_SECRET"):
        print("WARNING: MODAL_TOKEN_ID or MODAL_TOKEN_SECRET not set")
        print("Modal may use cached credentials or fail")

    results = run_baseline_tests()

    # Exit with error if any tests failed
    failed = [r for r in results if r['status'] not in ('success', 'completed')]
    if failed:
        print(f"\n{len(failed)} test(s) failed. Check logs above.")
        sys.exit(1)
