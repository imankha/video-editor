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


def _seed_annotations(game_id, annotations):
    """Seed/replace a game's raw_clips from an annotations list.

    Replicates the sync semantics of the removed save_annotations_to_db (T4270): upsert
    raw_clips by the (end_time, video_sequence) natural key and delete clips no longer
    present. These aggregate tests used the deleted PUT /annotations only as a seeding
    convenience; production creates clips via the surgical /clips/raw gesture flow. The
    aggregates under test (clip_count, rating counts, aggregate_score) are derived live
    from raw_clips, so seeding them directly keeps the tests exercising the real logic.
    """
    from app.database import get_db_connection
    from app.utils.encoding import encode_data

    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT id, end_time, video_sequence FROM raw_clips WHERE game_id = ?", (game_id,)
        )
        existing = {(r["end_time"], r["video_sequence"]): r["id"] for r in cur.fetchall()}
        keys = set()
        for ann in annotations:
            start_time = ann.get("start_time", 0)
            end_time = ann.get("end_time", start_time)
            vseq = ann.get("video_sequence")
            key = (end_time, vseq)
            keys.add(key)
            tags_encoded = encode_data(ann.get("tags", []))
            rating = ann.get("rating", 3)
            name = ann.get("name", "")
            notes = ann.get("notes", "")
            if key in existing:
                cur.execute(
                    "UPDATE raw_clips SET start_time=?, name=?, rating=?, tags=?, notes=? WHERE id=?",
                    (start_time, name, rating, tags_encoded, notes, existing[key]),
                )
            else:
                cur.execute(
                    "INSERT INTO raw_clips (filename, rating, tags, name, notes, start_time, "
                    "end_time, game_id, video_sequence) VALUES ('', ?, ?, ?, ?, ?, ?, ?, ?)",
                    (rating, tags_encoded, name, notes, start_time, end_time, game_id, vseq),
                )
        for key, cid in existing.items():
            if key not in keys:
                cur.execute("DELETE FROM working_clips WHERE raw_clip_id = ?", (cid,))
                cur.execute("DELETE FROM raw_clips WHERE id = ?", (cid,))
        conn.commit()


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
        _seed_annotations(empty_game['id'], annotations)

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
        _seed_annotations(empty_game['id'], annotations)

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
        _seed_annotations(empty_game['id'], new_annotations)

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
        _seed_annotations(empty_game['id'], annotations)

        # Then clear them
        _seed_annotations(empty_game['id'], [])

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
        _seed_annotations(empty_game['id'], annotations)

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
        _seed_annotations(empty_game['id'], annotations)

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
        _seed_annotations(empty_game['id'], annotations)

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
