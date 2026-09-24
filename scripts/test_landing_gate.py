"""Adversarial acceptance cases for the supervised landing decision."""
import copy
import contextlib
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
import uuid
from types import SimpleNamespace
from unittest.mock import patch
import landing_gate as gate

BASE, HEAD = 'a' * 40, 'b' * 40


class DecisionTests(unittest.TestCase):
    def setUp(self):
        self.e = {'schema_version': 1, 'repo': 'owner/repo', 'pr': 12, 'base': BASE, 'head': HEAD,
                  'mode': 'behavioral', 'criteria': [{'id': 'C1', 'description': 'Correct output', 'artifacts': ['test','red','green']}],
                  'tests': [{'criteria': ['C1'], 'test': 'test', 'red_log': 'red', 'green_log': 'green',
                    'before': BASE, 'after': HEAD, 'red_exit': 1, 'green_exit': 0,
                    'red_reason': 'Expected assertion: wrong output', 'same_test_hash': 'd'*64}],
                  'artifacts': {name: {'path': name+'.txt', 'sha256': 'd'*64} for name in ['test','red','green']},
                  'human_checks': []}
        self.proof = {'verdict': 'VERIFIED', 'independently_reproduced': True, 'criteria_verified': ['C1'],
                      'blocking': 0, 'major': 0, 'session_id': 'proof-session'}
        self.review = {'verdict': 'APPROVED', 'blocking': 0, 'major': 0, 'session_id': 'review-session'}
        self.pr = {'number': 12, 'state': 'open', 'head': {'sha': HEAD, 'repo': {'full_name': 'owner/repo'}},
                   'base': {'sha': BASE, 'ref': 'master', 'repo': {'full_name': 'owner/repo'}}, 'mergeable': True, 'draft': False}
        self.run = {'head_sha': HEAD, 'event': 'push', 'path': '.github/workflows/branch-ci.yml',
                    'status': 'completed', 'conclusion': 'success', 'repository': {'full_name': 'owner/repo'}}
        self.jobs = [{'name': name, 'status': 'completed', 'conclusion': 'success'} for name in ['changes', 'tooling', 'ci-ready']]

    def check(self):
        return gate.evaluate(self.e,self.proof,self.review,self.pr,self.run,self.jobs,{'tooling'})

    def test_complete_current_evidence_is_eligible(self):
        self.assertEqual(self.check(), [])

    def test_stale_head_and_base_block(self):
        for field in ['head','base']:
            with self.subTest(field=field):
                original = self.pr[field]['sha']
                self.pr[field]['sha'] = 'c'*40
                self.assertTrue(self.check())
                self.pr[field]['sha'] = original

    def test_other_sha_or_workflow_success_is_not_evidence(self):
        self.run['head_sha'] = 'c'*40
        self.assertTrue(self.check())
        self.run['head_sha'] = HEAD
        self.run['path'] = '.github/workflows/fake.yml'
        self.assertTrue(self.check())

    def test_missing_cancelled_skipped_and_failed_required_checks_block(self):
        for conclusion in ['cancelled','skipped','failure',None]:
            self.jobs[1]['conclusion'] = conclusion
            self.assertTrue(self.check())
        self.jobs.pop(1)
        self.assertTrue(self.check())

    def test_absent_or_insufficient_proof_blocks(self):
        for proof in [{}, dict(self.proof, verdict='MORE_PROOF_REQUIRED'), dict(self.proof, independently_reproduced=False)]:
            self.proof = proof
            self.assertTrue(self.check())

    def test_unresolved_review_or_same_session_blocks(self):
        self.review['major'] = 1
        self.assertTrue(self.check())
        self.review['major'] = 0
        self.review['session_id'] = self.proof['session_id']
        self.assertTrue(self.check())

    def test_green_only_or_different_test_is_not_redgreen(self):
        self.e['tests'][0]['red_exit'] = 0
        self.assertTrue(self.check())
        self.e['tests'][0]['red_exit'] = 1
        self.e['tests'][0]['same_test_hash'] = 'e'*64
        self.assertTrue(self.check())

    def test_uncovered_criterion_and_unresolved_human_check_block(self):
        self.e['criteria'].append({'id':'C2','description':'Other result','artifacts':['test']})
        self.assertTrue(self.check())
        self.e['criteria'].pop()
        self.e['human_checks'] = ['Visual correctness']
        self.assertTrue(self.check())

    def test_wrong_repository_and_draft_block(self):
        self.pr['head']['repo']['full_name'] = 'someone/else'
        self.assertTrue(self.check())
        self.pr['head']['repo']['full_name'] = 'owner/repo'
        self.pr['draft'] = True
        self.assertTrue(self.check())


class BoundaryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.checkout = self.root/'candidate'
        self.checkout.mkdir()
        self.evidence_root = self.root/'evidence'
        self.evidence_root.mkdir()
        def git(*args):
            return subprocess.check_output(['git','-C',str(self.checkout),*args], stderr=subprocess.DEVNULL).decode().strip()
        self.git = git
        git('init')
        git('config','user.name','Fixture')
        git('config','user.email','fixture@example.invalid')
        git('config','core.hooksPath',str(self.root/'no-hooks'))
        source = self.checkout/'src/backend/example.py'
        source.parent.mkdir(parents=True)
        source.write_text('value = 0\n')
        git('add','.')
        git('commit','-m','before')
        base = git('rev-parse','HEAD')
        source.write_text('value = 1\n')
        git('add','.')
        git('commit','-m','after')
        head = git('rev-parse','HEAD')
        fixture = DecisionTests()
        fixture.setUp()
        self.e = fixture.e
        self.e.update(base=base,head=head)
        self.e['tests'][0].update(before=base,after=head)
        for name, artifact in self.e['artifacts'].items():
            path = self.evidence_root/artifact['path']
            path.write_text(name+' evidence\n')
            artifact['sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
        self.e['tests'][0]['same_test_hash'] = self.e['artifacts']['test']['sha256']
        self.controller = 'trusted-controller'
        self.store = gate.Receipts(self.root/'receipts',self.checkout)
        for role, report in [('proof-verifier',fixture.proof),('reviewer',fixture.review)]:
            session = str(uuid.uuid4())
            raw = json.dumps(report).encode()
            report.update(session_id=session,raw_output_sha256=hashlib.sha256(raw).hexdigest())
            self.store.save(role,self.e,report,self.controller)
            (self.store.root/(session+'.json')).write_bytes(raw)
        self.pr = fixture.pr
        self.pr['base']['sha'],self.pr['head']['sha'] = base,head
        self.run = dict(fixture.run,head_sha=head,id=10)
        self.jobs = fixture.jobs + [{'name':'backend','status':'completed','conclusion':'success'}]
        self.routes = gate.ci_policy.manifest(self.checkout,base,head)
        parent = self
        class Transport:
            repo='owner/repo'
            calls=0
            move_head=False
            merges=[]
            def snapshot(self,number,head):
                self.calls+=1
                if self.move_head and self.calls>1:
                    parent.pr['head']['sha']='e'*40
                return parent.pr,parent.run,parent.jobs
            def routing(self,run):
                return parent.routes
            def merge(self,number,head):
                self.merges.append((number,head))
        self.transport=Transport()

    def check(self):
        return gate.check(self.e,self.evidence_root,self.checkout,self.store,self.transport,self.controller)

    def test_valid_boundary_and_land_calls_merge_once_with_exact_head(self):
        self.assertTrue(self.check()['eligible'])
        result=gate.land(self.e,self.evidence_root,self.checkout,self.store,self.transport,self.controller)
        self.assertTrue(result['merged'])
        self.assertEqual(self.transport.merges,[(12,self.e['head'])])

    def test_changed_head_between_checks_does_not_merge(self):
        self.transport.move_head=True
        with self.assertRaisesRegex(ValueError,'head changed'):
            gate.land(self.e,self.evidence_root,self.checkout,self.store,self.transport,self.controller)
        self.assertEqual(self.transport.merges,[])

    def test_tampered_artifact_or_traversal_is_rejected(self):
        (self.evidence_root/'red.txt').write_text('changed')
        with self.assertRaisesRegex(ValueError,'changed artifact'):
            self.check()
        self.e['artifacts']['test']['path']='../outside'
        with self.assertRaisesRegex(ValueError,'escapes'):
            gate.artifact_paths(self.e,self.evidence_root)

    def test_forged_receipt_and_changed_captured_output_rejected(self):
        path=self.store.root/gate.digest(self.e)/'proof-verifier.json'
        record=gate.load(path)
        rawpath=self.store.root/(record['payload']['report']['session_id']+'.json')
        rawpath.write_text('changed')
        with self.assertRaisesRegex(ValueError,'output changed'):
            self.check()
        record['payload']['report']['verdict']='APPROVED'
        path.write_text(json.dumps(record))
        with self.assertRaisesRegex(ValueError,'Untrusted'):
            self.check()

    def test_worker_authored_approval_and_store_in_checkout_rejected(self):
        with self.assertRaisesRegex(ValueError,'outside'):
            gate.Receipts(self.checkout/'store',self.checkout)
        (self.store.root/gate.digest(self.e)/'proof-verifier.json').unlink()
        self.e['proof_verifier']={'verdict':'VERIFIED'}
        with self.assertRaises(OSError):
            self.check()

    def test_weakened_ci_manifest_and_dirty_checkout_rejected(self):
        self.routes['required_jobs']=['tooling']
        with self.assertRaisesRegex(ValueError,'routing mismatch'):
            self.check()
        (self.checkout/'untracked.txt').write_text('not reviewed')
        with self.assertRaisesRegex(ValueError,'must be clean'):
            self.check()

    def test_capture_launches_fresh_session_and_signs_observed_output(self):
        evidence_path=self.evidence_root/'evidence.json'
        evidence_path.write_text(json.dumps(self.e))
        args=SimpleNamespace(evidence=evidence_path,checkout=self.checkout,role='proof-verifier')
        real_run=subprocess.run
        def cli(command,**kwargs):
            if command[0]!='claude':
                return real_run(command,**kwargs)
            self.assertNotIn('--continue',command)
            self.assertNotIn('--resume',command)
            session=command[command.index('--session-id')+1]
            report={'verdict':'VERIFIED','blocking':0,'major':0,'independently_reproduced':True,
                    'criteria_verified':['C1'],'policy_changes_approved':False,'summary':'Fixture proof'}
            return SimpleNamespace(returncode=0,stdout=json.dumps({'session_id':session,'structured_output':report,'is_error':False}, indent=2)+'\n')
        with patch.object(gate.subprocess,'run',side_effect=cli), patch.object(gate,'controller_digest',return_value=self.controller), contextlib.redirect_stdout(io.StringIO()):
            gate.capture(args,self.e,self.store,self.controller)
        self.assertEqual(self.store.read('proof-verifier',self.e,self.controller)['verdict'],'VERIFIED')

    def test_failed_capture_cannot_create_receipt(self):
        path=self.store.root/gate.digest(self.e)/'proof-verifier.json'
        path.unlink()
        evidence_path=self.evidence_root/'evidence.json'
        evidence_path.write_text(json.dumps(self.e))
        args=SimpleNamespace(evidence=evidence_path,checkout=self.checkout,role='proof-verifier')
        real_run=subprocess.run
        def cli(command,**kwargs):
            return SimpleNamespace(returncode=1) if command[0]=='claude' else real_run(command,**kwargs)
        with patch.object(gate.subprocess,'run',side_effect=cli), self.assertRaisesRegex(ValueError,'no receipt'):
            gate.capture(args,self.e,self.store,self.controller)
        self.assertFalse(path.exists())


if __name__ == '__main__':
    unittest.main()
