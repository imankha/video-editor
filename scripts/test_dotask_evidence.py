"""dotask_evidence.py against a temp git checkout + fake qa/proof.json (no model calls)."""
import contextlib
import hashlib
import io
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

import dotask_evidence as evidence


def git(repo, *args):
    subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True)


class BuildEvidence(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.origin = self.root / "origin.git"
        self.checkout = self.root / "checkout"
        self.out = self.root / "evidence-out"
        git(self.root, "init", "-q", "--bare", str(self.origin))
        git(self.root, "clone", "-q", str(self.origin), str(self.checkout))
        git(self.checkout, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "--allow-empty", "-qm", "base")
        git(self.checkout, "push", "-q", "origin", "HEAD:master")
        git(self.checkout, "checkout", "-q", "-b", "feature/T1234-x")

    def write_proof(self, **extra):
        qa = self.checkout / "qa"
        qa.mkdir(exist_ok=True)
        test_path = qa / "test_x.py"
        test_path.write_text("def test_x():\n    assert True\n")
        red = qa / "red-test_x.log"
        red.write_text("FAILED test_x - AssertionError: expected True\n")
        green = qa / "green-test_x.log"
        green.write_text("1 passed\n")
        proof = {
            "task_ids": ["T1234"],
            "criteria": [{"id": "T1234:C1", "description": "does the thing",
                         "artifacts": ["test", "red", "green"]}],
            "artifacts": {
                "test": {"path": "qa/test_x.py", "sha256": hashlib.sha256(test_path.read_bytes()).hexdigest()},
                "red": {"path": "qa/red-test_x.log"},
                "green": {"path": "qa/green-test_x.log"},
            },
            "tests": [{"criteria": ["T1234:C1"], "test": "test", "red_log": "red", "green_log": "green",
                      "red_exit": 1, "green_exit": 0, "red_reason": "AssertionError: expected True"}],
            "human_checks": [],
            **extra,
        }
        (qa / "proof.json").write_text(json.dumps(proof))
        git(self.checkout, "add", "qa")
        git(self.checkout, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "T1234: qa evidence")
        return proof, test_path

    def run_build(self):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = evidence.main([str(self.checkout), "--pr", "7", "--out", str(self.out)])
        return code, buf.getvalue()

    def rev_parse(self, ref):
        return subprocess.run(["git", "-C", str(self.checkout), "rev-parse", ref],
                              capture_output=True, text=True, check=True).stdout.strip()

    def test_builds_a_gate_valid_evidence_json(self):
        self.write_proof()
        code, _ = self.run_build()
        self.assertEqual(code, 0)
        doc = json.loads((self.out / "evidence.json").read_text())
        self.assertEqual(doc["schema_version"], 1)
        self.assertEqual(doc["repo"], "imankha/video-editor")
        self.assertEqual(doc["pr"], 7)
        self.assertEqual(doc["mode"], "behavioral")
        self.assertEqual(doc["task_ids"], ["T1234"])
        self.assertEqual(doc["base"], self.rev_parse("origin/master"))
        self.assertEqual(doc["head"], self.rev_parse("HEAD"))
        self.assertEqual(doc["criteria"][0]["id"], "T1234:C1")
        test = doc["tests"][0]
        self.assertEqual((test["before"], test["after"]), (doc["base"], doc["head"]))
        self.assertEqual(test["same_test_hash"], doc["artifacts"]["test"]["sha256"])
        for item in doc["artifacts"].values():
            self.assertTrue((self.out / item["path"]).is_file())
            self.assertEqual(hashlib.sha256((self.out / item["path"]).read_bytes()).hexdigest(), item["sha256"])

    def test_refuses_when_recorded_test_hash_differs_from_head(self):
        _, test_path = self.write_proof()
        # Mutate the test file AFTER the recorded sha256 was computed (simulates a changed
        # proof test between red/green capture and the evidence build at HEAD).
        test_path.write_text("def test_x():\n    assert False  # mutated\n")
        git(self.checkout, "add", "qa")
        git(self.checkout, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "T1234: mutate test")
        code, _ = self.run_build()
        self.assertEqual(code, 2)
        self.assertFalse((self.out / "evidence.json").exists())

    def test_refuses_with_no_proof_json(self):
        buf = io.StringIO()
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(buf):
            code = evidence.main([str(self.checkout), "--pr", "7", "--out", str(self.out)])
        self.assertEqual(code, 2)
        self.assertIn("proof.json", buf.getvalue())

    def test_finds_proof_under_frontend_qa_dir(self):
        qa = self.checkout / "src" / "frontend" / "qa"
        qa.mkdir(parents=True)
        test_path = qa / "test_y.js"
        test_path.write_text("test('y', () => {})\n")
        (qa / "red-y.log").write_text("red\n")
        (qa / "green-y.log").write_text("green\n")
        proof = {"task_ids": ["T1234"],
                 "criteria": [{"id": "T1234:C1", "description": "d", "artifacts": ["test", "red", "green"]}],
                 "artifacts": {"test": {"path": "src/frontend/qa/test_y.js"},
                              "red": {"path": "src/frontend/qa/red-y.log"},
                              "green": {"path": "src/frontend/qa/green-y.log"}},
                 "tests": [{"criteria": ["T1234:C1"], "test": "test", "red_log": "red", "green_log": "green",
                           "red_exit": 1, "green_exit": 0, "red_reason": "r"}],
                 "human_checks": []}
        (qa / "proof.json").write_text(json.dumps(proof))
        git(self.checkout, "add", "src")
        git(self.checkout, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "T1234: frontend qa")
        code, _ = self.run_build()
        self.assertEqual(code, 0)
        self.assertTrue((self.out / "src/frontend/qa/test_y.js").is_file())


if __name__ == "__main__":
    unittest.main()
