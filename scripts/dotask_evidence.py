"""Build a landing-gate evidence.json from a worker checkout's qa/proof.json.

Usage:
    python scripts/dotask_evidence.py <checkout> --pr N --out <dir>

qa/proof.json schema (written by the QA-phase worker; searched at <checkout>/qa/proof.json
and <checkout>/src/frontend/qa/proof.json, first match wins):
{
  "mode": "behavioral" | "documentation",            # optional, default "behavioral"
  "task_ids": ["T1234"],                              # optional; else derived from criteria prefixes
  "criteria": [{"id": "T1234:C1", "description": "...", "artifacts": ["test1", "red1", "green1"]}],
  "artifacts": {
    "test1": {"path": "qa/test_x.py", "sha256": "<hex, optional>"},
    "red1": {"path": "qa/red-test_x.log"},
    "green1": {"path": "qa/green-test_x.log"}
  },
  "tests": [{"criteria": ["T1234:C1"], "test": "test1", "red_log": "red1", "green_log": "green1",
             "red_exit": 1, "green_exit": 0, "red_reason": "AssertionError: ..."}],
  "human_checks": []
}

Artifact paths are relative to <checkout>. Any artifact that recorded a sha256 (typically the
proof test file, hashed by the worker when it ran red/green) is re-hashed now; a mismatch
refuses evidence-building outright -- the test must be unchanged between red and green AND at
HEAD, which this script enforces independently of the worker's own claim. Logs and other
artifacts without a recorded hash are simply hashed and stamped into evidence.json.
"""
import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

REPO = "imankha/video-editor"
QA_CANDIDATES = ("qa/proof.json", "src/frontend/qa/proof.json")


def sha256_of(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def find_proof(checkout):
    for candidate in QA_CANDIDATES:
        path = checkout / candidate
        if path.is_file():
            return path
    raise ValueError(f"no qa/proof.json found under {checkout} (looked in {', '.join(QA_CANDIDATES)})")


def git_output(checkout, *args):
    result = subprocess.run(["git", "-C", str(checkout), *args], capture_output=True, text=True, timeout=60, check=False)
    if result.returncode:
        raise ValueError(f"git {' '.join(args)} failed: {result.stderr.strip()}")
    return result.stdout.strip()


def revisions(checkout):
    git_output(checkout, "fetch", "origin", "master")
    head = git_output(checkout, "rev-parse", "HEAD")
    base = git_output(checkout, "merge-base", "HEAD", "origin/master")
    return base, head


def resolve_artifacts(proof, checkout):
    """Verify each artifact exists and matches any recorded sha256; return {key: (path, sha256)}."""
    resolved = {}
    for key, item in proof.get("artifacts", {}).items():
        rel = item["path"]
        if Path(rel).is_absolute():
            raise ValueError(f"artifact {key!r} path must be relative: {rel}")
        path = (checkout / rel).resolve()
        if not path.is_relative_to(checkout.resolve()) or not path.is_file():
            raise ValueError(f"artifact {key!r} missing or escapes checkout: {rel}")
        actual = sha256_of(path)
        recorded = item.get("sha256")
        if recorded and recorded != actual:
            raise ValueError(f"artifact {key!r} ({rel}) sha256 changed: recorded {recorded}, now {actual} "
                              "(the test must be unchanged between red/green runs and at HEAD)")
        resolved[key] = (rel, actual)
    if not resolved:
        raise ValueError("qa/proof.json lists no artifacts")
    return resolved


def task_ids_of(proof):
    if proof.get("task_ids"):
        return proof["task_ids"]
    ids = []
    for item in proof.get("criteria", []):
        prefix = item["id"].split(":", 1)[0] if ":" in item.get("id", "") else None
        if prefix and re.fullmatch(r"T\d+", prefix) and prefix not in ids:
            ids.append(prefix)
    if not ids:
        raise ValueError("no task_ids given and none derivable from namespaced criteria ids (T1234:C1)")
    return ids


def build_evidence(proof, checkout, pr, base, head):
    artifacts = resolve_artifacts(proof, checkout)
    criteria = proof.get("criteria", [])
    if not criteria:
        raise ValueError("qa/proof.json lists no criteria")
    tests = []
    for test in proof.get("tests", []):
        key = test["test"]
        if key not in artifacts:
            raise ValueError(f"test entry references unknown artifact {key!r}")
        tests.append({**test, "before": base, "after": head, "same_test_hash": artifacts[key][1]})
    return {
        "schema_version": 1, "repo": REPO, "pr": pr, "base": base, "head": head,
        "mode": proof.get("mode", "behavioral"), "task_ids": task_ids_of(proof),
        "criteria": criteria,
        "artifacts": {key: {"path": rel, "sha256": digest} for key, (rel, digest) in artifacts.items()},
        "tests": tests, "human_checks": proof.get("human_checks", []),
    }


def write_evidence(checkout, pr, out):
    proof_path = find_proof(checkout)
    proof = json.loads(proof_path.read_text(encoding="utf-8"))
    base, head = revisions(checkout)
    evidence = build_evidence(proof, checkout, pr, base, head)
    out.mkdir(parents=True, exist_ok=True)
    for item in evidence["artifacts"].values():
        dest = out / item["path"]
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(checkout / item["path"], dest)
    (out / "evidence.json").write_text(json.dumps(evidence, indent=2, sort_keys=True), encoding="utf-8")
    return evidence


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("checkout")
    parser.add_argument("--pr", type=int, required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args(argv)
    try:
        evidence = write_evidence(Path(args.checkout).resolve(), args.pr, Path(args.out))
    except ValueError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    print(json.dumps({"evidence": str(Path(args.out) / "evidence.json"),
                      "task_ids": evidence["task_ids"], "criteria": [c["id"] for c in evidence["criteria"]]}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
