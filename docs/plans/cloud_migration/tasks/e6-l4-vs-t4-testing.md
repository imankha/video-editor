# E6: L4 vs T4 GPU Comparison for AI Upscaling

**Status**: `TODO` - Next experiment to run
**Priority**: HIGH
**Blocked By**: None (E1, E3, E7 complete)
**Blocks**: E2, Comprehensive Review, B1 Integration

---

## Objective

Determine if L4 GPU is more cost-effective than T4 for Real-ESRGAN AI upscaling.

## Background

| GPU | Rate/second | Rate/hour | Architecture |
|-----|-------------|-----------|--------------|
| T4 | $0.000164 | $0.59 | Turing (2018) |
| L4 | $0.000222 | $0.80 | Ada Lovelace (2023) |

**L4 is 1.35x more expensive per second** but has newer architecture that may be 1.5-2x faster for inference workloads.

### Break-even Analysis

For L4 to be cost-effective, it must complete the task in less than 74% of T4's time:
```
L4 cost < T4 cost
L4_time × $0.000222 < T4_time × $0.000164
L4_time < T4_time × 0.739

If T4 takes 185s (from E1), L4 must take < 137s to be cheaper
```

---

## Test Plan

### Prerequisites

1. Test video already in R2: `modal_test/test_videos/wcfc-carlsbad-trimmed.mp4`
2. Current `process_framing_ai` deployed on T4

### Step 1: Create L4 Version

Add to `video_processing.py`:

```python
@app.function(
    image=upscale_image,
    gpu="L4",  # Ada Lovelace - newer than T4 Turing
    timeout=1200,
    secrets=[modal.Secret.from_name("r2-credentials")],
)
def process_framing_ai_l4(
    job_id: str,
    user_id: str,
    input_key: str,
    output_key: str,
    keyframes: list,
    output_width: int = 810,
    output_height: int = 1440,
    fps: int = 30,
    segment_data: dict = None,
) -> dict:
    """
    AI upscaling on L4 GPU for cost comparison with T4.
    Identical to process_framing_ai, just different GPU.
    """
    # Same implementation as process_framing_ai
    ...
```

### Step 2: Create Experiment Script

Create `src/backend/experiments/e6_l4_vs_t4.py`:

