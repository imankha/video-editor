"""Adversarial acceptance cases for the supervised landing decision."""
import copy
import unittest
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


if __name__ == '__main__':
    unittest.main()
