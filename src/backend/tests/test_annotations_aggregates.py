"""
Post-refactor tests for annotations aggregate functionality.
These tests verify the new aggregate columns work correctly.
Run with: pytest src/backend/tests/test_annotations_aggregates.py -v
"""

import pytest
import shutil
import sys
import uuid
from pathlib import Path

# Add the app directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

# Generate a unique test user ID for isolation
TEST_USER_ID = f"test_aggregates_{uuid.uuid4().hex[:8]}"


def setup_module():
    """Set up test environment with isolated user namespace."""
    # Set the user context for tests
    from app.user_context import set_current_user_id
    set_current_user_id(TEST_USER_ID)


def teardown_module():
    """Cleanup test user data directory."""
    from app.database import get_user_data_path, USER_DATA_BASE
    from app.user_context import set_current_user_id

    # Set the test user context to get the right path
    set_current_user_id(TEST_USER_ID)
    test_path = get_user_data_path()
    if test_path.exists():
        shutil.rmtree(test_path, ignore_errors=True)


# Initialize user context before importing app
setup_module()


# Now import what we need
from fastapi.testclient import TestClient
from app.main import app


@pytest.fixture(scope="module")
def client():
    """Create a test client with test user header."""
    with TestClient(app, headers={"X-User-ID": TEST_USER_ID}) as c:
        yield c


@pytest.fixture
def empty_game(client):
    """Create a game with no annotations."""
    response = client.post(
        "/api/games",
        data={"name": "Empty Test Game"}
    )
    assert response.status_code == 200
    game = response.json()["game"]
    yield game
    # Cleanup
    client.delete(f"/api/games/{game['id']}")


