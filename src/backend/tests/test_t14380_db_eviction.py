"""T14380: LRU eviction of the local per-user SQLite cache (design: T14160-design.md).

Safety (never evict what R2 lacks or what someone is using):
- every opener of a per-user DB goes through the held helper (structural scan);
- a held, marked (pending/failed/conflict) or dirty (write not uploaded) user is
  never evicted, and every skip logs its reason;
- a commit landing between the upload's checkpoint and its clean mark keeps the DB
  dirty;
- an evict pass racing a request never shows the request an empty DB and never
  lets R2 receive an upload with fewer rows;
- an evicted user's next access re-pulls through the JIT seam with every row back;
- the sweep's Phase 2 pins its holders; the privacy export still reads a profile
  that is not cached locally.

Bound: disk stays under the high-water mark across a Zipf touch pattern over 10K
profiles. The loop runs on its own 1-worker executor, never the default pool.

The red run is on the pre-T14380 HEAD, where `app.services.db_residency` does not
exist. `_residency()` returns None there and the helpers below fall back to "no
eviction", which IS that revision's behaviour, so each test fails on its behavioural
assertion (files still on disk, bytes over the mark) rather than on an ImportError.
"""

import ast
import asyncio
import importlib
import logging
import random
import sqlite3
import sys
import threading
import time
import types
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack, nullcontext
from pathlib import Path
from unittest.mock import patch

import pytest

if "cv2" not in sys.modules:
    sys.modules["cv2"] = types.ModuleType("cv2")

from tests.r2_fake_transport import FakeR2Transport

APP_DIR = Path(__file__).resolve().parent.parent / "app"
M = "app.services.sweep_scheduler"


# --------------------------------------------------------------------------- adapter

def _residency():
    try:
        return importlib.import_module("app.services.db_residency")
    except ModuleNotFoundError:
        return None  # pre-T14380 HEAD: nothing evicts


def _evict(high_water: int = 0):
    r = _residency()
    if r is None:
        return None
    return r.run_eviction_pass(high_water, min_idle_s=0)


def _hold(user_id: str):
    r = _residency()
    return r.hold_user(user_id) if r else nullcontext()


def _touch(user_id: str) -> None:
    with _hold(user_id):
        pass


# --------------------------------------------------------------------------- fixtures

@pytest.fixture
def env(tmp_path):
    from app import database, storage
    from app.services import user_db

    fake = FakeR2Transport()
    users: list[str] = []

    def new_user() -> str:
        u = f"t14380-{uuid.uuid4().hex[:8]}"
        users.append(u)
        return u

    from app.services import materialization

    with ExitStack() as stack:
        stack.enter_context(fake.patched_storage_clients())
        stack.enter_context(patch.object(database, "USER_DATA_BASE", tmp_path))
        stack.enter_context(patch.object(user_db, "USER_DATA_BASE", tmp_path))
        stack.enter_context(patch.object(database, "R2_ENABLED", True))
        stack.enter_context(patch.object(storage, "R2_ENABLED", True))
        if hasattr(materialization, "USER_DATA_BASE"):
            # Pre-T14380 HEAD bound it by value; T14380 builds paths via database.
            stack.enter_context(patch.object(materialization, "USER_DATA_BASE", tmp_path))
        yield types.SimpleNamespace(fake=fake, base=tmp_path, new_user=new_user)
    for u in users:
        user_db.forget_user_db(u)
    r = _residency()
    if r is not None:
        r._reset_for_tests()


def _profile_path(base: Path, user: str, pid: str) -> Path:
    return base / user / "profiles" / pid / "profile.sqlite"


def _user_path(base: Path, user: str) -> Path:
    return base / user / "user.sqlite"


def _set_context(user: str, pid: str) -> None:
    from app.profile_context import set_current_profile_id
    from app.user_context import set_current_user_id

    set_current_user_id(user)
    set_current_profile_id(pid)


