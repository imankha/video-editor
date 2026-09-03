"""
Deploy the Modal render app, per-environment (T8270).

Staging and production are now SEPARATE Modal apps (`reel-ballers-video-v2-staging`
vs `reel-ballers-video-v2`), resolved from APP_ENV -- see
`app.services.modal_client.resolve_modal_app_name`. This wrapper sets APP_ENV for the
`modal deploy` subprocess so you can never accidentally deploy the wrong app: `modal
deploy` names the app from APP_ENV in the deploying shell, and forgetting to set it
would silently target the dev name.

Default rollout order (do NOT deploy both at once -- the whole point is a staging soak):

    1. python deploy.py                # STAGING (safe default)
    2. <verify on staging: real non-30fps upload + ffprobe, per Tbug49p's repro>
    3. python deploy.py --prod         # PRODUCTION (deliberate, only after step 2 passes)

There is intentionally no "deploy both" mode: prod is always a separate, explicit step
taken only after staging verification. This also handles the Windows Unicode issues in
Modal's CLI output.
"""
import argparse
import os
import subprocess
import sys

# APP_ENV value + resulting Modal app name per target (name must match
# resolve_modal_app_name; shown here only so the operator can eyeball what they hit).
TARGETS = {
    "staging": "reel-ballers-video-v2-staging",
    "production": "reel-ballers-video-v2",
}


def main():
    parser = argparse.ArgumentParser(description="Deploy the Modal render app for one environment.")
    parser.add_argument(
        "--prod",
        action="store_true",
        help="Deploy PRODUCTION (reel-ballers-video-v2). Default without this flag is STAGING.",
    )
    args = parser.parse_args()

    app_env = "production" if args.prod else "staging"
    expected_app = TARGETS[app_env]

    script_dir = os.path.dirname(os.path.abspath(__file__))
    video_processing_path = os.path.join(script_dir, "video_processing.py")

    # Set up environment: UTF-8 for Windows + APP_ENV so the app resolves to the
    # right name inside video_processing.py at deploy time.
    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    env["APP_ENV"] = app_env

    print(f"Deploying Modal app for APP_ENV={app_env} -> expected app '{expected_app}'")
    print(f"From: {video_processing_path}")
    if app_env == "production":
        print("*** PRODUCTION deploy -- confirm staging was verified first (T8270 rollout order). ***")
    print("-" * 60)

    result = subprocess.run(
        [sys.executable, "-m", "modal", "deploy", video_processing_path],
        capture_output=True,
        env=env,
    )

    # Write output to a per-env file to avoid print encoding issues.
    output_file = os.path.join(script_dir, f"deploy_result.{app_env}.txt")
    with open(output_file, "w", encoding="utf-8", errors="replace") as f:
        stdout = result.stdout.decode("utf-8", errors="replace")
        stderr = result.stderr.decode("utf-8", errors="replace")
        f.write(f"=== APP_ENV={app_env} expected_app={expected_app} ===\n")
        f.write(f"=== STDOUT ===\n{stdout}\n\n=== STDERR ===\n{stderr}\n\n=== Return code: {result.returncode} ===\n")

    # Also print to console with error handling.
    print("=== STDOUT ===")
    try:
        print(result.stdout.decode("utf-8", errors="replace"))
    except Exception:
        print("[encoding error - see deploy_result file]")

    print("=== STDERR ===")
    try:
        print(result.stderr.decode("utf-8", errors="replace"))
    except Exception:
        print("[encoding error - see deploy_result file]")

    print(f"\n=== Return code: {result.returncode} ===")
    print(f"\nFull output saved to: {output_file}")
    if not args.prod and result.returncode == 0:
        print("\nStaging deployed. Verify it, THEN run:  python deploy.py --prod")

    return result.returncode


if __name__ == "__main__":
    sys.exit(main())