class TestGameAggregates:
    """Test aggregate columns on games table."""

    def test_aggregates_computed_on_save(self, client, empty_game):
        """Saving annotations should update aggregate counts."""
        annotations = [
            {"start_time": 10, "end_time": 25, "name": "A", "rating": 5, "tags": [], "notes": ""},
            {"start_time": 30, "end_time": 45, "name": "B", "rating": 5, "tags": [], "notes": ""},
            {"start_time": 50, "end_time": 65, "name": "C", "rating": 4, "tags": [], "notes": ""},
            {"start_time": 70, "end_time": 85, "name": "D", "rating": 1, "tags": [], "notes": ""},
        ]
        client.put(f"/api/games/{empty_game['id']}/annotations", json=annotations)

        response = client.get("/api/games")
        game = next(g for g in response.json()["games"] if g["id"] == empty_game['id'])

        assert game["clip_count"] == 4
        assert game["brilliant_count"] == 2
        assert game["good_count"] == 1
        assert game["blunder_count"] == 1
        # aggregate_score = 2*10 + 1*5 + 0*2 + 0*(-2) + 1*(-5) = 20
        assert game["aggregate_score"] == 20

    def test_aggregates_update_on_change(self, client, empty_game):
        """Changing annotations should update aggregates."""
        # First save
        annotations = [
            {"start_time": 10, "end_time": 25, "name": "A", "rating": 5, "tags": [], "notes": ""},
            {"start_time": 30, "end_time": 45, "name": "B", "rating": 4, "tags": [], "notes": ""},
        ]
        client.put(f"/api/games/{empty_game['id']}/annotations", json=annotations)

        # Verify first save
        response = client.get("/api/games")
        game = next(g for g in response.json()["games"] if g["id"] == empty_game['id'])
        assert game["clip_count"] == 2
        assert game["brilliant_count"] == 1
        assert game["good_count"] == 1

        # Second save with different annotations
        new_annotations = [
            {"start_time": 10, "end_time": 25, "name": "Only", "rating": 3, "tags": [], "notes": ""},
        ]
        client.put(f"/api/games/{empty_game['id']}/annotations", json=new_annotations)

        # Verify aggregates updated
        response = client.get("/api/games")
        game = next(g for g in response.json()["games"] if g["id"] == empty_game['id'])

        assert game["clip_count"] == 1
        assert game["interesting_count"] == 1
        assert game["brilliant_count"] == 0
        assert game["good_count"] == 0

    def test_aggregates_zero_on_empty(self, client, empty_game):
        """Empty annotations should result in zero aggregates."""
        # First add some annotations
        annotations = [
            {"start_time": 10, "end_time": 25, "name": "A", "rating": 5, "tags": [], "notes": ""},
        ]
        client.put(f"/api/games/{empty_game['id']}/annotations", json=annotations)

        # Then clear them
        client.put(f"/api/games/{empty_game['id']}/annotations", json=[])

        response = client.get("/api/games")
        game = next(g for g in response.json()["games"] if g["id"] == empty_game['id'])

        assert game["clip_count"] == 0
        assert game["brilliant_count"] == 0
        assert game["good_count"] == 0
        assert game["interesting_count"] == 0
        assert game["mistake_count"] == 0
        assert game["blunder_count"] == 0
        assert game["aggregate_score"] == 0

    def test_all_rating_levels(self, client, empty_game):
        """Test that all rating levels are counted correctly."""
        annotations = [
            {"start_time": 10, "end_time": 25, "name": "Brilliant", "rating": 5, "tags": [], "notes": ""},
            {"start_time": 30, "end_time": 45, "name": "Good", "rating": 4, "tags": [], "notes": ""},
            {"start_time": 50, "end_time": 65, "name": "Interesting", "rating": 3, "tags": [], "notes": ""},
            {"start_time": 70, "end_time": 85, "name": "Mistake", "rating": 2, "tags": [], "notes": ""},
            {"start_time": 90, "end_time": 105, "name": "Blunder", "rating": 1, "tags": [], "notes": ""},
        ]
        client.put(f"/api/games/{empty_game['id']}/annotations", json=annotations)

        response = client.get("/api/games")
        game = next(g for g in response.json()["games"] if g["id"] == empty_game['id'])

        assert game["clip_count"] == 5
        assert game["brilliant_count"] == 1
        assert game["good_count"] == 1
        assert game["interesting_count"] == 1
        assert game["mistake_count"] == 1
        assert game["blunder_count"] == 1
        # aggregate_score = 1*10 + 1*5 + 1*2 + 1*(-2) + 1*(-5) = 10
        assert game["aggregate_score"] == 10

    def test_aggregate_score_formula(self, client, empty_game):
        """Verify the aggregate score formula."""
        # 3 brilliant (30) + 2 good (10) + 1 mistake (-2) + 1 blunder (-5) = 33
        annotations = [
            {"start_time": 10, "end_time": 25, "name": "A", "rating": 5, "tags": [], "notes": ""},
            {"start_time": 30, "end_time": 45, "name": "B", "rating": 5, "tags": [], "notes": ""},
            {"start_time": 50, "end_time": 65, "name": "C", "rating": 5, "tags": [], "notes": ""},
            {"start_time": 70, "end_time": 85, "name": "D", "rating": 4, "tags": [], "notes": ""},
            {"start_time": 90, "end_time": 105, "name": "E", "rating": 4, "tags": [], "notes": ""},
            {"start_time": 110, "end_time": 125, "name": "F", "rating": 2, "tags": [], "notes": ""},
            {"start_time": 130, "end_time": 145, "name": "G", "rating": 1, "tags": [], "notes": ""},
        ]
        client.put(f"/api/games/{empty_game['id']}/annotations", json=annotations)

        response = client.get("/api/games")
        game = next(g for g in response.json()["games"] if g["id"] == empty_game['id'])

        # 3*10 + 2*5 + 0*2 + 1*(-2) + 1*(-5) = 30 + 10 - 2 - 5 = 33
        assert game["aggregate_score"] == 33


class TestListGamesPerformance:
    """Test that list_games uses cached aggregates."""

    def test_list_games_returns_aggregates(self, client, empty_game):
        """List games should include aggregate fields."""
        response = client.get("/api/games")
        assert response.status_code == 200

        game = next(g for g in response.json()["games"] if g["id"] == empty_game['id'])

        # All aggregate fields should be present
        assert "clip_count" in game
        assert "brilliant_count" in game
        assert "good_count" in game
        assert "interesting_count" in game
        assert "mistake_count" in game
        assert "blunder_count" in game
        assert "aggregate_score" in game
