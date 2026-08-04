# Session handoff — Player Intro epic, 2026-08-04

Written before a conversation compact. Everything here is either **live operational state** (not in
git) or **hard-won knowledge that would cost real time to rediscover**. Settled design decisions are
NOT duplicated here — they live in [EPIC.md](EPIC.md) § Decisions, which is the source of truth.

---

## 1. Where things stand

### Merged to master
| Commit | What |
|---|---|
| `6a7a2934` | Merge **T5180** — rich text engine (TextSpec, 4-font catalogue, `text_render.py`, `RichText.jsx`, parity test) |
| `9696365f` | Merge **T5190** — intro photo upload + parental consent + `position`/`class`/`team` profile facts |
| `657e3ad3` | T5830 fix: bumped `HEAD_VERSION_AUDITED` to 33 (master CI had been red 4.5h) |
| `a0c5d458` | Filed **T6460** (P0) |
| `d297f0d5`, `9c0180fd` | Filed + revised **T6470** |

### In flight (containers alive at time of writing)
| Task | Container | Ports | State |
|---|---|---|---|
| **T5195** card library (schema/CRUD/default) | `reel-task-t5195` | fe 5174, be 8001 | implementing; design gate WAIVED (schema in task file is approved) |
| **T5225** overlay text layer | `reel-task-t5225` | fe 5175, be 8002 | **design gate PASSED + approved 2026-08-04**, now implementing. Design: `docs/plans/tasks/T5225-design.md` |

