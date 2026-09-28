from app.queries import exclude_team_highlights_from_rank_clause
from app.services.auto_export import select_highlights_for_auto_export


def test_ranking_clause_excludes_team_layer_without_changing_other_surfaces():
    clause = exclude_team_highlights_from_rank_clause("ranked")
    assert "rank_rc.id = ranked.source_clip_id" in clause
    assert "rank_rc.my_athlete = 0" in clause


def test_four_star_fallback_runs_independently_for_each_layer():
    clips = [
        {"id": 1, "rating": 5, "my_athlete": 1},
        {"id": 2, "rating": 4, "my_athlete": 1},
        {"id": 3, "rating": 4, "my_athlete": 0},
        {"id": 4, "rating": 3, "my_athlete": 0},
    ]

    assert [clip["id"] for clip in select_highlights_for_auto_export(clips)] == [1, 3]


def test_five_star_in_one_layer_does_not_suppress_other_layers_four_star_fallback():
    clips = [
        {"id": 1, "rating": 4, "my_athlete": None},
        {"id": 2, "rating": 5, "my_athlete": 0},
        {"id": 3, "rating": 4, "my_athlete": 0},
    ]

    assert [clip["id"] for clip in select_highlights_for_auto_export(clips)] == [1, 2]
