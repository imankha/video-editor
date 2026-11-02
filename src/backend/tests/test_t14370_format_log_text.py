"""
T14370: the formatted console log of a problem report keeps the Mark play
trail. The client sends up to 300 routine + 100 error entries; the formatter
used to slice the last 200, which dropped the context lines before an error.
Pure function, no DB.
"""
from app.services.email import format_log_text


def _entries():
    logs = [{"level": "log", "message": "[CreateClip] virtual: 12.5 -> actual: 12.5", "ts": "t0"}]
    logs += [{"level": "log", "message": f"[useAnnotate] context {i}", "ts": f"t{i}"} for i in range(1, 300)]
    logs.append({"level": "error", "message": "[MarkPlay] addClipRegion {\"gameId\": 3}", "ts": "t300"})
    logs += [{"level": "warn", "message": f"[VIDEO] Suspend {i}", "ts": f"t{300 + i}"} for i in range(1, 100)]
    return logs  # 400 entries: the client's full capacity


def test_format_log_text_keeps_the_context_before_the_mark_play_error():
    text = format_log_text(_entries())
    assert "[MarkPlay] addClipRegion" in text
    # The FIRST context line (entry 0 of 400) is the one a 200-entry slice lost.
    assert "[CreateClip] virtual: 12.5" in text
    assert text.index("[CreateClip] virtual: 12.5") < text.index("[MarkPlay] addClipRegion")