def _write_projects(user: str, pid: str, names) -> None:
    from app import database

    _set_context(user, pid)
    with database.get_db_connection() as conn:
        for n in names:
            conn.execute("INSERT INTO projects (name, aspect_ratio) VALUES (?, '16:9')", (n,))
        conn.commit()


def _read_projects(user: str, pid: str) -> list[str]:
    from app import database

    _set_context(user, pid)
    with database.get_db_connection() as conn:
        return sorted(r[0] for r in conn.execute("SELECT name FROM projects"))


def _sync_profile(user: str, pid: str) -> None:
    from app import database
    from app.database import SyncResult

    assert database.sync_db_to_r2_explicit(user, pid) == SyncResult.OK


def _seed(user: str, profiles: dict[str, list[str]]) -> None:
    """user.sqlite listing `profiles`, each profile.sqlite holding its project
    names, everything uploaded (so every DB carries a clean mark)."""
    from app import database
    from app.database import SyncResult
    from app.services import user_db

    _set_context(user, next(iter(profiles)))
    with user_db.get_user_db_connection(user) as conn:
        for pid in profiles:
            conn.execute(
                "INSERT INTO profiles (id, name, color, is_default) VALUES (?, ?, '#fff', 0)",
                (pid, pid),
            )
        conn.commit()
    assert database.sync_user_db_to_r2_explicit(user) == SyncResult.OK
    for pid, names in profiles.items():
        _write_projects(user, pid, names)
        _sync_profile(user, pid)
    _touch(user)


def _r2_rows(fake, user: str, pid: str, scratch: Path) -> list[str]:
    (key,) = [k for k in fake.objects if k.endswith(f"/users/{user}/profiles/{pid}/profile.sqlite")]
    copy = scratch / f"r2-{uuid.uuid4().hex[:6]}.sqlite"
    copy.write_bytes(fake.objects[key]["body"])
    conn = sqlite3.connect(copy)
    try:
        return sorted(r[0] for r in conn.execute("SELECT name FROM projects"))
    finally:
        conn.close()


def _db_files(base: Path, user: str) -> list[Path]:
    root = base / user
    return sorted(root.glob("user.sqlite")) + sorted(root.glob("profiles/*/profile.sqlite"))


# --------------------------------------------------------------------------- structural

# sqlite3.connect outside the held helper. ":memory:" is always fine. Each other
# entry names a DB that is NOT under USER_DATA_BASE.
CONNECT_EXEMPT = {
    "services/analytics_store.py": "analytics shard: a sibling of user_data/ with its own CAS",
}
# Functions allowed to build a local per-user DB path (`<dir> / "profile.sqlite"`).
PATH_BUILDERS = {
    ("database.py", "profile_db_path"),
    ("database.py", "user_db_path"),
    ("services/user_db.py", "_get_user_db_path"),
}
PATH_BUILDER_MODULES = {"services/db_residency.py"}
PATH_EXEMPT = {
    ("services/credit_backfill.py", "_backfill_one_user"): "an R2 copy in a TemporaryDirectory",
}
DB_NAMES = ("profile.sqlite", "user.sqlite")


def _app_modules():
    for path in sorted(APP_DIR.rglob("*.py")):
        rel = path.relative_to(APP_DIR).as_posix()
        if rel.startswith("modal_functions/"):
            continue  # runs inside Modal: no USER_DATA_BASE there
        yield rel, ast.parse(path.read_text(encoding="utf-8"))


def _enclosing_functions(tree):
    parents = {}
    for node in ast.walk(tree):
        for child in ast.iter_child_nodes(node):
            parents[child] = node

    def enclosing(node):
        while node in parents:
            node = parents[node]
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                return node.name
        return "<module>"

    return enclosing


