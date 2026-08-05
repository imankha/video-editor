# T6460 (P0): A merge landed a stale branch commit, dropping the fix that made CI green — and nothing noticed for 4.5 hours

**Status:** TODO
**Priority:** P0
**Impact:** 9 | **Complexity:** 4
**Found:** 2026-08-03/04, while pushing T5190 (Player Intro wave 1)

## What happened (verified facts, not inference)

The `feature/T5830-heal-moved-reel-attribution` branch had two commits:

| SHA | What | Branch CI |
|---|---|---|
| `0a4e3526` | `T5830: heal arshia's pre-T5810 moved reels (profile_db v033)` — the migration | **failure** (01:00) — `test_registry_head_is_audited`: profile_db head moved to v033 while the T6030 structural guard was audited at v032 |
| `55ccaea0` | `T5830: audit the T6030 migration-window guard for head v033` — bumps `HEAD_VERSION_AUDITED` to 33 | **success** (01:02) |

The merge commit `9e0fc91d` ("Merge feature/T5830-heal-moved-reel-attribution into master") has
second parent **`0a4e3526`** — the RED commit. `55ccaea0` **is not an ancestor of master**:

```
git merge-base --is-ancestor 55ccaea0 origin/master   ->  false
git rev-parse 9e0fc91d^2                              ->  0a4e3526
```

So the merge landed the branch at a **stale commit** and silently dropped the very commit that
turned its CI green. The operator saw a green Branch CI at 01:02 and merged something that was not
the commit CI had passed on.

## The blast radius

1. **Master CI was red for ~4.5 hours across 3 commits** — `9e0fc91d` (01:12), `bce639d0` (01:28),
   `2cb761cd` (04:43) — and nobody was told.
2. **Two deploys shipped to staging on top of red master.** `Deploy Backend` and `Deploy Frontend`
   both succeeded at 01:12 for `9e0fc91d`. They trigger on `push: branches: [master]` with **no
   dependency on Master CI whatsoever** (`.github/workflows/deploy-backend.yml:3-19`).
3. **Every branch cut from master inherited the red**, which is how this surfaced: T5190's Branch CI
   failed on a test its diff never touched.
4. **Work was silently redone.** The fix was re-derived and re-landed as `657e3ad3`
   ("T5830: bump the T6030 migration-window audit to v033") — byte-equivalent in intent to the
   dropped `55ccaea0`. Master is green again as of that commit; **the symptom is closed, this task
   is about the mechanism.**

## Why this is P0

The merge gate is **unsound**: "Branch CI is green" was attributed to a commit that was not the
commit merged. That is the same failure class the project already treats as top priority in the
data layer (a write proceeding against a snapshot it did not verify was current — see the T4310
upload-CAS / T4315 restore-if-newer rules), except the clobbered store is the repo itself. A green
check that can describe a different revision than the one landing is worse than no check, because
it is trusted.

Nothing here is exotic or user-specific: any branch whose CI-green tip is pushed shortly before a
merge is exposed, and the failure is silent on both sides.

### Observed again 2026-08-05 — a SECOND mechanism producing the same blind spot

Four Player Intro merges landed in one session. **Three consecutive master SHAs finished with Master
CI `cancelled`, not green** — not because anything failed, but because each was superseded by the
next push before it could finish (concurrency cancellation):

| SHA | Contains | Master CI |
|---|---|---|
| `b2904024` | up to T5210 | success |
| `2a3594a6` | **T5205 merge** | **cancelled** |
| `69d04c30` | docs | **cancelled** |
| `7f890b5e` | docs | first run to actually cover T5205 |

So T5205's merge commit never received a full-suite verdict. It was covered only incidentally, by a
later *documentation* commit that happened to run the suite. Had that docs commit not been pushed,
the last green Master CI would have predated the merge entirely and nobody would have noticed.

This is a distinct mechanism from the original stale-SHA bug but the same end state: **master is
green-looking while no run has actually verified its current tree.** Note Branch CI does not cover
the gap either — T5205 was frontend-only, so its Branch CI legitimately SKIPPED the backend job
(T6405 layer scoping). Master CI was the only thing that would have run the full suite against the
merged tree, and it was cancelled.

