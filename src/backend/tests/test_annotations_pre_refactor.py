"""
Pre-refactor tests for annotations functionality.
These tests document current behavior and MUST pass before AND after refactor.
Run with: pytest src/backend/tests/test_annotations_pre_refactor.py -v
"""

import pytest
import tempfile
import shutil
import sys
import os
from pathlib import Path

# Add the app directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

# Set up temp directory BEFORE importing app modules
_temp_dir = tempfile.mkdtemp()
_temp_path = Path(_temp_dir)


def setup_module():
    """Set up test environment with temp paths at module load."""
    global _temp_dir, _temp_path

    # Patch the database module before it's used
    import app.database as db

    # Override paths
    db.USER_DATA_PATH = _temp_path
    db.DATABASE_PATH = _temp_path / "database.sqlite"
    db.RAW_CLIPS_PATH = _temp_path / "raw_clips"
    db.UPLOADS_PATH = _temp_path / "uploads"
    db.WORKING_VIDEOS_PATH = _temp_path / "working_videos"
    db.FINAL_VIDEOS_PATH = _temp_path / "final_videos"
    db.DOWNLOADS_PATH = _temp_path / "downloads"
    db.GAMES_PATH = _temp_path / "games"
    db.CLIP_CACHE_PATH = _temp_path / "clip_cache"
    db._initialized = False

    # Also patch games router
    import app.routers.games as games_router
    games_router.GAMES_PATH = _temp_path / "games"


def teardown_module():
    """Cleanup temp directory."""
    global _temp_dir
    shutil.rmtree(_temp_dir, ignore_errors=True)


# Initialize paths before importing app
setup_module()


# Now import what we need
from fastapi.testclient import TestClient
from app.main import app


@pytest.fixture(scope="module")
def client():
    """Create a test client using context manager."""
    with TestClient(app) as c:
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


@pytest.fixture
def game_with_annotations(client):
    """Create a game with 3 test annotations."""
    # Create game
    response = client.post(
        "/api/games",
        data={"name": "Game With Annotations"}
    )
    assert response.status_code == 200
    game = response.json()["game"]

    # Add annotations
    annotations = [
        {"start_time": 10, "end_time": 25, "name": "First Clip", "rating": 5, "tags": ["Goals"], "notes": "Great goal"},
        {"start_time": 30, "end_time": 45, "name": "Second Clip", "rating": 4, "tags": ["Assists", "Passing Range"], "notes": ""},
        {"start_time": 60, "end_time": 75, "name": "Third Clip", "rating": 3, "tags": [], "notes": "Interesting play"},
    ]

    response = client.put(
        f"/api/games/{game['id']}/annotations",
        json=annotations
    )
    assert response.status_code == 200

    yield game
    # Cleanup
    client.delete(f"/api/games/{game['id']}")


class TestListGames:
    """Test GET /api/games endpoint."""

    def test_list_games_returns_clip_count(self, client, game_with_annotations):
        """Clip count should be returned for each game."""
        response = client.get("/api/games")
        assert response.status_code == 200
        games = response.json()["games"]

        # Find our test game
        test_game = next((g for g in games if g["id"] == game_with_annotations["id"]), None)
        assert test_game is not None
        assert "clip_count" in test_game
        assert test_game["clip_count"] == 3

    def test_list_games_empty_game(self, client, empty_game):
        """Empty game should have clip_count of 0."""
        response = client.get("/api/games")
        assert response.status_code == 200
        games = response.json()["games"]

        test_game = next((g for g in games if g["id"] == empty_game["id"]), None)
        assert test_game is not None
        assert test_game["clip_count"] == 0

    def test_list_games_returns_array(self, client):
        """List games should return a games array."""
        response = client.get("/api/games")
        assert response.status_code == 200
        assert "games" in response.json()
        assert isinstance(response.json()["games"], list)


class TestGetGame:
    """Test GET /api/games/{id} endpoint."""

    def test_get_game_returns_annotations(self, client, game_with_annotations):
        """Should return full annotations array."""
        response = client.get(f"/api/games/{game_with_annotations['id']}")
        assert response.status_code == 200
        data = response.json()
        assert "annotations" in data
        assert len(data["annotations"]) == 3

    def test_get_game_annotation_shape(self, client, game_with_annotations):
        """Each annotation should have required fields."""
        response = client.get(f"/api/games/{game_with_annotations['id']}")
        ann = response.json()["annotations"][0]
        assert "start_time" in ann
        assert "end_time" in ann
        assert "name" in ann
        assert "rating" in ann
        assert "tags" in ann
        assert "notes" in ann

    def test_get_game_not_found(self, client):
        """Should return 404 for non-existent game."""
        response = client.get("/api/games/99999")
        assert response.status_code == 404

    def test_get_empty_game_returns_empty_annotations(self, client, empty_game):
        """Empty game should return empty annotations array."""
        response = client.get(f"/api/games/{empty_game['id']}")
        assert response.status_code == 200
        assert response.json()["annotations"] == []


