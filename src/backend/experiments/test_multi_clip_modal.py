"""
Test: process_multi_clip_modal in isolation

Tests the new multi-clip Modal function to verify it works before integration.

Usage:
    cd src/backend
    python experiments/test_multi_clip_modal.py
"""

import modal
import time
import json
from datetime import datetime
from pathlib import Path

# Test configuration - uses existing test video with different trim ranges
TEST_CONFIG = {
    "user_id": "modal_test",
    "source_video": "test_videos/wcfc-carlsbad-trimmed.mp4",
    # Simulate 2 clips from the same source video with different trim ranges
    "clips": [
        {
            "clipIndex": 0,
            "cropKeyframes": [
                {"time": 0, "x": 690, "y": 60, "width": 540, "height": 960}
            ],
            "segmentsData": {
                "trimRange": {"start": 3.0, "end": 6.0}  # 3 seconds
            },
        },
        {
            "clipIndex": 1,
            "cropKeyframes": [
                {"time": 0, "x": 600, "y": 100, "width": 540, "height": 960}
            ],
            "segmentsData": {
                "trimRange": {"start": 10.0, "end": 13.0}  # 3 seconds
            },
        },
    ],
    "transition": {"type": "cut", "duration": 0},
    "target_width": 810,
    "target_height": 1440,
    "fps": 30,
}

# Timeout for the test (10 minutes as per user's rule)
TEST_TIMEOUT = 600


def run_multi_clip_test() -> dict:
    """Run the multi-clip Modal test."""
    job_id = f"test_multi_clip_{int(time.time())}"

    # Get the Modal function
    fn = modal.Function.from_name("reel-ballers-video", "process_multi_clip_modal")

    # For this test, we use the same source video for both clips
    # In production, each clip would be a different uploaded file
    source_keys = [
        TEST_CONFIG["source_video"],  # Clip 0
        TEST_CONFIG["source_video"],  # Clip 1 (same source, different trim)
    ]

    output_key = f"test_outputs/multi_clip_{job_id}.mp4"

    print(f"\n{'='*60}")
    print("Testing process_multi_clip_modal")
    print(f"{'='*60}")
    print(f"Job ID: {job_id}")
    print(f"Source video: {TEST_CONFIG['source_video']}")
    print(f"Number of clips: {len(TEST_CONFIG['clips'])}")
    print(f"Target: {TEST_CONFIG['target_width']}x{TEST_CONFIG['target_height']} @ {TEST_CONFIG['fps']}fps")
    print(f"Transition: {TEST_CONFIG['transition']}")
    print()

    print("Starting Modal call...")
    start_time = time.time()

    try:
        result = fn.remote(
            job_id=job_id,
            user_id=TEST_CONFIG["user_id"],
            source_keys=source_keys,
            output_key=output_key,
            clips_data=TEST_CONFIG["clips"],
            transition=TEST_CONFIG["transition"],
            target_width=TEST_CONFIG["target_width"],
            target_height=TEST_CONFIG["target_height"],
            fps=TEST_CONFIG["fps"],
            include_audio=True,
        )

        elapsed = time.time() - start_time

        return {
            "job_id": job_id,
            "status": result.get("status", "unknown"),
            "elapsed": elapsed,
            "clips_processed": result.get("clips_processed", 0),
            "output_key": result.get("output_key"),
            "error": result.get("error"),
        }

    except Exception as e:
        elapsed = time.time() - start_time
        return {
            "job_id": job_id,
            "status": "error",
            "elapsed": elapsed,
            "clips_processed": 0,
            "output_key": None,
            "error": str(e),
        }


def main():
    print(f"\n{'='*60}")
    print("Multi-Clip Modal Function Test")
    print(f"{'='*60}")
    print(f"Started: {datetime.now().isoformat()}")
    print(f"Timeout: {TEST_TIMEOUT}s (10 minutes)")
    print()

    # Run the test
    result = run_multi_clip_test()

    # Display results
    print(f"\n{'='*60}")
    print("TEST RESULT")
    print(f"{'='*60}")

    if result["status"] == "success":
        print(f"Status: SUCCESS")
        print(f"Time: {result['elapsed']:.1f}s")
        print(f"Clips processed: {result['clips_processed']}")
        print(f"Output: {result['output_key']}")

        # Calculate per-clip metrics
        total_frames = len(TEST_CONFIG["clips"]) * 3 * TEST_CONFIG["fps"]  # 3s per clip * fps
        fps_rate = total_frames / result["elapsed"] if result["elapsed"] > 0 else 0

        print(f"\nPerformance:")
        print(f"  Total frames: ~{total_frames}")
        print(f"  Processing rate: {fps_rate:.2f} fps")
        print(f"  Time per clip: {result['elapsed'] / len(TEST_CONFIG['clips']):.1f}s")

    else:
        print(f"Status: FAILED")
        print(f"Time: {result['elapsed']:.1f}s")
        print(f"Error: {result['error']}")

    # Save results
    output = {
        "timestamp": datetime.now().isoformat(),
        "config": TEST_CONFIG,
        "result": result,
    }

    output_path = Path(__file__).parent / "test_multi_clip_results.json"
    with open(output_path, "w") as f:
        json.dump(output, f, indent=2)

    print(f"\nResults saved to: {output_path}")

    # Return exit code based on success
    return 0 if result["status"] == "success" else 1


if __name__ == "__main__":
    exit(main())
