"""T14110: prod runs on a dedicated CPU and is pinned to exactly one machine.

The app is not safe on more than one machine (in-process locks, version caches,
background loops with no leader election), so the deploy must never create a second
one, and a burst of evening sessions must not drain a shared-vCPU burst quota.
"""
import tomllib
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND.parents[1]


def _vm(name):
    config = tomllib.loads((BACKEND / name).read_text())
    vms = config["vm"]
    assert len(vms) == 1, f"{name} must define exactly one [[vm]]"
    return config, vms[0]


def test_production_vm_is_dedicated_performance_1x_with_4gb():
    _, vm = _vm("fly.production.toml")
    assert vm["cpu_kind"] == "performance"
    assert vm["cpus"] == 1
    assert vm["memory_mb"] == 4096


def test_staging_vm_matches_production():
    _, prod = _vm("fly.production.toml")
    _, staging = _vm("fly.staging.toml")
    assert staging == prod


def test_production_keeps_its_single_machine_running():
    config, _ = _vm("fly.production.toml")
    assert config["http_service"]["min_machines_running"] == 1


def test_production_deploy_never_creates_a_second_machine():
    script = (REPO_ROOT / "scripts" / "deploy_production.sh").read_text()
    deploy = script[script.index("fly deploy --config fly.production.toml"):]
    deploy = deploy[:deploy.index("\n  echo")]
    assert "--ha=false" in deploy
    assert "assert_single_machine" in script
