"""T13933: Modal containers' own R2 operations are counted in the usage attribution.

Modal side: each `@app.function` counts the boto3 calls its R2 client makes (a botocore
after-call hook installed by video_processing.get_r2_client) and returns them in its
result as `r2_ops: {function: {op: n}}` -- on the plain return, or on a generator's
final (status-bearing) yield.

Backend side: modal_client credits those counts under `modal:{function}` in the same
usage buffer the backend's own boto3 hook feeds, so they reach analytics.sqlite. A result
from an older Modal deploy (no `r2_ops`) is logged and fabricates nothing.

Real boto3 clients and hooks; only the HTTP send is faked (tests/r2_fake_transport.py).

Run with: pytest tests/test_t13933_modal_r2_ops.py -v
"""

import logging
import subprocess
import sys
from collections import Counter
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent))

from r2_fake_transport import FakeR2Transport

from app import r2_usage, storage
from app.modal_functions import video_processing as vp
from app.services import modal_client
from app.services.analytics_store import AnalyticsStore

BUCKET = "t13933-bucket"
PREFIX = "t13933-user"


@pytest.fixture
def fake_r2(monkeypatch):
    """Point video_processing.get_r2_client (the REAL one, hook included) at the fake
    transport by wrapping boto3.client: path-style addressing so the fake can parse
    the key, no retries, and the fake's before-send handler."""
    import boto3
    from botocore.config import Config

    fake = FakeR2Transport()
    real_client = boto3.client

    def client(*args, **kwargs):
        kwargs["config"] = kwargs["config"].merge(
            Config(s3={"addressing_style": "path"}, retries={"max_attempts": 0}))
        c = real_client(*args, **kwargs)
        c.meta.events.register("before-send.s3", fake._send)
        return c

    monkeypatch.setattr(boto3, "client", client)
    monkeypatch.setenv("R2_ENDPOINT_URL", "https://fake-r2.test")
    monkeypatch.setenv("R2_ACCESS_KEY_ID", "fake")
    monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "fake")
    monkeypatch.setenv("R2_BUCKET_NAME", BUCKET)
    return fake


@pytest.fixture
def tiny_mp4(tmp_path) -> bytes:
    out = tmp_path / "tiny.mp4"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=64x64:d=0.5:r=10",
         "-pix_fmt", "yuv420p", "-y", str(out)],
        check=True,
    )
    return out.read_bytes()


def _sent_ops(fake: FakeR2Transport) -> dict[str, int]:
    return dict(Counter(fake.ops()))


# -- Modal side ---------------------------------------------------------------


def test_plain_modal_function_returns_its_r2_ops(fake_r2, tiny_mp4):
    fake_r2.put_foreign(f"{PREFIX}/members/a.mp4", tiny_mp4)

    result = vp.stitch_members.local(PREFIX, ["members/a.mp4"], "scratch/out.mp4")

    assert result["output_key"] == "scratch/out.mp4"
    # Exactly what the container sent to R2 (download_file's HEAD+GET, the PUT).
    assert result["r2_ops"] == {"stitch_members": _sent_ops(fake_r2)}
    assert result["r2_ops"]["stitch_members"]["PutObject"] == 1


def test_generator_modal_function_reports_r2_ops_on_final_yield_only(fake_r2, tiny_mp4):
    fake_r2.put_foreign(f"{PREFIX}/working/in.mp4", tiny_mp4)

    updates = list(vp.render_overlay.local(
        job_id="t13933", user_id=PREFIX, input_key="working/in.mp4",
        output_key="working/out.mp4", highlight_regions=[],
    ))

    final = updates[-1]
    assert final["status"] == "success", final
    assert final["r2_ops"] == {"render_overlay": _sent_ops(fake_r2)}
    assert all("r2_ops" not in u for u in updates[:-1])


def test_counts_do_not_carry_over_between_invocations(fake_r2, tiny_mp4):
    fake_r2.put_foreign(f"{PREFIX}/members/a.mp4", tiny_mp4)
    vp.stitch_members.local(PREFIX, ["members/a.mp4"], "scratch/one.mp4")
    first = len(fake_r2.ops())

    result = vp.stitch_members.local(PREFIX, ["members/a.mp4"], "scratch/two.mp4")

    second_ops = dict(Counter(fake_r2.ops()[first:]))
    assert result["r2_ops"] == {"stitch_members": second_ops}


def test_every_modal_function_reports_and_none_runs_concurrent_inputs():
    """The per-container counter assumes one input per container at a time, and a
    function without the decorator would silently drop out of the attribution."""
    import ast

    tree = ast.parse(Path(vp.__file__).read_text())
    functions = {
        node.name: [ast.unparse(d) for d in node.decorator_list]
        for node in tree.body
        if isinstance(node, ast.FunctionDef)
        and any(ast.unparse(d).startswith("app.function(") for d in node.decorator_list)
    }
    assert len(functions) >= 10
    for name, decorators in functions.items():
        assert "_reports_r2_ops" in decorators, name
        assert not any("concurren" in d or "max_inputs" in d for d in decorators), name


