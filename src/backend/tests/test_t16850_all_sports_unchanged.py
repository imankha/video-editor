"""T16850:C3 "All sports" (no sport param) gives every section the numbers it gives today.

Characterization: seed the T16850 fixture (two hockey, one lacrosse, one no-sport arrival
with payments and upload failures), then read every section this task gave a `sport`
param with NO sport, once on this revision (in-process) and once on the revision before
the task (BASE_REV, its src/backend/app exported by git archive and run as a subprocess against the same
Postgres), and require identical responses. Keys this task added beside the numbers
(`sport_applied`) are dropped first. Needs Postgres (pg_conn) and git."""
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from tests.t16850_section_snapshot import snapshot
from tests.test_t16850_sport_every_section import _seed, client  # noqa: F401 -- fixture

# The master commit this task branched from: "today's numbers".
BASE_REV = os.environ.get("T16850_BASE_REV", "ec2358bd9a4c7bc39735f33d6bd24cd70121f080")
BACKEND = Path(__file__).resolve().parent.parent
REPO = BACKEND.parent.parent


@pytest.fixture(scope="module")
def base_backend(tmp_path_factory):
    tree = tmp_path_factory.mktemp("t16850-base")
    archive = subprocess.run(["git", "-C", str(REPO), "archive", BASE_REV, "src/backend/app"],
                             check=True, capture_output=True).stdout
    subprocess.run(["tar", "-x", "-C", str(tree)], input=archive, check=True)
    return tree / "src" / "backend"


def _base_snapshot(base_backend, user_data) -> dict:
    proc = subprocess.run(
        [sys.executable, str(Path(__file__).parent / "t16850_section_snapshot.py"),
         str(base_backend), str(user_data)],
        cwd=base_backend, capture_output=True, text=True, env=os.environ.copy(), timeout=300)
    assert proc.returncode == 0, proc.stderr[-4000:]
    return json.loads(proc.stdout.strip().splitlines()[-1])


def test_all_sports_numbers_match_the_revision_before_the_task(client, base_backend, tmp_path):  # noqa: F811
    _seed()
    base = _base_snapshot(base_backend, tmp_path / "base-user-data")
    head = json.loads(json.dumps(snapshot(client), sort_keys=True, default=str))
    # The seed is visible to both reads (not a vacuous empty-vs-empty match).
    assert head["platforms"]["total_users"] == 4
    assert sum(head["pulse"]["cards"]["signups"]["sparkline"]) == 4
    for section in base:
        assert head[section] == base[section], f"{section}: no-sport response changed"