def test_no_sqlite_connect_outside_the_held_helper():
    offenders = []
    for rel, tree in _app_modules():
        if rel == "services/db_residency.py" or rel in CONNECT_EXEMPT:
            continue
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call) or ast.unparse(node.func) != "sqlite3.connect":
                continue
            first = node.args[0] if node.args else None
            if isinstance(first, ast.Constant) and first.value == ":memory:":
                continue
            offenders.append(f"{rel}:{node.lineno} {ast.unparse(node)[:80]}")
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module == "sqlite3":
                assert all(a.name != "connect" for a in node.names), f"{rel}: from sqlite3 import connect"
    assert not offenders, "open per-user DBs through db_residency.connect_db:\n" + "\n".join(offenders)


def test_no_local_db_path_built_outside_the_builders():
    offenders = []
    for rel, tree in _app_modules():
        if rel in PATH_BUILDER_MODULES:
            continue
        enclosing = _enclosing_functions(tree)
        for node in ast.walk(tree):
            if not (isinstance(node, ast.BinOp) and isinstance(node.op, ast.Div)):
                continue
            right = node.right
            if not (isinstance(right, ast.Constant) and isinstance(right.value, str)
                    and right.value.startswith(DB_NAMES)):
                continue
            fn = enclosing(node)
            if (rel, fn) in PATH_BUILDERS or (rel, fn) in PATH_EXEMPT:
                continue
            offenders.append(f"{rel}:{node.lineno} in {fn}: {ast.unparse(node)[:80]}")
    assert not offenders, "build DB paths with database.profile_db_path/user_db_path:\n" + "\n".join(offenders)


def test_db_download_and_upload_primitives_hold_the_user():
    """The primitives that create or read a DB file outside connect_db hold the
    user themselves, so no caller can forget to."""
    required = {
        "storage.py": {
            "sync_database_from_r2_if_newer", "sync_user_db_from_r2_if_newer",
            "sync_database_to_r2_with_version", "sync_user_db_to_r2_with_version",
        },
        "migrations/__init__.py": {"_download_profile_db"},
    }
    missing = []
    for rel, names in required.items():
        tree = ast.parse((APP_DIR / rel).read_text(encoding="utf-8"))
        for fn in ast.walk(tree):
            if isinstance(fn, ast.FunctionDef) and fn.name in names:
                if "hold_user(" not in ast.unparse(fn):
                    missing.append(f"{rel}:{fn.name}")
                names = names - {fn.name}
        missing += [f"{rel}:{n} (not found)" for n in names]
    assert not missing, missing


# --------------------------------------------------------------------------- safety

def test_never_evicts_a_held_user_then_evicts_it_once_released(env, caplog):
    from app import database
    from app.services.materialization import _open_profile_db

    user = env.new_user()
    _seed(user, {"p1": ["a"]})

    caplog.set_level(logging.INFO)
    with database.get_db_connection():
        _evict()
        assert all(p.exists() for p in _db_files(env.base, user)), "evicted a DB with an open connection"
    assert "reason=held" in caplog.text, "a skip must log its reason"

    raw = _open_profile_db(user, "p1")
    try:
        _evict()
        assert _profile_path(env.base, user, "p1").exists(), "evicted under a materialization connection"
    finally:
        raw.close()

    _evict()
    assert _db_files(env.base, user) == [], "a clean, released, idle user must be evicted"


@pytest.mark.parametrize("state", ["pending", "failed", "conflict", "dirty"])
def test_never_evicts_marked_or_dirty_user(env, caplog, state):
    from app import database

    user = env.new_user()
    _seed(user, {"p1": ["a"]})
    if state == "pending":
        database.mark_sync_pending(user, "p1")
    elif state == "failed":
        database.mark_sync_failed(user, "p1")
    elif state == "conflict":
        database.mark_sync_conflict(user, "p1")
    else:
        _write_projects(user, "p1", ["not uploaded"])

    caplog.set_level(logging.INFO)
    _evict()
    assert len(_db_files(env.base, user)) == 2, f"evicted a {state} user"
    reason = "dirty" if state == "dirty" else "marker"
    assert f"reason={reason}" in caplog.text

    # Once R2 has everything (and the alarm is resolved), the same user goes.
    if state == "dirty":
        _sync_profile(user, "p1")
    else:
        database.clear_scope_markers(user, "p1")
    _evict()
    assert _db_files(env.base, user) == [], "an uploaded, unmarked user must be evicted"


