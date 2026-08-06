# Session handoff — 2026-08-06. Supersedes SESSION-HANDOFF-2026-08-05-B.md

**master @ `abc028f2`.** Staging deployed and migrated (**profile_db v036**, all 3 staging accounts
verified `at_head: true`). Everything below is LIVE STATE or hard-won operational knowledge.

---

## 1. LIVE CONTAINERS — read this first

**Containers survive a conversation clear.** They are Docker containers and the workers inside are
detached `claude -p` processes started with `docker exec -d`; neither is tied to a Claude session.
What does NOT survive: background CI watches and task notifications. **A new session gets no
notifications from work started in the old one — POLL, never wait.**

What DOES kill them: Docker Desktop quitting (it happened this session, see § 5).

| Container | Ports (frontend / backend) | Task | Last known status | Next checkup |
|---|---|---|---|---|
| `reel-task-t5215` | `localhost:5176` / `:8003` | T5215 intro attachment + duration gate + carousels | **WORKER RUNNING** (resumed 18:55 UTC, Sonnet, implementing an APPROVED design) | ~30 min after 18:55 UTC, then every ~20 min |
| `reel-task-t6640` | `localhost:5174` / `:8001` | T6640 cards-cannot-be-ugly | **WORKER RUNNING** (resumed 18:55 UTC, Opus, DESIGN GATE — must produce 12 rendered sample cards) | ~40 min after 18:55 UTC (renders are slow) |
| `reel-task-t6630` | `localhost:5175` / `:8002` | T6630 overlay text add/remove/drag | **WORKER DONE, branch pushed, container IDLE** | none — waiting on CI + user merge |

Host-side checkout for each: `C:\work\tasks\<slug>\` (bind mount — read worker files, and their QA
screenshots at `C:\work\tasks\<slug>\qa\`, without git).

`reel-task-t6600` and `reel-task-t6620` are GONE — the committed `post-merge` hook auto-nuked them
when their branches landed. That is expected behaviour, not a loss.

### How to poll a worker (do this, do not wait)

```bash
# 1. Is it alive? NOTE: `ps` DOES NOT EXIST in these containers - use /proc.
docker exec <container> sh /tmp/procs.sh          # script is already in each container
# if missing, recreate: for p in /proc/[0-9]*; do grep -qa claude "$p/cmdline" && \
#   echo "PID $(basename $p): $(tr '\0' ' ' < $p/cmdline | cut -c1-140)"; done

# 2. What has it committed?
docker exec -u dev <container> bash -lc 'cd /workspace && git log --oneline master..HEAD && git status --short'

# 3. What did it LAST SAY? (the only way to tell "finished" from "died")
docker exec -u dev <container> python3 /tmp/lastmsg.py 6

# 4. Its full report
docker exec -u dev <container> bash -lc 'tail -c 3000 /tmp/*.log'
```

**A quiet worker is not a finished worker.** It may be quota-dead or auth-dead, and both look
identical to success. Always read the last message.

---

## 2. THE TRAP THAT COST THE MOST TIME THIS SESSION

**The session limit is ACCOUNT-WIDE and fails SILENTLY.** Three concurrent workers plus heavy QA
exhausted it at ~15:55 UTC; two workers died mid-task printing only
`You've hit your session limit · resets 6:50pm (UTC)` and then exiting 0. They looked finished.

- **Run at most 2 concurrent workers**, not 3, when any of them does QA/rendering.
- Probe before assuming: `docker exec -u dev <c> bash -lc "timeout 120 claude -p 'Reply with exactly: QUOTA_OK'"`.
- Resuming after a quota death: `claude -p --continue` (or `--resume <session-id>`) with a prompt
  that says the run was cut off by quota, tells it to run `git status` first, and does NOT let it
  start over. Session ids live in `/home/dev/.claude/projects/-workspace/*.jsonl`.

**Auth death looks the same.** Symptom: `Not logged in · Please run /login`. Tell: the container's
`/home/dev/.claude/.credentials.json` is **280 bytes** instead of the healthy **508**. Fix:
```bash
docker cp ~/.claude/.credentials.json reel-task-<slug>:/home/dev/.claude/.credentials.json
docker exec -u root reel-task-<slug> chown dev:dev /home/dev/.claude/.credentials.json
docker exec -u root reel-task-<slug> chmod 600 /home/dev/.claude/.credentials.json
```
Do NOT smoke-test auth with a bare `claude -p` and then resume with `-c` — the smoke test becomes
the most recent session and `-c` continues THAT. Resume by explicit `--resume <session-id>`.

---

## 3. THE SHARED-CHECKOUT HAZARD — I got caught by it

`c:\Users\imank\projects\video-editor` is shared with other Claude sessions. **Another session
switched it from `master` to `fix/landing-slider-after-video-freeze` mid-session**, and a commit +
a merge landed on their branch by mistake. Recovery was clean (`git reset --hard` back to their
HEAD, their work was untouched, and they later merged it themselves).