**T5225 design answers already given (do not re-litigate):** integrate into the live
`OverlayMode.jsx`, leave dead `OverlayTimeline.jsx` alone (separate cleanup task owed); add a
`clip_boundaries` read to `/overlay-data` reusing `poster.py`'s per-clip walk, degrading to `[]`
rather than 500; rasterise at the exact output resolution so neither render loop resizes (mismatch
fails loudly); whole-TextSpec-per-block debounced updates; half-open `start <= t < end` (highlights
stay closed — document the asymmetry, don't change it); pre-rasterise app-side so Modal only needs
`cv2.imdecode` (keeps Pillow out of the Modal image); the no-keyframes copy path gate becomes
`has_keyframes or has_text` (it would otherwise silently drop text — a real bug the worker found).
**The Modal redeploy is the USER's step** — the worker will implement + verify the local path, then
stop and report the deploy as pending. It must not deploy.

Both cloned from master @ `6a7a2934`. Neither has pushed. Drive them with:
```
docker exec -u dev reel-task-<slug> bash -lc 'cd /workspace && CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0 claude -p -c "<instruction>"'
```

> **IMPORTANT after a `/clear`:** both workers were launched as background tasks of the PREVIOUS
> session, so **their completion notifications will not arrive in the new one**. Do not wait for
> them. Poll instead:
> ```
> docker exec -u dev reel-task-t5195 bash -lc 'cd /workspace && git log --oneline -3 && git status --short | head'
> docker exec -u dev reel-task-t5225 bash -lc 'cd /workspace && git log --oneline -3 && ls docs/plans/tasks/T5225-design.md 2>/dev/null'
> ```
> Their last stdout is also readable at:
> `…\Temp\claude\c--Users-imank-projects-video-editor\5eb5a33e-7681-4852-b031-e7aaee17ec27\tasks\b274zzbsi.output` (T5195)
> and `…\bghhviz3z.output` (T5225).
> If a worker has stalled mid-task, re-drive it with a **self-contained** prompt (see § 4 — `-c` may
> attach to the wrong session).

### Not started
T5205 (card editor — needs T5195 merged), T5210 (renderer), T5215 (attachment), T5220 (apply at
egress), T5230 (compliance), T5200 (cut-out, deprioritised), T6470 (profile photo as identity mark),
T6460 (P0, CI integrity).

---

## 2. User decisions made this session (all approved)

Design decisions are in [EPIC.md](EPIC.md) decisions 2, 2b, 3, 3b, 3c, and in
[T6460](../T6460-merge-landed-stale-commit-ci-blind.md) § 3. Process decisions, which are NOT
recorded anywhere else:

1. **Plan documents MAY be pushed to master** without per-change approval (docs only, never code).
   The reason matters: container workers clone `origin/master`, so an unpushed spec is invisible to
   them — a worker correctly REFUSED a task because the decisions it was told to read did not exist.
2. **Code still requires explicit merge approval.** No merging to master without the user saying so.
3. **Deploys are NOT gated on Master CI** — alert on red instead (T6460 defect 3). Revisit trigger:
   if broken staging bites during real testing even once, gating becomes the answer.
4. **Font catalogue cut 6 -> 4**: `anton`, `oswald`, `graduate`, `playfair`. Alfa Slab One and Kanit
   Italic removed — see `f0f28d4a` for the full rationale.

---

## 3. Design opinions that should survive into T5205/T5210

Not decisions, but judgements formed by looking at real renders. Worth carrying:

- **Graduate is wide.** At support size it consumes far more horizontal room than the others; a long
  club name will wrap or overflow on a 9:16 card. It is a **badge** face — grad year, jersey number,
  short team name. Do not let it carry a full detail line. Worth encoding as editor guidance.
- **Anton is display-only.** At 15px it is genuinely cramped. This is the entire justification for
  carrying Oswald as well; the split is functional, not decorative.
- **No neutral sans was added, deliberately.** An earlier concern that no remaining face is
  comfortable at support size did NOT survive looking at Oswald at 15px. If small print reads badly
  in the real card editor (T5205), add one THEN — not speculatively.
- **Untested**: lowercase (all comparisons were caps) and a genuinely long club name. Both should be
  checked in T5205 against real strings.

---

## 4. Operational landmines discovered this session

These cost real time. None are in the knowledge docs.

### Container workers yield mid-task, repeatedly
A headless `claude -p` worker ends its turn while its own background task (Playwright, a dev server)
is still running, reporting "I'll wait for it to finish". It does not resume by itself.
- Mitigation that worked: `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0` in the env, and instructing
  "run in the FOREGROUND and wait for it in this turn".
- When it still stalls, **run the suite yourself** via `docker exec` and hand the worker the results.
  That was faster than another round trip on several occasions.

### Worker credentials get clobbered to empty
`/home/dev/.claude/.credentials.json` in a container can end up with empty `accessToken` /
`refreshToken` and `expiresAt: 0`, giving `Not logged in · Please run /login`. Host creds were fine.
Fix:
```
docker exec -i -u dev reel-task-<slug> bash -c 'cat > /home/dev/.claude/.credentials.json && chmod 600 /home/dev/.claude/.credentials.json' < ~/.claude/.credentials.json
```
**Caveat:** a bare `claude -p` probe afterwards becomes the most-recent session, so a later `-c`
resumes the PROBE, not the task. After re-auth, send a **self-contained** prompt instead of `-c`.

### Heredocs mangle through `docker exec ... bash -lc "..."`
A `git commit -F - <<EOF` heredoc nested inside a quoted `docker exec` lost most of its body and
executed fragments as shell commands. Use a file instead:
```
docker cp msg.txt reel-task-<slug>:/tmp/msg.txt
docker exec -u dev reel-task-<slug> bash -lc 'cd /workspace && git commit -F /tmp/msg.txt'
```

### The shared checkout can push master without you
Three commits described as "local only" turned out to be on `origin/master` — another session
sharing this working tree pushed and swept them along. Verify with
`git log origin/master..master` before claiming anything is unpushed.

### `dev-verify.sh` wrapper exit code lies
It returned exit 1 on a run where Playwright itself reported all-passed, and exit 0 elsewhere.
**Always parse Playwright's own summary line**, never the wrapper's exit code.

### Stale backend serves a stale font manifest
A parity run showed 32/36 failures purely because the backend had been running since before the font
files were swapped. `docker restart reel-task-<slug>` fixed it. The container image has **no `ps`,
`pkill` or `pgrep`** — restart the container rather than trying to kill processes.

---

## 5. Verification state (so it is not re-run blindly)

| Suite | Result |
|---|---|
| T5180 backend (`test_t5180_text_render.py` + `test_schemas.py`) | 92 passed (after the font cut) |
| T5180 parity (`T5180-text-parity.spec.js`) | **24 passed** = 4 fonts × 2 resolutions × 3 assertions |
| T5190 backend | 39 passed |
| T5190 frontend related | 294 passed |
| T5190 e2e | 3 passed (includes the reload-persistence assertions) |
| Branch CI, both branches | green before merge |

**Known flake on master:** `tests/test_vacuum_on_signout.py::test_logout_fires_vacuum_when_user_archived`
fails intermittently — it failed on a **docs-only** commit and passed 7 minutes earlier. NOT caused by
any player-intro work. Deliberately NOT added to `known-failures.md` (that would hide it). If it
recurs, file a task.

---

## 6. Two real bugs found by tests that would otherwise have shipped

Both are arguments for keeping the tests that caught them:

1. **T5190 photo did not persist.** The upload endpoint returned a key that nothing stored — the
   original spec said T5195 would store it. The in-session preview worked, so it looked fine; a
   reload lost it. Found by the user, then pinned by a reload-persistence assertion.
2. **T5190 `team` field did not persist** — caught by that same new assertion. Root cause was in the
   SPEC, not the app: `blur()` dispatches the DOM event but does not await the handler's fetch, and
   per-user writes serialise behind the `db_sync` write lock. **Real-world residue that was accepted
   and is worth remembering: the last field commits on blur, so a user who types a team and reloads
   within that round-trip can still lose it.**
3. **Pillow was missing from `requirements.prod.txt`.** Only the dev `requirements.txt` had it, so
   the sandbox passed everything while the production image would have failed at import. Caught by
   Branch CI, fixed in `9f290f72`. Lesson: "verified locally" is not proof for a dependency claim.

---

## 7. Links

| What | Where |
|---|---|
| Staging (has T5190 + T5180) | https://reel-ballers-staging.pages.dev |
| Epic design review + UI mockups | https://claude.ai/code/artifact/93478a34-c7e5-406f-a56b-3c3724e4b6dd |
| Font lab (14 candidates, live picker) | https://claude.ai/code/artifact/ab0e195c-2b9d-4c7d-a7cb-9da9748c511e |
| Decision brief (the 3 process decisions) | https://claude.ai/code/artifact/66630255-1ff2-46fa-916c-376782a9491d |
| T5180 font comparison bench | https://claude.ai/code/artifact/936a4877-d890-430d-9fc3-ac521ca56fd8 |

**Dev-login for a container stack** (Google OAuth fails on any port but 5173 — `origin_mismatch`).
Open the stack, then in the browser console:
```js
await fetch('/api/auth/dev-login', {
  method: 'POST', credentials: 'include',
  headers: { 'Content-Type': 'application/json', 'X-Test-Mode': 'true' },
  body: JSON.stringify({ email: 'imankh@gmail.com' })
});
location.reload();
```
Cookies ignore port, so this session also applies to anything else on `localhost`.

---

## 8. Immediate next steps

1. **T5225 design gate** — relay its design + questions to the user; it also needs a **Modal redeploy**
   (`modal deploy app/modal_functions/video_processing.py`) which must be asked for, not assumed.
2. **T5195** — when it reports: sanity-check the diffstat, `bash scripts/task.sh push t5195`, fetch the
   Branch CI verdict **by SHA**, then ask before merging.
3. **After T5195 merges** — T5205 (card editor) is the first screen where the user can actually build
   a card, and is the thing they most want to see. T5210 (renderer) can pair with it.
4. **Still unstarted and owed to the user**: T6460 (P0 — merge must land a CI-green SHA; red-master
   alert) and T6470 (profile photo as identity mark).
