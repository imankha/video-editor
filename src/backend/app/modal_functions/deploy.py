"""
Deploy Modal functions with proper Windows encoding handling.

Usage:
    python deploy.py

This script handles the Windows encoding issues with Modal CLI Unicode output.
"""
import subprocess
import os
import sys

def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    video_processing_path = os.path.join(script_dir, "video_processing.py")

    # Set up environment for UTF-8 encoding
    env = os.environ.copy()
    env['PYTHONIOENCODING'] = 'utf-8'
    env['PYTHONUTF8'] = '1'

    print(f"Deploying Modal functions from: {video_processing_path}")
    print("-" * 60)

    result = subprocess.run(
        [sys.executable, "-m", "modal", "deploy", video_processing_path],
        capture_output=True,
        env=env
    )

    # Write output to file to avoid print encoding issues
    output_file = os.path.join(script_dir, "deploy_result.txt")
    with open(output_file, 'w', encoding='utf-8', errors='replace') as f:
        stdout = result.stdout.decode('utf-8', errors='replace')
        stderr = result.stderr.decode('utf-8', errors='replace')
        f.write(f"=== STDOUT ===\n{stdout}\n\n=== STDERR ===\n{stderr}\n\n=== Return code: {result.returncode} ===\n")

    # Also print to console with error handling
    print("=== STDOUT ===")
    try:
        print(result.stdout.decode('utf-8', errors='replace'))
    except:
        print("[encoding error - see deploy_result.txt]")

    print("=== STDERR ===")
    try:
        print(result.stderr.decode('utf-8', errors='replace'))
    except:
        print("[encoding error - see deploy_result.txt]")

    print(f"\n=== Return code: {result.returncode} ===")
    print(f"\nFull output saved to: {output_file}")

    return result.returncode

if __name__ == "__main__":
    sys.exit(main())