**Rules that follow:**
- `git branch --show-current` **immediately before** any commit or merge. Never assume.
- Land master work in an isolated worktree, never by switching this tree's branch:
  `git worktree add /c/work/land-master master` — **it still exists at `C:\work\land-master`**;
  reuse it (`cd /c/work/land-master && git pull --rebase origin master`) or remove it with
  `git worktree remove /c/work/land-master`.
- Explicit `git add <paths>` only. Never `-A`, never `stash` — the user keeps large uncommitted WIP.

---

## 4. CI STATE AND THE T6460 PROBLEM

| Run | State |
|---|---|
| Branch CI `feature/T6630-...` (`31118447540`) | **QUEUED (re-run)** — first attempt failed at the `changes` job / "Set up job" |
| Master CI on master (`31118334662`) | **QUEUED (re-run)** — first attempt had both jobs CANCELLED |
| Master CI `31115651311` | green (last genuine master verdict) |

Two failure modes that are NOT your code and must not be triaged as bugs:
- **`changes` job fails at "Set up job" with no logs, backend+frontend skipped** = GitHub runner
  infrastructure. `gh run rerun <id>`.
- **A run whose jobs are `cancelled` reports `conclusion: failure`.** That is **T6460 (P0, still
  untouched)**: a superseding push cancels the previous Master CI. **Treat `cancelled` as NO
  VERDICT**, never as red. Batch doc/status commits into ONE push to avoid causing it.

Runners looked backed up at 19:00 UTC — both re-runs sat queued for a while. Just poll.

---

## 5. DOCKER DESKTOP DIED MID-SESSION — recovery is easy, do not panic

Symptom: every `docker` call fails with
`open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified`.

All containers stop as `Exited (255)` but are **not removed**, so nothing is lost — including
uncommitted working trees.
```bash
Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"   # then wait for the engine
until docker ps >/dev/null 2>&1; do sleep 5; done
docker start reel-task-t5215 reel-task-t6630 reel-task-t6640
# re-seed credentials (§ 2), then re-drive each worker by session id
```

---

## 6. WHAT IS OPEN, IN PRIORITY ORDER

### Waiting on the user
- **T6630 — merge approval.** Branch `feature/T6630-overlay-text-add-remove-drag-ux` is pushed,
  reviewer-approved, 16 unit + **12/12 real-browser** tests on the REAL `/overlay` screen. Needs
  its (re-running) CI verdict, then explicit approval. **Never merge without it.**

### In flight
- **T5215** — implementing an approved design. Takes **profile_db v037**
  (`intro_min_duration_seconds REAL NOT NULL DEFAULT 20.0` on the profile_db `user_settings`
  singleton). Its own design proved there are **exactly FOUR `INSERT INTO final_videos` writers**
  and that `.claude/knowledge/export-pipeline.md`'s "2 writers" line is WRONG — that correction is
  owed at Stage 7. Top regression risk: re-export must not drop `intro_card_id`.
- **T6640** — design gate. **Not acceptable without 12 rendered cards** (3 treatments x 2 aspects x
  {short name, long wrapping name}). Relay the design + samples to the user for approval; it must
  not start implementing before that.

### Filed, unstarted
- **T6590** — rewritten today (thumbnail rename, delete the "Use current frame" button, drag-to-set,
  clipped icon, move the marker lower, better tooltip). **Not yet spawned.** Coordinate with T6630,
  which changed the text lane right below the marker.
- **T6520**, **T6530** (after T5215+T5220), **T6550**, **T6500**.
- **T6460 (P0, CI integrity)** and **T6470** — owed from two sessions ago, still untouched. T6460
  got more evidence today (§ 4).

### Owed investigation (not yet tasked)
**Shadow blur range.** User: "shadow blur should do more between the lowest and highest settings."
Two hypotheses, neither confirmed by measurement:
1. **Dilution** — a Gaussian spreads the same alpha over a larger area, so a high blur reads as
   faint haze, not a stronger shadow. The perceptual range is therefore flat by construction.
2. **A likely preview/export PARITY VIOLATION** — CSS `text-shadow` treats blur radius as ~2x the
   Gaussian standard deviation, while PIL's `ImageFilter.GaussianBlur(radius)` uses radius AS the
   standard deviation. Same spec => the export should be ~2x blurrier than the preview.
   `RichText.jsx:223` `blurPx = spec.shadow.blur * fontPx`;
   `text_render.py:166` `blur_px = spec.shadow.blur * spec.size * frame_h`.
**Confirm with a real pixel comparison before acting.** Slider is `min=0 max=0.5` in
`TextSpecEditor.jsx`.

---

## 7. WHAT LANDED THIS SESSION

- **T6600** merged (`b6878608`) — z-index scale module + intro-card modal portalled to
  `document.body`. Marked STAGING. Use `src/frontend/src/constants/zLayers.js` instead of raw
  z-indexes from now on.