class TestSaveAnnotations:
    """Test PUT /api/games/{id}/annotations endpoint."""

    def test_save_annotations_creates(self, client, empty_game):
        """Should save new annotations."""
        annotations = [
            {"start_time": 10, "end_time": 25, "name": "Test", "rating": 5, "tags": ["Goals"], "notes": ""}
        ]
        response = client.put(
            f"/api/games/{empty_game['id']}/annotations",
            json=annotations
        )
        assert response.status_code == 200
        assert response.json()["clip_count"] == 1

    def test_save_annotations_updates(self, client, game_with_annotations):
        """Should replace existing annotations."""
        new_annotations = [
            {"start_time": 5, "end_time": 20, "name": "New", "rating": 4, "tags": [], "notes": "updated"}
        ]
        response = client.put(
            f"/api/games/{game_with_annotations['id']}/annotations",
            json=new_annotations
        )
        assert response.status_code == 200
        assert response.json()["clip_count"] == 1

        # Verify update
        get_response = client.get(f"/api/games/{game_with_annotations['id']}")
        assert len(get_response.json()["annotations"]) == 1
        assert get_response.json()["annotations"][0]["name"] == "New"

    def test_save_empty_annotations(self, client, game_with_annotations):
        """Should allow saving empty annotations array."""
        response = client.put(
            f"/api/games/{game_with_annotations['id']}/annotations",
            json=[]
        )
        assert response.status_code == 200
        assert response.json()["clip_count"] == 0

    def test_save_annotations_returns_clip_count(self, client, empty_game):
        """Should return correct clip_count after save."""
        annotations = [
            {"start_time": 10, "end_time": 25, "name": "A", "rating": 5, "tags": [], "notes": ""},
            {"start_time": 30, "end_time": 45, "name": "B", "rating": 4, "tags": [], "notes": ""},
        ]
        response = client.put(
            f"/api/games/{empty_game['id']}/annotations",
            json=annotations
        )
        assert response.status_code == 200
        assert response.json()["clip_count"] == 2


class TestDeleteGame:
    """Test DELETE /api/games/{id} endpoint."""

    def test_delete_game_removes_annotations(self, client):
        """Deleting game should remove it from list."""
        # Create a game
        create_response = client.post(
            "/api/games",
            data={"name": "To Delete"}
        )
        game = create_response.json()["game"]
        game_id = game["id"]

        # Add annotations
        client.put(
            f"/api/games/{game_id}/annotations",
            json=[{"start_time": 10, "end_time": 25, "name": "Test", "rating": 5, "tags": [], "notes": ""}]
        )

        # Delete
        response = client.delete(f"/api/games/{game_id}")
        assert response.status_code == 200

        # Verify game is gone
        get_response = client.get(f"/api/games/{game_id}")
        assert get_response.status_code == 404


