"""pytest plugin for Master CI's testmon baseline run (T13961). Load with `-p testmon_baseline_plugin`.

Two jobs, both closing gaps T13960 measured in a plain `pytest --testmon` baseline:
1. Never restart coverage mid-run. testmon restarts it every TEST_BATCH_SIZE (250) tests and the
   new collector only traces current/later threads, so a module-scoped TestClient loses its endpoint
   coverage after a boundary. We raise the batch size and fail loudly if the knob is gone.
2. Record which test FILES ran code testmon cannot see (a ProcessPoolExecutor job, a fork, a
   spawned process). Branch CI always re-runs those files (always_run.json).
Standard library only at import time so the harness test runs without testmon installed.
"""
import json
import os
from pathlib import Path
import subprocess

UNLIMITED = 2 ** 62
ALWAYS_RUN_ENV = 'TESTMON_ALWAYS_RUN_JSON'


def raise_batch_size(core):
    if not hasattr(core, 'TEST_BATCH_SIZE'):
        raise RuntimeError('testmon.testmon_core.TEST_BATCH_SIZE is gone (testmon upgrade?): the baseline '
                           'would restart coverage mid-run. Update scripts/testmon_baseline_plugin.py.')
    core.TEST_BATCH_SIZE = UNLIMITED


class SpawnRecorder:
    """Patches the process-creating entry points and credits each call to the running test's file."""

    def __init__(self):
        self.files = {}
        self._current = None
        self._originals = []

    def set_current(self, nodeid):
        self._current = nodeid.split('::')[0] if nodeid else None

    def _record(self, kind):
        if self._current:
            self.files.setdefault(self._current, set()).add(kind)

    def _wrap(self, owner, name, kind):
        original = owner.__dict__[name]
        recorder = self

        def wrapper(*args, **kwargs):
            recorder._record(kind)
            return original(*args, **kwargs)

        wrapper.__wrapped__ = original
        self._originals.append((owner, name, original))
        setattr(owner, name, wrapper)

    def install(self):
        from concurrent.futures import ProcessPoolExecutor
        self._wrap(ProcessPoolExecutor, 'submit', 'ProcessPoolExecutor.submit')
        self._wrap(subprocess.Popen, '__init__', 'subprocess.Popen')
        recorder = self
        for name in ('fork', 'posix_spawn', 'posix_spawnp'):
            if hasattr(os, name):
                original = getattr(os, name)

                def wrapper(*args, _recorder=recorder, _original=original, _kind='os.' + name, **kwargs):
                    _recorder._record(_kind)
                    return _original(*args, **kwargs)

                self._originals.append((os, name, original))
                setattr(os, name, wrapper)

    def uninstall(self):
        while self._originals:
            owner, name, original = self._originals.pop()
            setattr(owner, name, original)

    def write(self, path):
        Path(path).write_text(json.dumps(sorted(self.files), indent=2) + '\n', encoding='utf-8')


_recorder = SpawnRecorder()


def pytest_addoption(parser):
    parser.addoption('--always-run-json', default=os.environ.get(ALWAYS_RUN_ENV),
                     help='write the test files that spawned processes to this path (T13961)')


def pytest_configure(config):
    from testmon import testmon_core
    raise_batch_size(testmon_core)
    _recorder.install()


def pytest_runtest_setup(item):
    _recorder.set_current(item.nodeid)


def pytest_runtest_teardown(item, nextitem):
    # Fixture teardown still belongs to this test; clear only once the next one starts.
    if nextitem is None:
        _recorder.set_current(None)


def pytest_sessionfinish(session, exitstatus):
    _recorder.uninstall()
    path = session.config.getoption('--always-run-json')
    if path:
        _recorder.write(path)