- **T6620** merged (`0c376d42`) — inert shadow blur fixed ("blur implies a shadow", shared default
  opacity resolved identically in `RichText.jsx` and `text_render.py`); legacy title override
  removed so the profile Full Name always wins; **eye toggle fixed** (the selected-block
  short-circuit ran BEFORE the `enabled` check, so hiding the block you were editing kept it on
  screen — and you are always editing the block whose eye you click); Title renamed to Athlete Name.
  Ships **profile_db v036**. Marked STAGING, deployed, migrated, verified.
- **Footer note removed** — "Overlay text is burned into the exported video..." is gone from the
  TextSpec rail, along with the `hideFooterNote` prop that existed only to suppress it.
- **Tasks filed:** T6630 (implemented), T6640 (+ **epic decision 12**, which AMENDS epic requirement
  2 — for CARDS the template owns font and colour; Overlay text keeps full user control), T6590
  (rewritten), T5215 (scope expanded).

---

## 8. DECISIONS THE USER MADE TODAY (do not relitigate)

| Decision | Value |
|---|---|
| Card delete cascade | Attached reels go to `NULL` (inherit default), not `0` |
| Cross-profile move | Inherit the target profile's settings (`NULL`) |
| Default intro is duration-gated | Profile-level `intro_min_duration_seconds`, default **20s**. `NULL` = default IF long enough; an EXPLICIT id is NEVER gated; `0` = no intro at any length |
| Intro pickers | **Carousels**, every card, **newest-first**, with a "No intro" choice |
| Card styling | **The template owns typography** — user picks content + treatment + framing only. Font, custom colour, swatches, shadow, stroke come OFF the card rail. Overlay text rail keeps them |
| Thumbnail marker | Delete the "Use current frame" button; dragging the marker is the only control |

Supervisor calls made for T5215 (stated to the user, reversible): unknown reel duration fails closed
to no-intro **and warns loudly**; threshold is per-profile only; bounds validated `0 < x <= 300s`
(reject, do not silently clamp).

---

## 9. OPERATIONAL RECIPES

**Run migrations on staging** — `init_pg_pool()` FIRST or it raises:
```
fly ssh console -a reel-ballers-api-staging -C "python -c \"
from app.services.pg import init_pg_pool
from app.migrations import run_all_migrations
import json
init_pg_pool()
print(json.dumps(run_all_migrations(), default=str)[:4000])
\""
```
**Then VERIFY it landed** (never assume the call worked) with
`get_migration_status_for_user` per user — pg rows are **dicts** (`r['email']`), the PK is
**`user_id`**, the context manager is **`get_pg()`**. `Error: The handle is invalid.` at the end is
a Windows fly-ssh artifact, NOT a failure — the JSON prints before it.

**Migrations never auto-run on deploy.** Any schema change needs this afterwards.

**Drive the real Overlay screen** (the `openLoadableOverlayDraft` helper is STALE — it waits on an
"Open in Overlay" button that no longer exists and times out at 240s):
```js
await loginAsRealUser(context, 'imankh@gmail.com');
await page.goto('/');
const { loadable } = await probeOverlayDrafts(page);
await page.evaluate((id) => {
  sessionStorage.setItem('pendingProjectId', String(id));
  sessionStorage.setItem('pendingProjectMode', 'overlay');
}, loadable[0]);
await page.goto('/overlay');
await page.getByTestId('overlay-video-stage').first().waitFor({ timeout: 120000 });
```
Selectors: lane `.text-track`, block `[data-testid="text-block-body-N"]`, levers
`text-lever-start-N` / `text-lever-end-N`.

**Before spawning a worker, PUSH the task file** — the container clones from `origin/master`.

**Verification discipline (the 2026-08-05 false green):** a diag harness may SUPPLEMENT, never
SUBSTITUTE. Verify on the real screen with an EXISTING DB-loaded record. Re-measure geometry
immediately before EVERY pointer interaction and assert `document.elementFromPoint(x,y)` is the
intended element. At zoom the lane is far wider than the viewport (3381px vs 1280px). Pause the
video before any pixel comparison. Parse Playwright's own summary line, not the wrapper exit code.

**A measurement artifact that looks like a bug:** at 500% zoom a dragged text block's pixel-x barely
changes because the block is wider than the viewport. Assert `aria-valuenow`, not pixel position.
This is why the "drag is dead at 500%" report was NOT reproducible — drag works.

---

## 10. STANDING RULES

- **Never merge without explicit user approval**, per branch. Green CI is not approval.
- AI sets `WIP` / `WAITING ON USER` / `STAGING`; the **user** owns `DONE`.
- Every commit subject starts with the task id, or the task loses attribution when its branch is deleted.
- Workers commit and report; **the supervisor pushes**. Containers have no push creds by design.
- Explicit `git add <paths>` only. Never `-A`, never `stash`.
- **PII:** the T6640 report screenshots contain a real minor's name and photo. Never commit that
  name, that photo, or any fixture derived from them.
