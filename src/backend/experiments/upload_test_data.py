"""
Upload test data to R2 for Modal experiments.

This script uploads the test video and creates necessary test data in R2
so that Modal functions can access it.

Run from src/backend:
    python experiments/upload_test_data.py
"""

import sys
import os
from pathlib import Path

# Load .env file from project root
from dotenv import load_dotenv
env_path = Path(__file__).parent.parent.parent.parent / ".env"
load_dotenv(env_path)

# Add app to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.storage import upload_to_r2, file_exists_in_r2, R2_ENABLED, R2_BUCKET

# Test configuration
TEST_USER_ID = "modal_test"
TEST_VIDEO_LOCAL = Path(__file__).parent.parent.parent.parent / "formal annotations" / "test.short" / "wcfc-carlsbad-trimmed.mp4"
TEST_VIDEO_R2_PATH = "test_videos/wcfc-carlsbad-trimmed.mp4"


def main():
    print("=" * 60)
    print("Modal Experiment: Upload Test Data to R2")
    print("=" * 60)

    # Check R2 is enabled
    print(f"\nR2 Enabled: {R2_ENABLED}")
    print(f"R2 Bucket: {R2_BUCKET}")

    if not R2_ENABLED:
        print("\nERROR: R2 is not enabled. Set R2_ENABLED=true in .env")
        print("Required environment variables:")
        print("  - R2_ENABLED=true")
        print("  - R2_ENDPOINT=https://<account>.r2.cloudflarestorage.com")
        print("  - R2_ACCESS_KEY_ID=...")
        print("  - R2_SECRET_ACCESS_KEY=...")
        print("  - R2_BUCKET=reel-ballers-users")
        return False

    # Check local file exists
    print(f"\nLocal test video: {TEST_VIDEO_LOCAL}")
    print(f"Exists: {TEST_VIDEO_LOCAL.exists()}")

    if not TEST_VIDEO_LOCAL.exists():
        print(f"\nERROR: Test video not found at {TEST_VIDEO_LOCAL}")
        return False

    # Get file size
    file_size_mb = TEST_VIDEO_LOCAL.stat().st_size / (1024 * 1024)
    print(f"Size: {file_size_mb:.1f} MB")

    # Check if already uploaded
    print(f"\nR2 path: {TEST_USER_ID}/{TEST_VIDEO_R2_PATH}")
    already_exists = file_exists_in_r2(TEST_USER_ID, TEST_VIDEO_R2_PATH)
    print(f"Already in R2: {already_exists}")

    if already_exists:
        print("\nTest video already exists in R2. Skipping upload.")
        print("To re-upload, delete the file from R2 first.")
    else:
        print(f"\nUploading {file_size_mb:.1f} MB to R2...")
        success = upload_to_r2(TEST_USER_ID, TEST_VIDEO_R2_PATH, TEST_VIDEO_LOCAL)

        if success:
            print("Upload successful!")
        else:
            print("ERROR: Upload failed. Check logs for details.")
            return False

    # Verify upload
    print("\nVerifying upload...")
    exists = file_exists_in_r2(TEST_USER_ID, TEST_VIDEO_R2_PATH)
    print(f"File exists in R2: {exists}")

    if exists:
        print("\n" + "=" * 60)
        print("SUCCESS: Test data is ready in R2")
        print("=" * 60)
        print(f"\nModal functions can now access:")
        print(f"  user_id: {TEST_USER_ID}")
        print(f"  input_key: {TEST_VIDEO_R2_PATH}")
        print(f"\nNext step: Run experiments/e1_baseline.py")
        return True
    else:
        print("\nERROR: Verification failed. File not found in R2.")
        return False


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