def test_eviction_drops_in_memory_state(env):
    from app import database, migrations
    from app.services import user_db

    user = env.new_user()
    _seed(user, {"p1": ["a"]})
    assert database._user_db_versions.get((user, "p1")) is not None

    _evict()
    assert _db_files(env.base, user) == []
    assert (user, "p1") not in database._user_db_versions
    assert user not in database._initialized_users
    assert user not in user_db._initialized_user_dbs
    assert not any(k[0] == user for k in migrations._seam_verified)
    from app import storage
    assert not any(user in k for k in storage._DB_CLEAN_MARKS)

    # A late writer of the version cache cannot resurrect a baseline or a file.
    database.set_local_db_version(user, "p1", 9)
    assert database.get_local_db_version(user, "p1") is None
    assert not _profile_path(env.base, user, "p1").exists()


def test_unlink_failure_logs_error_and_keeps_state(env, caplog):
    from app import database

    user = env.new_user()
    _seed(user, {"p1": ["a"]})
    target = _profile_path(env.base, user, "p1")
    real_unlink = Path.unlink

    def failing_unlink(self, missing_ok=False):
        if self == target:
            raise PermissionError("read-only")
        return real_unlink(self, missing_ok=missing_ok)

    caplog.set_level(logging.INFO)
    with patch.object(Path, "unlink", failing_unlink):
        _evict()
    assert target.exists()
    assert any(r.levelno == logging.ERROR and "unlink" in r.getMessage() for r in caplog.records), \
        "an unlink failure must log ERROR"
    assert database._user_db_versions.get((user, "p1")) is not None, "state must stay untouched"
    r = _residency()
    assert r is not None and user in r._LAST_USED


def test_pass_ending_above_high_water_logs_warning(env, caplog):
    from app import database

    user = env.new_user()
    _seed(user, {"p1": ["a"]})
    caplog.set_level(logging.INFO)
    with database.get_db_connection():
        report = _evict(high_water=1)
    assert report is not None and report.bytes_after > 1
    assert any(r.levelno == logging.WARNING and "above high water" in r.getMessage()
               for r in caplog.records)


def test_eviction_is_off_without_r2(env):
    from app import database

    user = env.new_user()
    _seed(user, {"p1": ["a"]})
    with patch.object(database, "R2_ENABLED", False):
        _evict()
    assert len(_db_files(env.base, user)) == 2, "local mode: the disk IS the truth"
    _evict()
    assert _db_files(env.base, user) == []


# --------------------------------------------------------------------------- races

@pytest.mark.parametrize("via_symlink", [False, True])
@pytest.mark.parametrize("writer", ["tracked", "raw"])
def test_commit_between_checkpoint_and_clean_mark_stays_dirty(
    env, tmp_path_factory, writer, via_symlink
):
    """4b: the commit lands after the upload's WAL checkpoint, so the uploaded
    bytes lack it. The DB must read dirty (not evictable) until a later upload.
    writer: a TrackedConnection (get_db_connection) or a raw materialization
    connection (_open_profile_db), which has no per-statement write tracking.
    via_symlink: USER_DATA_BASE reached through a symlink, so the paths callers
    build and the resolved paths connections open differ."""
    from app import database
    from app.services import user_db

    if via_symlink:
        link = tmp_path_factory.mktemp("link") / "user_data"
        link.symlink_to(env.base, target_is_directory=True)
        stack = ExitStack()
        stack.enter_context(patch.object(database, "USER_DATA_BASE", link))
        stack.enter_context(patch.object(user_db, "USER_DATA_BASE", link))
    else:
        stack = ExitStack()
    with stack:
        _commit_between_checkpoint_and_mark(env, tmp_path_factory, writer)