class TestAnnotationDataIntegrity:
    """Test data integrity across operations."""

    def test_rating_preserved(self, client, empty_game):
        """Rating values 1-5 should be preserved exactly."""
        for rating in [1, 2, 3, 4, 5]:
            annotations = [
                {"start_time": 10, "end_time": 25, "name": f"R{rating}", "rating": rating, "tags": [], "notes": ""}
            ]
            client.put(f"/api/games/{empty_game['id']}/annotations", json=annotations)
            response = client.get(f"/api/games/{empty_game['id']}")
            assert response.json()["annotations"][0]["rating"] == rating

    def test_tags_preserved(self, client, empty_game):
        """Tags array should be preserved exactly."""
        tags = ["Goals", "Dribbling", "Assists"]
        annotations = [
            {"start_time": 10, "end_time": 25, "name": "Test", "rating": 5, "tags": tags, "notes": ""}
        ]
        client.put(f"/api/games/{empty_game['id']}/annotations", json=annotations)
        response = client.get(f"/api/games/{empty_game['id']}")
        assert response.json()["annotations"][0]["tags"] == tags

    def test_times_preserved(self, client, empty_game):
        """Start and end times should be preserved."""
        annotations = [
            {"start_time": 90, "end_time": 105, "name": "Test", "rating": 3, "tags": [], "notes": ""}
        ]
        client.put(f"/api/games/{empty_game['id']}/annotations", json=annotations)
        response = client.get(f"/api/games/{empty_game['id']}")
        ann = response.json()["annotations"][0]
        # Note: TSV format may round to integer seconds
        assert ann["start_time"] == 90
        assert ann["end_time"] == 105

    def test_notes_preserved(self, client, empty_game):
        """Notes should be preserved."""
        notes = "Test notes with content"
        annotations = [
            {"start_time": 10, "end_time": 25, "name": "Test", "rating": 3, "tags": [], "notes": notes}
        ]
        client.put(f"/api/games/{empty_game['id']}/annotations", json=annotations)
        response = client.get(f"/api/games/{empty_game['id']}")
        assert response.json()["annotations"][0]["notes"] == notes

    def test_name_preserved(self, client, empty_game):
        """Clip name should be preserved exactly."""
        name = "My Custom Clip Name"
        annotations = [
            {"start_time": 10, "end_time": 25, "name": name, "rating": 5, "tags": [], "notes": ""}
        ]
        client.put(f"/api/games/{empty_game['id']}/annotations", json=annotations)
        response = client.get(f"/api/games/{empty_game['id']}")
        assert response.json()["annotations"][0]["name"] == name

    def test_multiple_annotations_order(self, client, empty_game):
        """Multiple annotations should be saved and retrieved."""
        annotations = [
            {"start_time": 10, "end_time": 25, "name": "First", "rating": 5, "tags": [], "notes": ""},
            {"start_time": 30, "end_time": 45, "name": "Second", "rating": 4, "tags": [], "notes": ""},
            {"start_time": 60, "end_time": 75, "name": "Third", "rating": 3, "tags": [], "notes": ""},
        ]
        client.put(f"/api/games/{empty_game['id']}/annotations", json=annotations)
        response = client.get(f"/api/games/{empty_game['id']}")
        saved = response.json()["annotations"]
        assert len(saved) == 3

        # All should be present (order may vary based on implementation)
        names = {a["name"] for a in saved}
        assert names == {"First", "Second", "Third"}


class TestCreateGame:
    """Test POST /api/games endpoint."""

    def test_create_game_without_video(self, client):
        """Should create game without video."""
        response = client.post(
            "/api/games",
            data={"name": "No Video Game"}
        )
        assert response.status_code == 200
        game = response.json()["game"]
        assert game["name"] == "No Video Game"
        assert game["clip_count"] == 0

        # Cleanup
        client.delete(f"/api/games/{game['id']}")

    def test_create_game_returns_id(self, client):
        """Created game should have an id."""
        response = client.post(
            "/api/games",
            data={"name": "Test Game"}
        )
        assert response.status_code == 200
        assert "game" in response.json()
        assert "id" in response.json()["game"]

        # Cleanup
        client.delete(f"/api/games/{response.json()['game']['id']}")


class TestRoundTrip:
    """Test complete round-trip operations."""

    def test_create_annotate_retrieve_delete(self, client):
        """Complete workflow: create game, add annotations, retrieve, delete."""
        # Create
        create_resp = client.post("/api/games", data={"name": "Round Trip Test"})
        assert create_resp.status_code == 200
        game_id = create_resp.json()["game"]["id"]

        # Add annotations
        annotations = [
            {"start_time": 0, "end_time": 10, "name": "Intro", "rating": 3, "tags": ["Movement Off Ball"], "notes": "Opening"},
            {"start_time": 100, "end_time": 115, "name": "Highlight", "rating": 5, "tags": ["Goals", "Dribbling"], "notes": "Best moment"},
        ]
        save_resp = client.put(f"/api/games/{game_id}/annotations", json=annotations)
        assert save_resp.status_code == 200
        assert save_resp.json()["clip_count"] == 2

        # Retrieve and verify
        get_resp = client.get(f"/api/games/{game_id}")
        assert get_resp.status_code == 200
        saved = get_resp.json()["annotations"]
        assert len(saved) == 2

        # Verify data integrity
        highlight = next(a for a in saved if a["name"] == "Highlight")
        assert highlight["rating"] == 5
        assert "Goals" in highlight["tags"]
        assert highlight["notes"] == "Best moment"

        # Delete
        delete_resp = client.delete(f"/api/games/{game_id}")
        assert delete_resp.status_code == 200

        # Verify deleted
        verify_resp = client.get(f"/api/games/{game_id}")
        assert verify_resp.status_code == 404
