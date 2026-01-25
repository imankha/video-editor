#!/usr/bin/env python3
"""
API endpoint verification tests.
Run: python test_api.py

Tests the backend API routes work correctly.
"""

import requests
import sys
import pytest

BASE = "http://localhost:8000"

def _server_running():
    """Check if the backend server is running."""
    try:
        r = requests.get(f"{BASE}/api/health", timeout=2)
        return r.status_code == 200
    except requests.exceptions.ConnectionError:
        return False
    except requests.exceptions.Timeout:
        return False

def test_health():
    """Test health check endpoint."""
    if not _server_running():
        pytest.skip("Backend server not running at localhost:8000")
    r = requests.get(f"{BASE}/api/health")
    assert r.status_code == 200, f"Health check failed: {r.status_code}"
    print("[OK] Health check passed")
    return True

def test_projects():
    """Test projects endpoint."""
    if not _server_running():
        pytest.skip("Backend server not running at localhost:8000")
    r = requests.get(f"{BASE}/api/projects")
    assert r.status_code == 200, f"Projects failed: {r.status_code}"
    projects = r.json()
    print(f"[OK] Projects endpoint: {len(projects)} found")
    return projects

def test_games():
    """Test games endpoint."""
    if not _server_running():
        pytest.skip("Backend server not running at localhost:8000")
    r = requests.get(f"{BASE}/api/games")
    assert r.status_code == 200, f"Games failed: {r.status_code}"
    games = r.json()
    print(f"[OK] Games endpoint: {len(games)} found")
    return games

def test_raw_clips():
    """Test raw clips endpoint."""
    if not _server_running():
        pytest.skip("Backend server not running at localhost:8000")
    r = requests.get(f"{BASE}/api/clips/raw")
    assert r.status_code == 200, f"Raw clips failed: {r.status_code}"
    clips = r.json()
    print(f"[OK] Raw clips endpoint: {len(clips)} found")

def test_downloads():
    """Test downloads/gallery endpoint."""
    if not _server_running():
        pytest.skip("Backend server not running at localhost:8000")
    r = requests.get(f"{BASE}/api/downloads")
    assert r.status_code == 200, f"Downloads failed: {r.status_code}"
    data = r.json()
    count = len(data.get('downloads', []))
    print(f"[OK] Downloads endpoint: {count} videos found")

def main():
    print("=" * 50)
    print("API Endpoint Verification Tests")
    print("=" * 50)
    print(f"Target: {BASE}\n")

    try:
        test_health()
    except requests.exceptions.ConnectionError:
        print("[FAIL] Cannot connect to backend. Is it running?")
        print(f"  Start with: cd src/backend && venv/Scripts/python.exe -m uvicorn app.main:app --port 8000")
        sys.exit(1)

    tests = [
        test_projects,
        test_games,
        test_raw_clips,
        test_downloads,
    ]

    passed = 0
    failed = 0

    for test in tests:
        try:
            test()
            passed += 1
        except AssertionError as e:
            print(f"[FAIL] {test.__name__}: {e}")
            failed += 1
        except Exception as e:
            print(f"[FAIL] {test.__name__}: Unexpected error: {e}")
            failed += 1

    print("\n" + "=" * 50)
    print(f"Results: {passed} passed, {failed} failed")
    print("=" * 50)

    sys.exit(0 if failed == 0 else 1)

if __name__ == "__main__":
    main()