def _commit_between_checkpoint_and_mark(env, tmp_path_factory, writer):
    from app import database, storage
    from app.services.materialization import _open_profile_db

    user = env.new_user()
    _seed(user, {"p1": ["a"]})
    path = _profile_path(env.base, user, "p1")
    real_checkpoint = storage._checkpoint_wal_or_refuse
    late = ExitStack()

    def checkpoint_then_commit(*args, **kwargs):
        ok = real_checkpoint(*args, **kwargs)
        if writer == "tracked":
            conn = late.enter_context(database.get_db_connection())
        else:
            conn = _open_profile_db(user, "p1")
            late.callback(conn.close)
        conn.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('late', '16:9')")
        conn.commit()
        return ok

    _set_context(user, "p1")
    with late:
        with patch.object(storage, "_checkpoint_wal_or_refuse", checkpoint_then_commit):
            _sync_profile(user, "p1")
        assert _r2_rows(env.fake, user, "p1", tmp_path_factory.mktemp("r2")) == ["a"], "premise"
        # The path as the app builds it (through the symlink in that variant).
        key = storage._db_key(database.get_user_data_path_explicit(user, "p1") / "profile.sqlite")
        mark = storage._DB_CLEAN_MARKS.get(key)
        seq = storage._DB_WRITE_SEQ.get(key, 0)
        assert mark is None or mark[1] != seq, "the late commit is not in R2 but the DB reads clean"
        _evict()
        assert path.exists()

    _evict()
    assert path.exists(), "still dirty after the connection closed"
    _sync_profile(user, "p1")
    _evict()
    assert not path.exists()


def test_evict_pass_racing_a_request_never_serves_or_uploads_less(env, tmp_path_factory):
    """4a: an evict pass and a request on the same user, released together by a
    barrier, many times. Reads always see every row; R2 never loses one."""
    user = env.new_user()
    _seed(user, {"p1": ["r0"]})
    scratch = tmp_path_factory.mktemp("r2")
    iterations = 40
    barrier = threading.Barrier(2)
    failures: list[str] = []
    evictions = [0]
    # Seeded jitter on both sides varies who reaches the user first; without it
    # the request always takes its hold before the pass finishes sizing.
    jitter = random.Random(14370)
    delays = [(jitter.uniform(0, 0.004), jitter.uniform(0, 0.004)) for _ in range(iterations)]

    def request_side():
        expected = ["r0"]
        for i in range(iterations):
            barrier.wait()
            time.sleep(delays[i][0])
            try:
                seen = _read_projects(user, "p1")
                if seen != sorted(expected):
                    failures.append(f"iter {i}: request saw {seen}, expected {sorted(expected)}")
                if i % 4 == 0:
                    _write_projects(user, "p1", [f"r{i + 1}"])
                    expected.append(f"r{i + 1}")
                    _sync_profile(user, "p1")
                    in_r2 = _r2_rows(env.fake, user, "p1", scratch)
                    if in_r2 != sorted(expected):
                        failures.append(f"iter {i}: R2 holds {in_r2}, expected {sorted(expected)}")
            except Exception as e:  # surfaced below, never swallowed
                failures.append(f"iter {i}: {type(e).__name__}: {e}")

    def evict_side():
        for i in range(iterations):
            barrier.wait()
            time.sleep(delays[i][1])
            report = _evict()
            if report is not None:
                evictions[0] += len(report.evicted)

    threads = [threading.Thread(target=request_side), threading.Thread(target=evict_side)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=120)
    assert not failures, "\n".join(failures)
    assert evictions[0] > 0, "the race never evicted, so it proved nothing"


