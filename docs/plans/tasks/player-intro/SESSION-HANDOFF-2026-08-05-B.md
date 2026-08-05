# Session handoff — 2026-08-05 (evening). Supersedes SESSION-HANDOFF-2026-08-05.md

**master @ `de8caf46`.** Staging deployed and migrated (**profile_db v035**, all 7 profiles verified
at head). Everything below is LIVE STATE or hard-won operational knowledge. History is deliberately
omitted — the task files carry the decisions.

---

## 1. READ FIRST — this session shipped a false green. Do not repeat it.

**T6610 and T6480 were merged reporting "10/10 real browser" and two of their acceptance criteria
were not met in the real app.** Cause: both e2e specs drove **dev-only diag harness pages**
(`/textdiag.html`, `/textspecdiag.html`) and called `skipOnDeployedTarget`, so they never touched the
real Overlay screen and never ran against a build. The harness mounts the real component with its own
props; the app wires it differently.

**Rule, now written into every kickoff:** a diag harness may SUPPLEMENT, never SUBSTITUTE. Verify on
the real screen, with an EXISTING DB-loaded record, or the criterion is unverified.

Corollary learned the hard way while diagnosing (three false "reproductions" in one hour):
- **Re-measure element geometry immediately before EVERY pointer interaction**, and assert
  `document.elementFromPoint(x, y)` is the intended element before pressing. Clicking opens/updates
  the rail and shifts layout; stale coordinates press empty space and look exactly like a broken
  feature.
- The timeline lane is far **wider than the viewport** at zoom (3381px vs 1280px) — a
  fraction-of-width coordinate lands off-screen and hits nothing.
- A block can sit **below the fold** (y=934 in a 720px viewport); `elementsFromPoint` returns `[]`
  and every interaction silently misses. `scrollIntoViewIfNeeded` then re-measure.
- **Pause the video** before any pixel comparison of the stage, or frame noise swamps the signal.

---

## 2. Live containers

| Container | State | What to do |
|---|---|---|
| `reel-task-t6620` | **running** (started 23:15 UTC) | Wait for its report, then push -> Branch CI -> ask user -> merge |
| `reel-task-t6600` | **worker DEAD** (`Not logged in · Please run /login`), 2 good commits unpushed | Re-drive it (below) |

**T6600 has real work to preserve** — do not nuke it:
```
25b40e81 T6600: add ordered z-index scale module; migrate layering-contract call sites
e0d3f377 T6600: portal the intro-card modal to document.body at the elevated layer
```
Container auth died mid-run. Host `~/.claude/.credentials.json` looked intact (refreshToken present),
so re-seed the container's copy and resume:
```
docker cp ~/.claude/.credentials.json reel-task-t6600:/home/dev/.claude/.credentials.json
docker exec -u dev reel-task-t6600 bash -lc 'cd /workspace && claude -p -c "resume per /workspace/.dotask-kickoff.md"'
```
If `-c` fails, send a self-contained fresh `claude -p` naming the branch + the two commits.

**Poll workers, don't wait for notifications** — background tasks from a previous session never
notify a new one:
```
docker exec -u dev reel-task-<slug> bash -lc 'cd /workspace && git log --oneline -3 && git status --short | head'
docker exec -u dev reel-task-<slug> bash -lc 'python3 -c "
import json,glob,os
p=sorted(glob.glob(\"/home/dev/.claude/projects/-workspace/*.jsonl\"), key=os.path.getmtime)[-1]
rows=[json.loads(l) for l in open(p,encoding=\"utf-8\") if l.strip()]
[print(b[\"text\"][:2000]) for r in rows[-6:] for b in (r.get(\"message\",{}).get(\"content\") or []) if isinstance(b,dict) and b.get(\"type\")==\"text\"]"'
```
A quiet worker may be **quota-blocked** (`You've hit your session limit · resets <time>`) or
**auth-dead** — both end the turn cleanly and look identical to "finished". Always read the last
message. Check liveness by PID: `grep -q claude /proc/<pid>/cmdline`.

---

## 3. What is open, in priority order

### Immediate (in flight)
- **T6620** — 4 defects, worker running. Items 1 & 2 are ROOT-CAUSED in the task file with
  file:line; do not re-investigate, verify the fix.
- **T6600** — modal z-order. Re-drive. This is the last piece of T6580 item 1, which was
  **knowingly left open** at merge (the scrim landed; reel tiles still paint over the modal — that
  is expected on staging, not a regression).

### Unresolved, needs an answer
- **Overlay select/drag "broken" report could NOT be reproduced.** On master, on the real Overlay
  screen, with an EXISTING DB-loaded block after reload: drag moved 120px, pointer events fired,
  nothing occluding. The deployed staging bundle DOES contain the new code (grep the bundle for
  `text-block-body-` and `drag or use arrow keys to move`). Two live hypotheses: a **cached bundle**
  in the user's browser (service worker), or something specific to their block. **Ask the user to
  hard-reload staging first** — that settles it in seconds before anyone builds a fix.
