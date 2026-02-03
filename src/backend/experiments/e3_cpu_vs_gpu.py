"""
E3: CPU vs GPU Comparison Experiment

Measures actual processing time for overlay and framing on both CPU and GPU containers.
This fills the critical gap in our cost analysis - we assumed CPU runs at 20 FPS but never verified.

Usage:
    cd src/backend
    modal deploy app/modal_functions/video_processing.py  # Deploy first!
    python experiments/e3_cpu_vs_gpu.py

Results saved to: experiments/e3_cpu_vs_gpu_results.json
"""

import modal
import time
import json
from datetime import datetime
from pathlib import Path

# Modal pricing (per second)
T4_RATE = 0.000164
CPU_RATE = 0.0000262

# Test configuration - uses same video as E1
TEST_CONFIG = {
    "user_id": "modal_test",
    "video_key": "test_videos/wcfc-carlsbad-trimmed.mp4",  # 90s video, 2700 frames
    "video_duration": 90,
    "video_frames": 2700,
    "clip_start": 3.0,
    "clip_end": 9.0,  # 6s clip for framing test
    "clip_frames": 180,
    "crop_keyframes": [
        {"time": 0, "x": 690, "y": 60, "width": 540, "height": 960}
    ],
    "highlight_regions": [
        {
            "start_time": 0,
            "end_time": 90,
            "keyframes": [
                {"time": 0, "x": 960, "y": 540, "radiusX": 100, "radiusY": 100, "opacity": 0.15},
                {"time": 90, "x": 960, "y": 540, "radiusX": 100, "radiusY": 100, "opacity": 0.15},
            ]
        }
    ],
}


def run_overlay_test(fn_name: str, job_prefix: str) -> dict:
    """Run overlay test on specified function (GPU or CPU)."""
    fn = modal.Function.from_name("reel-ballers-video", fn_name)

    output_key = f"test_outputs/{job_prefix}_{fn_name}.mp4"

    print(f"  Running {fn_name}...")
    start = time.time()

    try:
        result = fn.remote(
            job_id=f"{job_prefix}_{fn_name}",
            user_id=TEST_CONFIG["user_id"],
            input_key=TEST_CONFIG["video_key"],
            output_key=output_key,
            highlight_regions=TEST_CONFIG["highlight_regions"],
            effect_type="dark_overlay",
        )
        elapsed = time.time() - start

        return {
            "function": fn_name,
            "status": "success" if result.get("status") == "success" else "error",
            "elapsed_seconds": elapsed,
            "frames": TEST_CONFIG["video_frames"],
            "frames_per_second": TEST_CONFIG["video_frames"] / elapsed,
            "result": result,
            "error": result.get("error") if result.get("status") != "success" else None,
        }
    except Exception as e:
        elapsed = time.time() - start
        return {
            "function": fn_name,
            "status": "error",
            "elapsed_seconds": elapsed,
            "error": str(e),
        }


def run_framing_test(fn_name: str, job_prefix: str) -> dict:
    """Run framing test on specified function (GPU or CPU)."""
    fn = modal.Function.from_name("reel-ballers-video", fn_name)

    output_key = f"test_outputs/{job_prefix}_{fn_name}.mp4"

    print(f"  Running {fn_name}...")
    start = time.time()

    try:
        result = fn.remote(
            job_id=f"{job_prefix}_{fn_name}",
            user_id=TEST_CONFIG["user_id"],
            input_key=TEST_CONFIG["video_key"],
            output_key=output_key,
            keyframes=TEST_CONFIG["crop_keyframes"],
            output_width=1080,
            output_height=1920,
            fps=30,
            segment_data={
                "trimRange": {
                    "start": TEST_CONFIG["clip_start"],
                    "end": TEST_CONFIG["clip_end"],
                }
            },
        )
        elapsed = time.time() - start

        return {
            "function": fn_name,
            "status": "success" if result.get("status") == "success" else "error",
            "elapsed_seconds": elapsed,
            "frames": TEST_CONFIG["clip_frames"],
            "frames_per_second": TEST_CONFIG["clip_frames"] / elapsed if elapsed > 0 else 0,
            "result": result,
            "error": result.get("error") if result.get("status") != "success" else None,
        }
    except Exception as e:
        elapsed = time.time() - start
        return {
            "function": fn_name,
            "status": "error",
            "elapsed_seconds": elapsed,
            "error": str(e),
        }


def calculate_costs(results: dict) -> dict:
    """Calculate costs for each test."""
    costs = {}

    for test_name, result in results.items():
        if result.get("status") != "success":
            costs[test_name] = {"error": result.get("error")}
            continue

        elapsed = result["elapsed_seconds"]

        # Determine rate based on function name
        if "_cpu" in result["function"]:
            rate = CPU_RATE
            hardware = "CPU"
        else:
            rate = T4_RATE
            hardware = "T4 GPU"

        cost = elapsed * rate

        costs[test_name] = {
            "hardware": hardware,
            "time_seconds": elapsed,
            "rate_per_second": rate,
            "cost": cost,
            "frames": result.get("frames", 0),
            "fps_throughput": result.get("frames_per_second", 0),
        }

    return costs