# -- backend side ---------------------------------------------------------------


class _FakeRemoteFn:
    def __init__(self, result):
        self._result = result

    def remote(self, *args, **kwargs):
        return dict(self._result)


class _FakeGenFn:
    def __init__(self, items):
        self._items = items

    def remote_gen(self, **kwargs):
        return iter([dict(i) for i in self._items])


@pytest.fixture
def store(tmp_path):
    fake = FakeR2Transport()
    with fake.patched_storage_clients():
        store = AnalyticsStore(
            local_path=tmp_path / "analytics_data" / "analytics.sqlite",
            key=f"{storage.APP_ENV}/analytics/shards/t13933-w1/analytics.sqlite",
            writer_id="t13933-w1",
            env=storage.APP_ENV,
        )
        assert store.confirm_baseline() is True
        r2_usage.usage_buffer().drain()  # start every test from an empty global buffer
        yield store


def _modal_rows(store: AnalyticsStore) -> dict[tuple, int]:
    """analytics.sqlite rows credited to Modal functions: (env, source, op_class, op) -> n."""
    assert store.flush_local() is True
    return {
        key[1:]: n for key, n in store.local_counts().items() if key[2].startswith("modal:")
    }


@pytest.mark.asyncio
async def test_plain_result_credited_under_modal_function_in_analytics_sqlite(store, monkeypatch):
    monkeypatch.setattr(modal_client, "_get_stitch_members_fn", lambda: _FakeRemoteFn({
        "output_key": "scratch/out.mp4", "duration": 1.0,
        "r2_ops": {"stitch_members": {"HeadObject": 2, "GetObject": 2, "PutObject": 1}},
    }))

    result = await modal_client.call_modal_stitch_members(PREFIX, ["a", "b"], "scratch/out.mp4")

    env = storage.APP_ENV
    assert _modal_rows(store) == {
        (env, "modal:stitch_members", "B", "HeadObject"): 2,
        (env, "modal:stitch_members", "B", "GetObject"): 2,
        (env, "modal:stitch_members", "A", "PutObject"): 1,
    }
    assert "r2_ops" not in result  # the counts are consumed, not passed to callers


@pytest.mark.asyncio
async def test_streamed_result_credits_every_reported_function(store, monkeypatch):
    """A parallel framing job reports its chunk containers' ops alongside its own."""
    monkeypatch.setattr(modal_client, "_modal_enabled", True)
    monkeypatch.setattr(modal_client, "_resolve_modal_user_id", lambda uid: uid)
    monkeypatch.setattr(modal_client, "_get_process_framing_ai_parallel_fn", lambda: _FakeGenFn([
        {"progress": 50, "phase": "processing", "message": "..."},
        {"status": "success", "output_key": "out.mp4", "r2_ops": {
            "process_framing_ai_parallel": {"PutObject": 1, "GetObject": 2},
            "process_framing_ai_chunk": {"PutObject": 2},
        }},
    ]))

    result = await modal_client.call_modal_framing_ai(
        job_id="t13933", user_id=PREFIX, input_key="in.mp4", output_key="out.mp4",
        keyframes=[], output_width=1080, output_height=1920, fps=30, video_duration=600.0,
        source_start_time=0.0, source_end_time=600.0,
    )

    env = storage.APP_ENV
    assert result["status"] == "success"
    assert _modal_rows(store) == {
        (env, "modal:process_framing_ai_parallel", "A", "PutObject"): 1,
        (env, "modal:process_framing_ai_parallel", "B", "GetObject"): 2,
        (env, "modal:process_framing_ai_chunk", "A", "PutObject"): 2,
    }


@pytest.mark.asyncio
async def test_old_deploy_without_counts_is_logged_and_fabricates_nothing(store, monkeypatch, caplog):
    monkeypatch.setattr(modal_client, "_get_stitch_members_fn", lambda: _FakeRemoteFn({
        "output_key": "scratch/out.mp4", "duration": 1.0,
    }))

    with caplog.at_level(logging.WARNING):
        result = await modal_client.call_modal_stitch_members(PREFIX, ["a"], "scratch/out.mp4")

    assert result == {"output_key": "scratch/out.mp4", "duration": 1.0}
    assert _modal_rows(store) == {}
    assert any(
        r.levelno == logging.WARNING and "stitch_members" in r.getMessage() and "r2_ops" in r.getMessage()
        for r in caplog.records
    )