def test_evicted_user_repulls_every_db_through_the_jit_seam(env):
    """4c: user.sqlite and every profile come back from R2, through the seam."""
    from app import migrations
    from app.services import user_db

    user = env.new_user()
    rows = {"p1": ["a", "b"], "p2": ["c"]}
    _seed(user, rows)
    _evict()
    assert _db_files(env.base, user) == [], "the user must be evicted first"

    with patch.object(migrations, "run_user_seam", wraps=migrations.run_user_seam) as user_seam, \
         patch.object(migrations, "run_profile_seam", wraps=migrations.run_profile_seam) as profile_seam:
        assert sorted(p["id"] for p in user_db.get_profiles(user)) == ["p1", "p2"]
        for pid, names in rows.items():
            assert _read_projects(user, pid) == names
    user_seam.assert_any_call(user)
    for pid in rows:
        profile_seam.assert_any_call(user, pid)


# --------------------------------------------------------------------------- bound

N_USERS = 2_500
PROFILES_PER_USER = 4  # 10,000 profiles
ROUNDS = 12
TOUCHES_PER_ROUND = 1_500


def _template_db(path: Path) -> bytes:
    conn = sqlite3.connect(path)
    conn.execute("PRAGMA page_size=512")
    conn.execute("CREATE TABLE t (x)")
    conn.execute("INSERT INTO t VALUES (1)")
    conn.commit()
    conn.close()
    return path.read_bytes()


def _disk_bytes(base: Path) -> int:
    return sum(p.stat().st_size for p in base.rglob("*.sqlite*"))


def test_disk_stays_bounded_under_zipf_touches_of_10k_profiles(env, tmp_path_factory):
    from app import storage

    base = env.base
    template = _template_db(tmp_path_factory.mktemp("tpl") / "t.sqlite")
    users = [f"zipf{i:05d}" for i in range(N_USERS)]

    def materialize(u):
        """A restore: the user's files land and match R2 (clean marks)."""
        files = [base / u / "user.sqlite"] + [
            base / u / "profiles" / f"p{j}" / "profile.sqlite" for j in range(PROFILES_PER_USER)
        ]
        for f in files:
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_bytes(template)
            storage.commit_db_clean_mark(f, storage.capture_db_clean_mark(f))
        _touch(u)

    for u in users:
        materialize(u)
    total = _disk_bytes(base)
    high_water = total // 4

    rng = random.Random(14370)
    protected = rng.sample(users, 60)
    held, marked, dirty = protected[:20], protected[20:40], protected[40:]
    pins = ExitStack()
    for u in held:
        pins.enter_context(_hold(u))
    for u in marked:
        (base / u / ".sync_pending.p0").write_text("{}")
    for u in dirty:
        storage.note_db_write(base / u / "profiles" / "p0" / "profile.sqlite")

    weights = [1 / (k + 1) ** 1.1 for k in range(N_USERS)]
    ranked = users[:]
    rng.shuffle(ranked)
    try:
        for rnd in range(ROUNDS):
            for u in rng.choices(ranked, weights=weights, k=TOUCHES_PER_ROUND):
                if not (base / u / "user.sqlite").exists():
                    materialize(u)
                else:
                    _touch(u)
            _evict(high_water)
            used = _disk_bytes(base)
            assert used <= high_water, f"round {rnd}: {used} bytes > high water {high_water}"
            for u in protected:
                assert len(_db_files(base, u)) == 1 + PROFILES_PER_USER, f"round {rnd}: evicted protected {u}"
    finally:
        pins.close()


# --------------------------------------------------------------------------- loop

def test_eviction_loop_runs_on_its_own_single_worker_executor():
    r = _residency()
    assert r is not None and hasattr(r, "start_db_eviction_loop"), "no eviction loop exists"

    lifespan = ast.unparse(ast.parse((APP_DIR / "main.py").read_text(encoding="utf-8")))
    assert "start_db_eviction_loop(" in lifespan and "stop_db_eviction_loop(" in lifespan

    names: list[str] = []
    default_pool_calls: list = []
    ran = threading.Event()

    class RecordingPool(ThreadPoolExecutor):
        def submit(self, fn, /, *args, **kwargs):
            default_pool_calls.append(fn)
            return super().submit(fn, *args, **kwargs)

    def fake_pass(high_water, **kwargs):
        names.append(threading.current_thread().name)
        ran.set()

    async def run():
        asyncio.get_running_loop().set_default_executor(RecordingPool(max_workers=4))
        r.start_db_eviction_loop(high_water=1, interval_s=0.01)
        for _ in range(300):
            if ran.is_set():
                break
            await asyncio.sleep(0.01)
        await r.stop_db_eviction_loop()

    with patch.object(r, "run_eviction_pass", fake_pass):
        asyncio.run(run())

    assert names, "the loop never ran a pass"
    assert all(n.startswith("db-evict") for n in names), names
    assert not default_pool_calls, "an eviction pass used the shared default executor"
    assert r._EVICTION_EXECUTOR._max_workers == 1