def main():
    job_prefix = f"e3_cpu_gpu_{int(time.time())}"
    print(f"\n{'='*60}")
    print("E3: CPU vs GPU Comparison Experiment")
    print(f"{'='*60}")
    print(f"Job prefix: {job_prefix}")
    print(f"Test video: {TEST_CONFIG['video_key']}")
    print(f"Overlay test: {TEST_CONFIG['video_frames']} frames (90s video)")
    print(f"Framing test: {TEST_CONFIG['clip_frames']} frames (6s clip)")
    print()

    results = {}

    # Test 1: Overlay GPU vs CPU
    print("Testing OVERLAY processing...")
    print("-" * 40)

    results["overlay_gpu"] = run_overlay_test("render_overlay", job_prefix)
    print(f"    GPU: {results['overlay_gpu']['elapsed_seconds']:.1f}s")

    results["overlay_cpu"] = run_overlay_test("render_overlay_cpu", job_prefix)
    print(f"    CPU: {results['overlay_cpu']['elapsed_seconds']:.1f}s")
    print()

    # Test 2: Framing GPU vs CPU
    print("Testing FRAMING processing...")
    print("-" * 40)

    results["framing_gpu"] = run_framing_test("process_framing", job_prefix)
    print(f"    GPU: {results['framing_gpu']['elapsed_seconds']:.1f}s")

    results["framing_cpu"] = run_framing_test("process_framing_cpu", job_prefix)
    print(f"    CPU: {results['framing_cpu']['elapsed_seconds']:.1f}s")
    print()

    # Calculate costs
    costs = calculate_costs(results)

    # Build comparison
    comparisons = []

    # Overlay comparison
    if results["overlay_gpu"].get("status") == "success" and results["overlay_cpu"].get("status") == "success":
        gpu_cost = costs["overlay_gpu"]["cost"]
        cpu_cost = costs["overlay_cpu"]["cost"]
        savings = gpu_cost - cpu_cost
        savings_pct = (savings / gpu_cost) * 100 if gpu_cost > 0 else 0

        comparisons.append({
            "test": "overlay",
            "gpu_time": results["overlay_gpu"]["elapsed_seconds"],
            "cpu_time": results["overlay_cpu"]["elapsed_seconds"],
            "gpu_fps": results["overlay_gpu"]["frames_per_second"],
            "cpu_fps": results["overlay_cpu"]["frames_per_second"],
            "gpu_cost": gpu_cost,
            "cpu_cost": cpu_cost,
            "savings": savings,
            "savings_pct": savings_pct,
            "recommendation": "CPU" if cpu_cost < gpu_cost else "GPU",
        })

    # Framing comparison
    if results["framing_gpu"].get("status") == "success" and results["framing_cpu"].get("status") == "success":
        gpu_cost = costs["framing_gpu"]["cost"]
        cpu_cost = costs["framing_cpu"]["cost"]
        savings = gpu_cost - cpu_cost
        savings_pct = (savings / gpu_cost) * 100 if gpu_cost > 0 else 0

        comparisons.append({
            "test": "framing",
            "gpu_time": results["framing_gpu"]["elapsed_seconds"],
            "cpu_time": results["framing_cpu"]["elapsed_seconds"],
            "gpu_fps": results["framing_gpu"]["frames_per_second"],
            "cpu_fps": results["framing_cpu"]["frames_per_second"],
            "gpu_cost": gpu_cost,
            "cpu_cost": cpu_cost,
            "savings": savings,
            "savings_pct": savings_pct,
            "recommendation": "CPU" if cpu_cost < gpu_cost else "GPU",
        })

    # Save results
    output = {
        "timestamp": datetime.now().isoformat(),
        "job_prefix": job_prefix,
        "config": TEST_CONFIG,
        "pricing": {"T4_per_second": T4_RATE, "CPU_per_second": CPU_RATE},
        "results": results,
        "costs": costs,
        "comparisons": comparisons,
    }

    output_path = Path(__file__).parent / "e3_cpu_vs_gpu_results.json"
    with open(output_path, "w") as f:
        json.dump(output, f, indent=2)

    # Print summary
    print("=" * 60)
    print("RESULTS SUMMARY")
    print("=" * 60)
    print()

    print("OVERLAY (90s video, 2700 frames):")
    print("-" * 40)
    if "overlay_gpu" in costs and "cost" in costs["overlay_gpu"]:
        print(f"  GPU: {results['overlay_gpu']['elapsed_seconds']:.1f}s @ {results['overlay_gpu']['frames_per_second']:.1f} fps = ${costs['overlay_gpu']['cost']:.4f}")
    if "overlay_cpu" in costs and "cost" in costs["overlay_cpu"]:
        print(f"  CPU: {results['overlay_cpu']['elapsed_seconds']:.1f}s @ {results['overlay_cpu']['frames_per_second']:.1f} fps = ${costs['overlay_cpu']['cost']:.4f}")
    if comparisons and comparisons[0]["test"] == "overlay":
        c = comparisons[0]
        print(f"  → {c['recommendation']} saves ${c['savings']:.4f} ({c['savings_pct']:.1f}%)")
    print()

    print("FRAMING (6s clip, 180 frames):")
    print("-" * 40)
    if "framing_gpu" in costs and "cost" in costs["framing_gpu"]:
        print(f"  GPU: {results['framing_gpu']['elapsed_seconds']:.1f}s @ {results['framing_gpu']['frames_per_second']:.1f} fps = ${costs['framing_gpu']['cost']:.4f}")
    if "framing_cpu" in costs and "cost" in costs["framing_cpu"]:
        print(f"  CPU: {results['framing_cpu']['elapsed_seconds']:.1f}s @ {results['framing_cpu']['frames_per_second']:.1f} fps = ${costs['framing_cpu']['cost']:.4f}")
    if len(comparisons) > 1 and comparisons[1]["test"] == "framing":
        c = comparisons[1]
        print(f"  → {c['recommendation']} saves ${c['savings']:.4f} ({c['savings_pct']:.1f}%)")
    print()

    print(f"Results saved to: {output_path}")
    print()

    return output


if __name__ == "__main__":
    main()
