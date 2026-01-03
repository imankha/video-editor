#!/usr/bin/env python3
"""
API endpoint verification tests.
Run: python test_api.py

Tests the backend API routes work correctly.
"""

import requests
import sys

BASE = "http://localhost:8000"

def test_health():
    """Test health check endpoint."""
    r = requests.get(f"{BASE}/api/health")
    assert r.status_code == 200, f"Health check failed: {r.status_code}"
    print("✓ Health check passed")
    return True

def test_projects():
    """Test projects endpoint."""
    r = requests.get(f"{BASE}/api/projects")
    assert r.status_code == 200, f"Projects failed: {r.status_code}"
    projects = r.json()
    print(f"✓ Projects endpoint: {len(projects)} found")
    return projects

def test_games():
    """Test games endpoint."""
    r = requests.get(f"{BASE}/api/games")
    assert r.status_code == 200, f"Games failed: {r.status_code}"
    games = r.json()
    print(f"✓ Games endpoint: {len(games)} found")
    return games

def test_clips():
    """Test clips endpoint."""
    r = requests.get(f"{BASE}/api/clips")
    assert r.status_code == 200, f"Clips failed: {r.status_code}"
    clips = r.json()
    print(f"✓ Clips endpoint: {len(clips)} found")
    return clips

def test_working_videos():
    """Test working videos endpoint."""
    r = requests.get(f"{BASE}/api/export/working-videos")
    assert r.status_code == 200, f"Working videos failed: {r.status_code}"
    videos = r.json()
    print(f"✓ Working videos endpoint: {len(videos)} found")
    return videos

def test_websocket_route_exists():
    """Test WebSocket route is registered (will fail upgrade but shouldn't 404)."""
    r = requests.get(f"{BASE}/ws/export/test-123", headers={"Upgrade": "websocket"})
    # Expect 400 or 426 (upgrade required), not 404
    assert r.status_code != 404, f"WebSocket route not found (404)"
    print(f"✓ WebSocket route exists (status: {r.status_code})")
    return True

def main():
    print("=" * 50)
    print("API Endpoint Verification Tests")
    print("=" * 50)
    print(f"Target: {BASE}\n")

    try:
        test_health()
    except requests.exceptions.ConnectionError:
        print("✗ Cannot connect to backend. Is it running?")
        print(f"  Start with: cd src/backend && .venv/Scripts/python.exe -m uvicorn app.main:app --port 8000")
        sys.exit(1)

    tests = [
        test_projects,
        test_games,
        test_clips,
        test_working_videos,
        test_websocket_route_exists,
    ]

    passed = 0
    failed = 0

    for test in tests:
        try:
            test()
            passed += 1
        except AssertionError as e:
            print(f"✗ {test.__name__}: {e}")
            failed += 1
        except Exception as e:
            print(f"✗ {test.__name__}: Unexpected error: {e}")
            failed += 1

    print("\n" + "=" * 50)
    print(f"Results: {passed} passed, {failed} failed")
    print("=" * 50)

    sys.exit(0 if failed == 0 else 1)

if __name__ == "__main__":
    main()