def test_high_water_is_required_or_eviction_stays_off(monkeypatch, caplog):
    r = _residency()
    assert r is not None, "no eviction loop exists"
    from app import database

    monkeypatch.delenv("DB_CACHE_HIGH_WATER_BYTES", raising=False)
    monkeypatch.setattr(database, "R2_ENABLED", True)
    caplog.set_level(logging.INFO)
    assert r.high_water_from_env() is None
    assert any(rec.levelno == logging.ERROR and "DB_CACHE_HIGH_WATER_BYTES" in rec.getMessage()
               for rec in caplog.records)
    monkeypatch.setenv("DB_CACHE_HIGH_WATER_BYTES", "2147483648")
    assert r.high_water_from_env() == 2147483648


# --------------------------------------------------------------------------- consumers

def test_sweep_phase2_pins_its_holders(env):
    from app import database, storage
    from app.services import sweep_scheduler

    user = env.new_user()
    path = _profile_path(env.base, user, "p")
    path.parent.mkdir(parents=True)
    path.write_bytes(_template_db(env.base / "template.sqlite"))
    storage.commit_db_clean_mark(path, storage.capture_db_clean_mark(path))
    _touch(user)
    h = "h" * 64

    def gate_with_eviction(blake3_hash, profiles):
        _evict()
        return True  # defer: this test is about residency, not the delete

    with patch.object(database, "R2_ENABLED", True), \
         patch(f"{M}.get_expiring_ref_profiles", return_value=[]), \
         patch(f"{M}.get_expired_grace_deletions", return_value=[h]), \
         patch(f"{M}.get_grace_queued_by", return_value=(user, "p")), \
         patch(f"{M}.get_ref_holders", return_value=[]), \
         patch(f"{M}._count_refs_in_profiles", return_value=(0, 0, True)), \
         patch(f"{M}._phase2_artifact_gate_missing", side_effect=gate_with_eviction), \
         patch(f"{M}.r2_delete_object_global") as r2_delete:
        sweep_scheduler.do_sweep()

    r2_delete.assert_not_called()
    assert path.exists(), "an eviction pass during Phase 2 removed a pinned holder"
    _evict()
    assert not path.exists(), "control: the same user is evictable once Phase 2 is done"


@pytest.mark.asyncio
async def test_privacy_export_reads_a_profile_that_is_not_cached(env, monkeypatch):
    """After a deploy (or an eviction) a profile lives only in R2. The export
    must still include its rows (CCPA right-to-know)."""
    import json
    from unittest.mock import MagicMock

    from app import database
    from app.routers.privacy import export_user_data

    user = env.new_user()
    _seed(user, {"p1": ["kept in r2"]})
    for suffix in ("", "-wal", "-shm"):
        Path(str(_profile_path(env.base, user, "p1")) + suffix).unlink(missing_ok=True)
    database.forget_local_db_state(user)

    monkeypatch.setattr("app.routers.privacy.get_user_by_id", lambda uid: None)
    monkeypatch.setattr("app.routers.privacy.R2_ENABLED", False)
    _set_context(user, "p1")
    payload = json.loads((await export_user_data(MagicMock())).body)

    profiles = {p["profile_id"]: p for p in payload["profiles"]}
    assert "p1" in profiles
    assert [p["name"] for p in profiles["p1"]["projects"]] == ["kept in r2"]
