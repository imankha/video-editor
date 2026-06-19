"""
Tests for game aggregates exposed by the API. clip_count + rating counts +
aggregate_score are derived live from raw_clips (no stored columns); these verify
GET /api/games returns the correct derived values after annotations change.
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
TEST_PROFILE_ID = "testdefault"

# Pre-populate _init_cache so the middleware uses "testdefault" as the profile
# instead of running user_session_init() which would create a new profile UUID.
from app.session_init import _init_cache
_init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}


def setup_module():
    """Set up test environment with isolated user namespace."""
    from app.user_context import set_current_user_id
    from app.profile_context import set_current_profile_id
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)


def teardown_module():
    """Cleanup test user data directory and reset user context."""
    from app.database import USER_DATA_BASE
    from app.user_context import set_current_user_id, reset_user_id
    from app.profile_context import set_current_profile_id

    set_current_user_id(TEST_USER_ID)
    set_current_profile_id("testdefault")
    # Clean up the entire user directory (includes profiles/)
    test_path = USER_DATA_BASE / TEST_USER_ID
    if test_path.exists():
        shutil.rmtree(test_path, ignore_errors=True)

    reset_user_id()


# Now import what we need
from fastapi.testclient import TestClient
from app.main import app


@pytest.fixture(scope="module")
def client():
    """Create a test client with test user header."""
    with TestClient(app, headers={"X-User-ID": TEST_USER_ID, "X-Profile-ID": "testdefault"}) as c:
        yield c


@pytest.fixture
def empty_game(client):
    """Create a game with no annotations directly in database."""
    from app.database import get_db_connection

    # Create game directly in database (no video upload needed for these tests)
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO games (name, blake3_hash)
            VALUES (?, ?)
        """, ("Empty Test Game", "test_hash_" + uuid.uuid4().hex[:32]))
        conn.commit()
        game_id = cursor.lastrowid

    # Fetch the game via API to get the full structure
    response = client.get(f"/api/games/{game_id}")
    assert response.status_code == 200
    game = response.json()
    yield game
    # Cleanup
    client.delete(f"/api/games/{game_id}")


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
        # aggregate_score (derived): b*3 + g*2 + m*-1 + bl*-2 = 2*3 + 1*2 + 1*-2 = 6
        assert game["aggregate_score"] == 6

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
        # aggregate_score (derived): b*3 + g*2 + m*-1 + bl*-2 = 3 + 2 - 1 - 2 = 2
        # (interesting clips carry no weight)
        assert game["aggregate_score"] == 2

    def test_aggregate_score_formula(self, client, empty_game):
        """Verify the (derived) aggregate score formula: b*3 + g*2 + m*-1 + bl*-2."""
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

        # b=3, g=2, m=1, bl=1 -> 3*3 + 2*2 + 1*-1 + 1*-2 = 9 + 4 - 1 - 2 = 10
        assert game["aggregate_score"] == 10

    def test_teammate_clips_excluded_from_quality(self, client, empty_game):
        """A teammate clip (my_athlete=0) counts toward clip_count but must NOT
        affect the quality calculation (rating badges + aggregate_score)."""
        from app.database import get_db_connection

        annotations = [
            {"start_time": 10, "end_time": 25, "name": "Mine", "rating": 5, "tags": [], "notes": ""},
            {"start_time": 30, "end_time": 45, "name": "Teammate", "rating": 5, "tags": [], "notes": ""},
        ]
        client.put(f"/api/games/{empty_game['id']}/annotations", json=annotations)

        # Mark the second clip as a teammate clip (my_athlete=0) directly in the DB.
        with get_db_connection() as conn:
            conn.execute(
                "UPDATE raw_clips SET my_athlete = 0 WHERE game_id = ? AND end_time = 45",
                (empty_game['id'],),
            )
            conn.commit()

        response = client.get("/api/games")
        game = next(g for g in response.json()["games"] if g["id"] == empty_game['id'])

        assert game["clip_count"] == 2          # teammate clip still counted
        assert game["brilliant_count"] == 1     # only my-athlete 5-star counts
        assert game["aggregate_score"] == 3     # b=1 -> 1*3, teammate excluded


class TestListGamesPerformance:
    """list_games derives aggregates live from raw_clips."""

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
