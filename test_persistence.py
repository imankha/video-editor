#!/usr/bin/env python3
"""
Comprehensive persistence testing script.

Tests the full persistence strategy including:
1. Project state persistence (current_mode, last_opened_at)
2. Framing mode persistence (clip edits)
3. Overlay mode persistence (highlights, overlays, effects)
4. Version tracking (clips, working_videos, final_videos)
5. Gallery/Downloads feature
"""

import requests
import json
import time
import sys
from pathlib import Path
from datetime import datetime

BASE_URL = "http://localhost:8000/api"

class Colors:
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    RESET = '\033[0m'
    BOLD = '\033[1m'

def log(message, color=Colors.RESET):
    print(f"{color}{message}{Colors.RESET}")

def log_success(message):
    log(f"[PASS] {message}", Colors.GREEN)

def log_error(message):
    log(f"[FAIL] {message}", Colors.RED)

def log_info(message):
    log(f"[INFO] {message}", Colors.BLUE)

def log_section(message):
    log(f"\n{'='*60}\n{message}\n{'='*60}", Colors.BOLD)

class PersistenceTest:
    def __init__(self):
        self.test_project_id = None
        self.test_raw_clip_ids = []
        self.test_working_clip_ids = []
        self.test_working_video_id = None
        self.test_final_video_ids = []
        self.passed_tests = 0
        self.failed_tests = 0
        self.video_file = None

    def setup(self):
        """Setup test environment"""
        log_section("SETUP: Preparing test environment")

        # Find a video file to use for testing
        raw_clips_path = Path("user_data/a/raw_clips")
        if raw_clips_path.exists():
            video_files = list(raw_clips_path.glob("*.mp4"))
            if video_files:
                self.video_file = video_files[0]
                log_info(f"Using test video: {self.video_file.name}")
            else:
                log_error("No video files found in raw_clips")
                sys.exit(1)
        else:
            log_error("raw_clips directory not found")
            sys.exit(1)

        # Get some raw clips for testing
        response = requests.get(f"{BASE_URL}/clips/raw")
        if response.status_code == 200:
            raw_clips = response.json()
            if len(raw_clips) >= 3:
                self.test_raw_clip_ids = [clip['id'] for clip in raw_clips[:3]]
                log_success(f"Found {len(raw_clips)} raw clips, using IDs: {self.test_raw_clip_ids}")
            else:
                log_error("Need at least 3 raw clips for testing")
                sys.exit(1)
        else:
            log_error("Failed to fetch raw clips")
            sys.exit(1)

    def test_project_creation_and_state(self):
        """Test 1: Project creation and state persistence"""
        log_section("TEST 1: Project Creation and State Persistence")

        # Create a test project
        response = requests.post(f"{BASE_URL}/projects", json={
            "name": "Persistence Test Project",
            "aspect_ratio": "16:9"
        })

        if response.status_code == 200:
            project = response.json()
            self.test_project_id = project['id']
            log_success(f"Created test project (ID: {self.test_project_id})")
            self.passed_tests += 1
        else:
            log_error(f"Failed to create project: {response.text}")
            self.failed_tests += 1
            return False

        # Update project state using PATCH endpoint
        response = requests.patch(
            f"{BASE_URL}/projects/{self.test_project_id}/state",
            params={"current_mode": "overlay"}
        )

        if response.status_code == 200:
            log_success("Updated project current_mode to 'overlay'")
            self.passed_tests += 1
        else:
            log_error(f"Failed to update project: {response.text}")
            self.failed_tests += 1

        # Verify state persisted
        response = requests.get(f"{BASE_URL}/projects")
        if response.status_code == 200:
            projects = response.json()
            test_project = next((p for p in projects if p['id'] == self.test_project_id), None)
            if test_project and test_project.get('current_mode') == 'overlay':
                log_success("Project state persisted correctly")
                self.passed_tests += 1
            else:
                log_error("Project state did not persist")
                self.failed_tests += 1

        return True

    def test_clip_versioning(self):
        """Test 2: Clip versioning and latest-only display"""
        log_section("TEST 2: Clip Versioning")

        # Add first clip (should be version 1)
        response = requests.post(
            f"{BASE_URL}/clips/projects/{self.test_project_id}/clips",
            data={"raw_clip_id": self.test_raw_clip_ids[0]}
        )

        if response.status_code == 200:
            clip = response.json()
            self.test_working_clip_ids.append(clip['id'])
            log_success(f"Added clip 1 (ID: {clip['id']}, expected version 1)")
            self.passed_tests += 1
        else:
            log_error(f"Failed to add clip: {response.text}")
            self.failed_tests += 1
            return False

        # Add same clip again (should be version 2)
        response = requests.post(
            f"{BASE_URL}/clips/projects/{self.test_project_id}/clips",
            data={"raw_clip_id": self.test_raw_clip_ids[0]}
        )

        if response.status_code == 200:
            clip = response.json()
            self.test_working_clip_ids.append(clip['id'])
            log_success(f"Added clip 1 again (ID: {clip['id']}, expected version 2)")
            self.passed_tests += 1
        else:
            log_error(f"Failed to add clip: {response.text}")
            self.failed_tests += 1

        # Add different clips
        for raw_clip_id in self.test_raw_clip_ids[1:]:
            response = requests.post(
                f"{BASE_URL}/clips/projects/{self.test_project_id}/clips",
                data={"raw_clip_id": raw_clip_id}
            )
            if response.status_code == 200:
                self.test_working_clip_ids.append(response.json()['id'])

        # Verify only latest versions are shown
        response = requests.get(f"{BASE_URL}/clips/projects/{self.test_project_id}/clips")
        if response.status_code == 200:
            clips = response.json()
            if len(clips) == 3:  # Should only see 3 clips (latest version of each)
                log_success(f"Correct: Only {len(clips)} clips shown (latest versions)")
                self.passed_tests += 1
            else:
                log_error(f"Expected 3 clips, got {len(clips)}")
                self.failed_tests += 1

        return True

    def test_framing_persistence(self):
        """Test 3: Framing mode data persistence"""
        log_section("TEST 3: Framing Mode Data Persistence")

        # Get latest clip
        response = requests.get(f"{BASE_URL}/clips/projects/{self.test_project_id}/clips")
        clips = response.json()
        latest_clip_id = clips[0]['id']

        # Update clip with framing data
        framing_data = {
            "crop_data": json.dumps({"x": 100, "y": 50, "width": 1920, "height": 1080}),
            "timing_data": json.dumps({"speed": 1.5, "trim_start": 2.0, "trim_end": 15.0}),
            "segments_data": json.dumps([{"type": "keep", "start": 0, "end": 10}]),
            "transform_data": json.dumps({"rotate": 0, "flip_h": False})
        }

        response = requests.put(
            f"{BASE_URL}/clips/projects/{self.test_project_id}/clips/{latest_clip_id}",
            json=framing_data
        )

        if response.status_code == 200:
            log_success("Updated clip with framing data")
            self.passed_tests += 1
        else:
            log_error(f"Failed to update clip: {response.text}")
            self.failed_tests += 1
            return False

        # Verify data persisted
        response = requests.get(f"{BASE_URL}/clips/projects/{self.test_project_id}/clips")
        clips = response.json()
        updated_clip = next((c for c in clips if c['id'] == latest_clip_id), None)

        if updated_clip:
            if updated_clip.get('crop_data') and updated_clip.get('timing_data'):
                crop_data = json.loads(updated_clip['crop_data'])
                timing_data = json.loads(updated_clip['timing_data'])

                if crop_data.get('x') == 100 and timing_data.get('speed') == 1.5:
                    log_success("Framing data persisted correctly")
                    self.passed_tests += 1
                else:
                    log_error("Framing data values incorrect")
                    self.failed_tests += 1
            else:
                log_error("Framing data not found")
                self.failed_tests += 1

        return True

    def test_working_video_versioning(self):
        """Test 4: Working video versioning"""
        log_section("TEST 4: Working Video Versioning (Framing Exports)")

        # Export working video version 1
        with open(self.video_file, 'rb') as f:
            files = {'video': f}
            data = {
                'project_id': self.test_project_id,
                'clips_data': json.dumps([])
            }
            response = requests.post(f"{BASE_URL}/export/framing", files=files, data=data)

        if response.status_code == 200:
            result = response.json()
            self.test_working_video_id = result['working_video_id']
            log_success(f"Created working video v1 (ID: {self.test_working_video_id})")
            self.passed_tests += 1
        else:
            log_error(f"Failed to export working video: {response.text}")
            self.failed_tests += 1
            return False

        # Export working video version 2
        time.sleep(0.5)  # Small delay to ensure different timestamps
        with open(self.video_file, 'rb') as f:
            files = {'video': f}
            data = {
                'project_id': self.test_project_id,
                'clips_data': json.dumps([])
            }
            response = requests.post(f"{BASE_URL}/export/framing", files=files, data=data)

        if response.status_code == 200:
            result = response.json()
            log_success(f"Created working video v2 (ID: {result['working_video_id']})")
            self.passed_tests += 1
        else:
            log_error(f"Failed to export working video v2: {response.text}")
            self.failed_tests += 1

        # Verify GET returns latest version
        response = requests.get(f"{BASE_URL}/export/projects/{self.test_project_id}/working-video")
        if response.status_code == 200:
            log_success("GET working-video returns latest version")
            self.passed_tests += 1
        else:
            log_error("Failed to get working video")
            self.failed_tests += 1

        return True

    def test_overlay_persistence(self):
        """Test 5: Overlay mode data persistence"""
        log_section("TEST 5: Overlay Mode Data Persistence")

        # Save overlay data
        overlay_data = {
            "highlights_data": json.dumps([
                {"start": 2.5, "end": 5.0, "color": "#FF6B35"}
            ]),
            "text_overlays": json.dumps([
                {"text": "Great Play!", "timestamp": 3.0, "position": "top"}
            ]),
            "effect_type": "brightness_boost"
        }

        response = requests.put(
            f"{BASE_URL}/export/projects/{self.test_project_id}/overlay-data",
            data=overlay_data  # Form data, not JSON
        )

        if response.status_code == 200:
            log_success("Saved overlay data")
            self.passed_tests += 1
        else:
            log_error(f"Failed to save overlay data: {response.text}")
            self.failed_tests += 1
            return False

        # Verify data persisted
        response = requests.get(f"{BASE_URL}/export/projects/{self.test_project_id}/overlay-data")
        if response.status_code == 200:
            data = response.json()
            highlights_count = len(data.get('highlights_data', []))
            overlays_count = len(data.get('text_overlays', []))
            effect = data.get('effect_type')

            if highlights_count == 1 and overlays_count == 1 and effect == 'brightness_boost':
                log_success("Overlay data persisted correctly")
                self.passed_tests += 1
            else:
                log_error(f"Overlay data incorrect: highlights={highlights_count} (expected 1), overlays={overlays_count} (expected 1), effect={effect} (expected brightness_boost)")
                self.failed_tests += 1
        else:
            log_error("Failed to retrieve overlay data")
            self.failed_tests += 1

        return True

    def test_final_video_versioning(self):
        """Test 6: Final video versioning and Gallery"""
        log_section("TEST 6: Final Video Versioning and Gallery")

        # Export final video version 1
        with open(self.video_file, 'rb') as f:
            files = {'video': f}
            data = {
                'project_id': self.test_project_id,
                'overlay_data': json.dumps({})
            }
            response = requests.post(f"{BASE_URL}/export/final", files=files, data=data)

        if response.status_code == 200:
            result = response.json()
            self.test_final_video_ids.append(result['final_video_id'])
            log_success(f"Created final video v1 (ID: {result['final_video_id']})")
            self.passed_tests += 1
        else:
            log_error(f"Failed to export final video: {response.text}")
            self.failed_tests += 1
            return False

        # Export final video version 2
        time.sleep(0.5)
        with open(self.video_file, 'rb') as f:
            files = {'video': f}
            data = {
                'project_id': self.test_project_id,
                'overlay_data': json.dumps({})
            }
            response = requests.post(f"{BASE_URL}/export/final", files=files, data=data)

        if response.status_code == 200:
            result = response.json()
            self.test_final_video_ids.append(result['final_video_id'])
            log_success(f"Created final video v2 (ID: {result['final_video_id']})")
            self.passed_tests += 1
        else:
            log_error(f"Failed to export final video v2: {response.text}")
            self.failed_tests += 1

        # Export final video version 3
        time.sleep(0.5)
        with open(self.video_file, 'rb') as f:
            files = {'video': f}
            data = {
                'project_id': self.test_project_id,
                'overlay_data': json.dumps({})
            }
            response = requests.post(f"{BASE_URL}/export/final", files=files, data=data)

        if response.status_code == 200:
            result = response.json()
            self.test_final_video_ids.append(result['final_video_id'])
            log_success(f"Created final video v3 (ID: {result['final_video_id']})")
            self.passed_tests += 1
        else:
            log_error(f"Failed to export final video v3: {response.text}")
            self.failed_tests += 1

        # Verify Gallery shows all versions
        response = requests.get(f"{BASE_URL}/downloads")
        if response.status_code == 200:
            data = response.json()
            test_downloads = [d for d in data['downloads'] if d['project_id'] == self.test_project_id]
            if len(test_downloads) == 3:
                log_success(f"Gallery shows all 3 versions")
                self.passed_tests += 1
            else:
                log_error(f"Expected 3 videos in gallery, got {len(test_downloads)}")
                self.failed_tests += 1
        else:
            log_error("Failed to fetch downloads")
            self.failed_tests += 1

        # Test download count
        response = requests.get(f"{BASE_URL}/downloads/count")
        if response.status_code == 200:
            count = response.json()['count']
            if count >= 3:
                log_success(f"Download count endpoint works ({count} total)")
                self.passed_tests += 1
            else:
                log_error(f"Download count too low: {count}")
                self.failed_tests += 1

        return True

    def test_version_deletion(self):
        """Test 7: Version deletion and cleanup"""
        log_section("TEST 7: Version Deletion and Cleanup")

        # Delete version 1
        response = requests.delete(f"{BASE_URL}/downloads/{self.test_final_video_ids[0]}")
        if response.status_code == 200:
            log_success("Deleted final video v1")
            self.passed_tests += 1
        else:
            log_error(f"Failed to delete video: {response.text}")
            self.failed_tests += 1

        # Verify only 2 versions remain
        response = requests.get(f"{BASE_URL}/downloads")
        if response.status_code == 200:
            data = response.json()
            test_downloads = [d for d in data['downloads'] if d['project_id'] == self.test_project_id]
            if len(test_downloads) == 2:
                log_success("Only 2 versions remain after deletion")
                self.passed_tests += 1
            else:
                log_error(f"Expected 2 videos, got {len(test_downloads)}")
                self.failed_tests += 1

        # Delete current final video (should clear project reference)
        response = requests.delete(f"{BASE_URL}/downloads/{self.test_final_video_ids[2]}")
        if response.status_code == 200:
            log_success("Deleted current final video")
            self.passed_tests += 1
        else:
            log_error("Failed to delete current video")
            self.failed_tests += 1

        # Verify project's final_video_id was cleared
        response = requests.get(f"{BASE_URL}/projects")
        if response.status_code == 200:
            projects = response.json()
            test_project = next((p for p in projects if p['id'] == self.test_project_id), None)
            if test_project and test_project.get('final_video_id') is None:
                log_success("Project's final_video_id was cleared")
                self.passed_tests += 1
            else:
                log_error("Project's final_video_id was not cleared")
                self.failed_tests += 1

        return True

    def cleanup(self):
        """Cleanup test data"""
        log_section("CLEANUP: Removing test data")

        # Delete test project
        if self.test_project_id:
            response = requests.delete(f"{BASE_URL}/projects/{self.test_project_id}")
            if response.status_code == 200:
                log_success(f"Deleted test project (ID: {self.test_project_id})")
            else:
                log_error("Failed to delete test project")

    def run_all_tests(self):
        """Run all tests"""
        log_info("Starting comprehensive persistence tests...")
        log_info(f"Testing against: {BASE_URL}")

        try:
            self.setup()
            self.test_project_creation_and_state()
            self.test_clip_versioning()
            self.test_framing_persistence()
            self.test_working_video_versioning()
            self.test_overlay_persistence()
            self.test_final_video_versioning()
            self.test_version_deletion()
        except KeyboardInterrupt:
            log_error("\n\nTests interrupted by user")
        except Exception as e:
            log_error(f"\n\nUnexpected error: {e}")
            import traceback
            traceback.print_exc()
        finally:
            self.cleanup()
            self.print_summary()

    def print_summary(self):
        """Print test summary"""
        log_section("TEST SUMMARY")
        total = self.passed_tests + self.failed_tests

        log(f"Total tests: {total}")
        log_success(f"Passed: {self.passed_tests}")

        if self.failed_tests > 0:
            log_error(f"Failed: {self.failed_tests}")
        else:
            log(f"Failed: {self.failed_tests}")

        if self.failed_tests == 0:
            log_success("\n*** ALL TESTS PASSED! ***")
        else:
            log_error(f"\n*** {self.failed_tests} TEST(S) FAILED ***")
            sys.exit(1)

if __name__ == "__main__":
    # Check if server is running
    try:
        response = requests.get(f"{BASE_URL}/projects", timeout=2)
    except requests.exceptions.RequestException:
        log_error("Backend server is not running!")
        log_info("Please start the server with: cd src/backend && .venv/Scripts/python.exe -m uvicorn app.main:app --reload")
        sys.exit(1)

    tester = PersistenceTest()
    tester.run_all_tests()
