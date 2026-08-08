# Session handoff — 2026-08-08 ~06:10 UTC. Supersedes SESSION-HANDOFF-2026-08-07-C.md

**master @ `f4b0f140`.** T5215 and T6630 both merged and banked this session. Only **T5220**
remains in flight. `C:/work/tasks/WAVE.md` is the live source of truth — read it first; this
file adds only what WAVE.md doesn't carry (narrative + landmines).

## 1. Cold-start bootstrap (do this first, ~2k tokens)
1. Read `C:/work/tasks/WAVE.md`.
2. `docker ps --filter name=reel-task` (confirm `reel-task-t5220` is up).
3. Tail `C:/work/tasks/t5220/.dotask-status` + `git -C /c/work/tasks/t5220 log --oneline -5`.

## 2. T5220 (`reel-task-t5220`, :5174/:8001) — implementing, no gate yet
Branch `feature/T5220-intro-egress`. Design doc **approved** at
`docs/plans/tasks/T5220-design.md` (all 3 open questions resolved: Q1 hand-rolled DOM intro on
the edge share page, Q2 public facts-exposure confirmed intended, Q3 owner download keeps
burning in the inherited default). Failing tests written (Stage 3, commit `f5c740b3`).
Implementor has been running since **01:10 UTC** on Scope A-F — as of this handoff still no new
`.dotask-status` line past `IMPLEMENT` (~5h elapsed). Uncommitted work in the container matches
design §8 Commit A (the `ffmpeg_concat.py` extraction from `branded_outro.py`/`player_intro.py`).

**This has run long enough to warrant a status check before doing anything else** — spawn-worker's
own guidance flags ~300 turns without `PUSHREADY` as a stuck-loop signal, not normal. Check
`/tmp/round1-impl.output` in the container for where it actually is before deciding to
wait/nudge/resume-fresh.

Resume pattern (fresh-seed if last activity >~1h old, which it now is):
```
docker exec -d -u dev reel-task-t5220 bash -lc 'cd /workspace && claude -p --model sonnet "Read /workspace/.dotask-kickoff.md and /workspace/.dotask-status. Branch feature/T5220-intro-egress has commits through f5c740b3 plus uncommitted Scope A-F work in progress (the ffmpeg_concat.py extraction, design section 8 Commit A). Continue from there." > /tmp/round2.output 2>&1'
```

Known pre-existing gap noted by the Tester, NOT T5220's to fix: 2 of 4 new backend test files
plus the pre-existing `test_shares.py` are blocked by a dirty `schema_migrations`/
`shares_share_type_check` Postgres state in the container — predates this task.

## 3. T5215 + T6630 — merged, nothing pending
- T5215: merged `9475fe4c` (2026-08-07).
- T6630: merged `7959db42` + fix-forward `f4b0f140` (2026-08-08). Master CI green. Full story
  (3 stale tests + a real migration-numbering merge conflict + one post-merge casualty) is in
  WAVE.md if needed — not repeated here.

## 4. Landmines confirmed AGAIN this session (do not re-derive)
- **Orphaned multiprocessing child holds the backend port after `kill -9` on the uvicorn
  `--reload` parent.** Hit 3+ times restarting T6630's servers. Always verify via the
  `/proc/net/tcp` socket-holder check (readlink `/proc/<pid>/fd/*` against the LISTEN inode)
  before trusting a restart — a stale process with a warm cache can silently keep answering.
- **Auth-token rotation kills workers mid-round** (`Not logged in`). Re-seed BOTH containers'
  credentials from the host's CURRENT `~/.claude/.credentials.json` proactively if either shows
  a byte-size drop, even if only one did.
- **Migration-numbering-trap ripples past the renumber itself.** Renumbering a sibling branch's
  migration is necessary but not sufficient — any OTHER file in ANY branch that hardcodes an
  exact final `PRAGMA user_version` goes stale the instant the new version enters the merged
  registry, and won't show as a merge conflict (the file itself was untouched by either diff).
  Branch CI catches in-branch staleness; Master CI catches the cross-branch rest post-merge.
  Budget for a possible fix-forward pass on master after any migration-adjacent merge.
- One confirmed CI-runner flake this session (R2-async timing on `/watched`) is logged in
  `docs/testing/known-failures.md` with same-SHA-rerun evidence — don't re-investigate it cold.

## 5. Next
No queued task. WIP=1 is satisfied by t5220 alone (room for one more per dotask's WIP=1(max 2)
rule if wanted). Once T5220 reaches `PUSHREADY` or a gate: `task.sh push t5220` → verify the CI
verdict properly (poll + `gh run view`'s actual conclusion, never trust `gh run watch`'s bare
exit code) → report to the user.

**Kickoff prompt for a fresh session:**
> Read docs/plans/tasks/player-intro/SESSION-HANDOFF-2026-08-08.md and continue driving
> reel-task-t5220 (§2). Check WAVE.md + its `.dotask-status` first.