```python
"""
E6: L4 vs T4 GPU Comparison for AI Upscaling

Tests Real-ESRGAN performance on both GPU types.
"""
import modal
import time
import json
from datetime import datetime
from pathlib import Path

# Pricing
T4_RATE = 0.000164
L4_RATE = 0.000222

# Test config
TEST_CONFIG = {
    "user_id": "modal_test",
    "video_key": "test_videos/wcfc-carlsbad-trimmed.mp4",
    "clips": [
        {"name": "6s", "start": 3.0, "end": 9.0, "frames": 180},
        {"name": "15s", "start": 3.0, "end": 18.0, "frames": 450},
        {"name": "30s", "start": 3.0, "end": 33.0, "frames": 900},
    ],
    "crop_keyframes": [
        {"time": 0, "x": 690, "y": 60, "width": 540, "height": 960}
    ],
}


def run_ai_test(fn_name: str, gpu_type: str, clip: dict, job_prefix: str) -> dict:
    """Run AI upscaling test on specified function."""
    fn = modal.Function.from_name("reel-ballers-video", fn_name)

    output_key = f"test_outputs/{job_prefix}_{gpu_type}_{clip['name']}.mp4"

    print(f"  Running {fn_name} for {clip['name']} clip...")
    start = time.time()

    try:
        result = fn.remote(
            job_id=f"{job_prefix}_{gpu_type}_{clip['name']}",
            user_id=TEST_CONFIG["user_id"],
            input_key=TEST_CONFIG["video_key"],
            output_key=output_key,
            keyframes=TEST_CONFIG["crop_keyframes"],
            output_width=810,
            output_height=1440,
            fps=30,
            segment_data={
                "trimRange": {"start": clip["start"], "end": clip["end"]}
            },
        )
        elapsed = time.time() - start

        return {
            "gpu": gpu_type,
            "clip": clip["name"],
            "frames": clip["frames"],
            "elapsed": elapsed,
            "fps": clip["frames"] / elapsed,
            "status": result.get("status", "unknown"),
        }
    except Exception as e:
        elapsed = time.time() - start
        return {
            "gpu": gpu_type,
            "clip": clip["name"],
            "elapsed": elapsed,
            "status": "error",
            "error": str(e),
        }


def main():
    job_prefix = f"e6_{int(time.time())}"
    print(f"\n{'='*60}")
    print("E6: L4 vs T4 GPU Comparison")
    print(f"{'='*60}")

    results = []

    for clip in TEST_CONFIG["clips"]:
        print(f"\nTesting {clip['name']} clip ({clip['frames']} frames)...")
        print("-" * 40)

        # Run on T4
        t4_result = run_ai_test("process_framing_ai", "T4", clip, job_prefix)
        results.append(t4_result)

        # Run on L4
        l4_result = run_ai_test("process_framing_ai_l4", "L4", clip, job_prefix)
        results.append(l4_result)

    # Calculate costs and comparisons
    print(f"\n{'='*60}")
    print("RESULTS")
    print(f"{'='*60}")
    print(f"{'Clip':<8} {'GPU':<5} {'Time':>8} {'FPS':>6} {'Cost':>8} {'vs T4':>8}")
    print("-" * 50)

    comparisons = []
    for clip in TEST_CONFIG["clips"]:
        t4 = next(r for r in results if r["gpu"] == "T4" and r["clip"] == clip["name"])
        l4 = next(r for r in results if r["gpu"] == "L4" and r["clip"] == clip["name"])

        t4_cost = t4["elapsed"] * T4_RATE
        l4_cost = l4["elapsed"] * L4_RATE

        print(f"{clip['name']:<8} T4    {t4['elapsed']:>7.1f}s {t4.get('fps', 0):>5.1f} ${t4_cost:>6.4f}     -")
        print(f"{clip['name']:<8} L4    {l4['elapsed']:>7.1f}s {l4.get('fps', 0):>5.1f} ${l4_cost:>6.4f} {(l4_cost/t4_cost - 1)*100:>+6.1f}%")

        comparisons.append({
            "clip": clip["name"],
            "frames": clip["frames"],
            "t4_time": t4["elapsed"],
            "l4_time": l4["elapsed"],
            "t4_cost": t4_cost,
            "l4_cost": l4_cost,
            "l4_speedup": t4["elapsed"] / l4["elapsed"] if l4["elapsed"] > 0 else 0,
            "l4_cost_diff_pct": (l4_cost / t4_cost - 1) * 100,
            "winner": "L4" if l4_cost < t4_cost else "T4",
        })

    # Summary
    print(f"\n{'='*60}")
    print("SUMMARY")
    print(f"{'='*60}")

    for c in comparisons:
        print(f"{c['clip']}: L4 is {c['l4_speedup']:.2f}x faster, {c['winner']} is cheaper")

    # Save results
    output = {
        "timestamp": datetime.now().isoformat(),
        "config": TEST_CONFIG,
        "pricing": {"T4": T4_RATE, "L4": L4_RATE},
        "results": results,
        "comparisons": comparisons,
    }

    output_path = Path(__file__).parent / "e6_l4_vs_t4_results.json"
    with open(output_path, "w") as f:
        json.dump(output, f, indent=2)

    print(f"\nResults saved to: {output_path}")


if __name__ == "__main__":
    main()
```

### Step 3: Deploy and Run

```bash
cd src/backend

# Deploy the L4 function
modal deploy app/modal_functions/video_processing.py

# Run the experiment
python experiments/e6_l4_vs_t4.py
```

---

## Expected Data

| Clip | GPU | Time | FPS | Cost | Winner |
|------|-----|------|-----|------|--------|
| 6s | T4 | ~185s | ~1.0 | $0.0303 | ? |
| 6s | L4 | ? | ? | ? | ? |
| 15s | T4 | ? | ? | ? | ? |
| 15s | L4 | ? | ? | ? | ? |
| 30s | T4 | ? | ? | ? | ? |
| 30s | L4 | ? | ? | ? | ? |

---

## Decision Criteria

| Scenario | Decision |
|----------|----------|
| L4 is cheaper for all clips | Use L4 for all AI upscaling |
| L4 is cheaper only for long clips | Use L4 for clips > threshold, T4 for shorter |
| T4 is always cheaper | Keep T4 |
| Costs are within 10% | Prefer L4 (faster user experience) |

---

## After Experiment

1. Record results in `experiments/e6_l4_vs_t4_results.json`
2. Update `EXPERIMENT_FINDINGS.md` with findings
3. If L4 is better, update `process_framing_ai` to use L4 or add dynamic selection
4. Proceed to E2 (FFmpeg frame reading)

---

## Notes

- L4 has Ada Lovelace architecture (2023) vs T4's Turing (2018)
- L4 has more CUDA cores and faster memory bandwidth
- Real-ESRGAN is primarily compute-bound, so L4 should be faster
- But we need real measurements to confirm