- **Eye toggle** (T6620 item 3): state flips correctly and `TextOverlayPreview.jsx:32` filters
  `enabled === false`. Best hypothesis: `enabled` is **`undefined`** rather than `false` on DB-loaded
  blocks, so the strict check renders it. Also **the export side is untested** — hidden-in-preview
  but burned-into-the-MP4 is the worse half.

### Filed, unstarted
**T6590** (preview-image marker linkage + playhead occlusion), **T6520**, **T6530** (do AFTER
T5215+T5220), **T6550**, **T6500**.

### Owed from before this session, still untouched
**T6460 (P0, CI integrity)** and **T6470**. T6460 got fresh evidence today: rapid pushes cancel
Master CI, and I worked around it manually by batching every doc commit into one push. Treat
`cancelled` as NO VERDICT.

---

## 4. THE GOAL — what actually matters next

Everything shipped today is **polish on a feature with no egress**. A user can build, style,
subtitle and preview an intro card, and it **appears on nothing**.

**Critical path: T5215 then T5220.**
- **T5215** — attach a card to a reel. `intro_card_id` already shipped in v034, so this is wiring,
  not schema.
- **T5220** — prepend at every egress. This is also where `_concat_copy` / `_concat_reencode` /
  `_validate_concat` become the **third** copy, so the rule-of-three extraction belongs there rather
  than in a later cleanup task.

If the next session has capacity for exactly one thing, it is T5215.

---

## 5. Operational recipes worth not rediscovering

**Drive the real Overlay screen** (the `openLoadableOverlayDraft` helper is STALE — it waits on an
"Open in Overlay" button that no longer exists and times out at 240s):
```js
await loginAsRealUser(context, 'imankh@gmail.com');
await page.goto('/');
const { loadable } = await probeOverlayDrafts(page);      // pick a streamable draft
await page.evaluate((id) => {
  sessionStorage.setItem('pendingProjectId', String(id));
  sessionStorage.setItem('pendingProjectMode', 'overlay');
}, loadable[0]);
await page.goto('/overlay');
await page.getByTestId('overlay-video-stage').first().waitFor({ timeout: 120000 });
```
Selectors: lane `.text-track`, block `[data-testid="text-block-body-N"]`, levers
`text-lever-start-N` / `text-lever-end-N`. Run against the already-running dev app with
`E2E_BASE_URL=http://localhost:5173`.

**Verify a migration actually landed** (never assume the migrate call worked):
```
fly ssh console -a reel-ballers-api-staging -C "python -c \"
from app.services.pg import init_pg_pool, get_pg
from app.migrations import get_migration_status_for_user
import json
init_pg_pool()
with get_pg() as c:
    cur=c.cursor(); cur.execute('SELECT user_id, email FROM users ORDER BY email'); rows=cur.fetchall()
for r in rows:
    print(r['email'], json.dumps(get_migration_status_for_user(str(r['user_id'])), default=str))
\""
```
Reads the ACTUAL R2 `PRAGMA user_version` per profile. Note: pg rows are **dicts** (`r['email']`,
not `r[1]`), the users PK is **`user_id`** not `id`, and the pg context manager is **`get_pg()`**.
`Error: The handle is invalid.` at the end is a Windows fly-ssh artifact, not a failure.

**Migrations never auto-run on deploy.** Any schema change needs the admin endpoint or the fly-ssh
fallback afterwards, and the deploy→migrate window is why hot reads AND writes need column guards.

**Push discipline:** batch doc/status commits into ONE push. Every push starts a new Master CI run
and cancels the previous one.

**Before spawning a /dotask worker, PUSH the task file** — the container clones from `origin/master`.

---

## 6. Verification state (so it is not re-run blindly)

| Suite | Result |
|---|---|
| T6560 | 24 backend + 9 unit + 2 real-browser; Branch CI green `dadb0d4b` |
| T6580 + T6570 | 107 backend, 78 unit, 11 real-browser; Branch CI green `a5485d95` |
| T6610 + T6480 | Branch CI green `1eaffa6b` — **but harness-only, see § 1** |
| Master CI | green on `51adaf40` and `96202a8e` |

**Known flake:** `tests/test_vacuum_on_signout.py::test_logout_fires_vacuum_when_user_archived` —
intermittent, unrelated, deliberately NOT in `known-failures.md`.

---

## 7. Standing rules (do not relearn)

- **Never merge without explicit user approval**, per branch. Green CI is not approval.
- AI sets `WIP` / `WAITING ON USER` / `STAGING`; the **user** owns `DONE`.
- Every commit subject starts with the task id, or the task loses attribution when its branch is
  deleted.
- Workers: commit and report; **the supervisor pushes**. Containers have no push creds by design.
- Explicit `git add <paths>` only — the user keeps large uncommitted WIP. Never `-A`, never `stash`.