Any fix must therefore answer: *which run proves the CURRENT master tree is green?* — and treat
"cancelled" as "no verdict", never as "not failed".

## Scope

Three defects, in priority order. Design should confirm each before building.

### 1. The merge must land the commit CI passed on
- A merge of `feature/T{id}-*` must verify that the merged SHA **is** the branch tip and that this
  exact SHA has a **successful** Branch CI run. Merging a SHA whose CI is red, absent, or attached
  to a different revision must fail loudly.
- Prefer a mechanism that cannot be forgotten: a branch-protection required status check on the
  merged SHA, and/or a `pre-merge`/`pre-push` hook that refuses when
  `git rev-parse <branch>` != the SHA of the green run. Investigate why the operator's local ref
  was stale (fetch ordering) and close that too.
- The `/dotask` supervisor flow already fetches the Branch CI verdict by branch name; it must fetch
  and compare **by SHA** instead, or it can report green for the wrong revision the same way.

### 2. A red Master CI must page someone
- Master CI has no failure notification. Red persisted for 4.5h across 3 commits.
- Cheapest credible fix: a notification step on `master-ci.yml` failure. Decide the channel with the
  user (the repo already has an email service; a GitHub notification setting may be enough).

### 3. Deploy gating — **DECIDED 2026-08-04 (user): alert, do NOT gate**

- Today `Deploy Backend`/`Deploy Frontend` fire on push to master with zero CI dependency, so
  staging can ship from a known-broken master — and did, twice.
- **User decision: keep deploying, but make a failure impossible to miss.** Staging stays fast;
  a red Master CI raises a loud alert instead of passing silently.
- **Rationale (record it, don't re-litigate):** the failure that actually hurt was *nobody knew*,
  not *staging briefly held bad code*. The real protection against untested code reaching master is
  defect 1 above (a merge must land a SHA that is itself CI-green) — with that in place, gating every
  deploy buys little and taxes every single push with a full-suite wait, and a flaky unrelated test
  would block an urgent fix.
- **Revisit trigger:** if broken staging bites during real testing even once after this ships, gating
  becomes the answer. Note that in the implementation so the next reader knows the door is open.
- Whatever ships must not break the **T6220 lockstep invariant** ("bundle build == backend build") —
  the alert path is inert on that front, which is a further point in its favour.

## Explicitly out of scope

- Changing the T6030 structural guard itself. It **worked perfectly** — it caught the un-audited
  migration head on the first CI run. Nothing about this incident argues for weakening it.
- Re-litigating Branch CI's layer scoping (T6405). Not implicated: the red run and the green run
  were different commits, not different layer filters.

## Relevant files
- `.github/workflows/master-ci.yml`, `branch-ci.yml`, `deploy-backend.yml:3-19`, `deploy-frontend.yml`
- `.githooks/` — where a pre-merge/pre-push guard would live (a `post-merge` hook already ships here)
- `.claude/skills/spawn-worker/SKILL.md` § 5 — the supervisor's CI-verdict poll, which queries by
  branch name and must move to SHA
- `src/backend/tests/test_t6030_migration_window_structural_guard.py` — the guard that caught it

## Classification hint
M/L-tier. CI/infra + a hook + a skill edit. No app code, no schema. **Architect gate on defect 3**
(deploy gating changes the user's cadence — do not decide it unilaterally). Reviewer required.

## Acceptance criteria
- [ ] Merging a branch at a SHA that is not its tip, or whose Branch CI is not green **for that
      SHA**, is refused with a clear message.
- [ ] The `/dotask` supervisor CI-verdict step resolves the run **by SHA**, not by branch name.
- [ ] A red Master CI produces a notification the user actually receives.
- [ ] Deploys still fire on push (per the 2026-08-04 decision) and are NOT gated; the T6220 lockstep
      invariant still holds. The revisit trigger is recorded in the implementation.
- [ ] A regression test or a documented drill proves the stale-merge case is now caught.
- [ ] The incident is recorded in `.claude/knowledge/` so the next reader does not re-derive it.
