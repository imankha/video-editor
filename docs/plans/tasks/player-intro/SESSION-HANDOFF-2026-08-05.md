# Session handoff — Player Intro epic + editor polish, 2026-08-05

Supersedes [SESSION-HANDOFF-2026-08-04.md](SESSION-HANDOFF-2026-08-04.md) (still worth reading for
the T5180 font rationale and the container basics).

Everything here is **live operational state** (not in git) or **knowledge that would cost real time to
rediscover**. Settled design decisions are NOT duplicated — they live in the task files, which were
updated as decisions were made.

**master @ `a5bac603`.**

---

## 1. READ THIS FIRST — two live containers, one with an undelivered instruction

| Task | Container | Ports | State |
|---|---|---|---|
| **T6580** (+T6570) card editor | `reel-task-t6580` | fe 5174, be 8001 | writing an order-bug repro spec |
| **T6560** overlay | `reel-task-t6560` | fe 5175, be 8002 | implementing; 6 files modified |

Both cloned from master @ `04e5b7bf`. Neither has pushed.

> ### ⚠ T6580 has an APPENDED instruction it has not been told about
> The user added two items mid-run (free-text **subtitle**, and **stop naming the layout**). Because
> the worker was mid-turn, they were appended to `/workspace/.dotask-kickoff.md` **but never
> delivered as a message**. The worker does not know about them.
>
> **When T6580 reports, you MUST send it:**
> ```
> docker exec -u dev reel-task-t6580 bash -lc 'cd /workspace && CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0 \
>   claude -p -c "Re-read the end of /workspace/.dotask-kickoff.md - two ADDITIONS were appended after you started (a free-text subtitle, and removing the layout name). Execute them."'
> ```
> Both are also written up in `docs/plans/tasks/T6570-card-title-from-profile-full-name.md`
> (§ "Added 2026-08-05"), so the durable record is on master either way.

> ### ⚠ Notifications will NOT arrive in a new session
> Both workers were launched as background tasks of the PREVIOUS session. Poll instead:
> ```
> docker exec -u dev reel-task-t6580 bash -lc 'cd /workspace && git log --oneline -3 && git status --short | head'
> docker exec -u dev reel-task-t6560 bash -lc 'cd /workspace && git log --oneline -3 && git status --short | head'
> ```
> **A quiet worker is not necessarily a finished worker** — see § 4.

### T6580 owes the user a decision
It was told to **STOP and report treatment-differentiation options with rendered samples** before
committing to a direction (feedback item: *"Changing Style doesn't currently change much"*). Relay
those options to the user; do not let it pick one silently.

---

## 2. What landed today

| Commit | Task |
|---|---|
| `139d570c` | **T5195** card library — `intro_cards` + `final_videos.intro_card_id` (profile_db **v034**) |
| `2e3b532e` | **T5225** overlay text layer — clip snapping + burn-in in both render loops |
| `9c603f6f` | **T5210** render engine + the **shared geometry/motion/treatment contract** |
| `2a3594a6` | **T5205** card editor — first screen where a card can be built |
| `f6b6c4fc` | **T6510** preview image is a frame choice (upload removed, legacy grandfathered) |
| `bd17b228` | **T6540** card editor information design |
| `5e535e78` | font-picker fix (see § 4) |
| `91629fc0` | "Cover photo" → "Preview image" rename |
| `58d6eceb` | treatment swatches + colour control defects |

**Master CI green on `b6623f5f`.** Staging deployed and **migrated to v034** (all 7 profiles at head
34; postgres 22/22).

**Modal was deployed manually** (`reel-ballers-video-v2`) before the T5225 merge. Note there is ALSO a
`Deploy Modal Functions` workflow that runs on merge to master — the manual deploy only closed the
window earlier. The "ask before `modal deploy`" rule governs manual deploys; merges deploy it anyway.

---

## 3. The shared contract — the thing most likely to be broken by accident

`app/services/intro_card_geometry.py` is the **Python source of truth** for slot geometry, motion
timings and treatment colours. `src/frontend/src/utils/introCardGeometry.js` is a **generated mirror**
the editor imports, pinned by a parity test. **Never hand-edit the mirror.**

Two seam rules that cost real debugging to establish and are easy to get backwards:

- **`text_elements` is STYLING ONLY.** Title text comes from `title_text` (soon: the profile's Full
  Name, T6570); fact VALUES come from the profile. A renderer reading text out of `text_elements`
  produces blank titles while every test on both sides passes.
- **Geometry is keyed ORDINALLY (`fact1/fact2/fact3`), styling SEMANTICALLY
  (`title/position/class/team`).** The renderer maps between them. Styling must follow the fact, so
  un-ticking one fact never transfers another fact's styling to it.

**Composition is derived, never stored** (`derive_composition`, mirrored in
`introCardComposition.js`). The subtitle being added by T6570 is **orthogonal** — it must not count
toward the fact count.

---

## 4. Operational landmines found today

### The font picker silently did nothing in staging/prod (`5e535e78`)
`RichText` fetched the font manifest and every `@font-face src` as a bare `/api/fonts/...`. That
resolves against the FRONTEND origin — Cloudflare Pages, not the API — and the SPA catch-all answers
any unknown path with **`index.html` at HTTP 200, `text/html`**. So no `@font-face` was ever injected
and every font fell back to the same face. **Local dev hides this completely** (Vite proxies `/api`),
so the T5180 parity test and T5225's e2e both passed against a working path.
**Rule: any URL the browser fetches must go through `config.resolveApiUrl`.**

### A quiet worker may be quota-blocked, not finished
The session limit is **account-wide** — it killed both containers at the same instant — and it fails
**silently**: the worker exits its turn cleanly and the limit text is simply its last assistant
message. Always read the last message before concluding a worker is done:
```
docker exec -u dev reel-task-<slug> bash -lc 'python3 -c "
import json,glob
p=glob.glob(\"/home/dev/.claude/projects/-workspace/*.jsonl\")[0]
rows=[json.loads(l) for l in open(p,encoding=\"utf-8\") if l.strip()]
[print(b[\"text\"]) for r in rows[-5:] for b in (r.get(\"message\",{}).get(\"content\") or []) if isinstance(b,dict) and b.get(\"type\")==\"text\"]"'
```

### Vite serves STALE transforms in these containers
An in-container edit to the bind-mounted workspace does not reliably fire the watcher, so the dev
server keeps serving pre-edit JS — a fix looks like it "didn't work" and re-running gives byte-identical
failures. **`curl` the module and grep for your change before believing any negative result.** The
image has no `ps`/`pkill`; enumerate `/proc` and kill the whole tree (npm parent + `sh -c vite` + node),
then relaunch detached. (A worker also wasted time here because its `/proc` kill-loop matched its own
shell command text — `nohup npm run dev` is the simple fix.)

### Harness fidelity — three failures in one session, all failing OPEN
A diag harness more permissive than its production host produces green results that mean nothing:
1. `textdiag` imported no stylesheet → every Tailwind class inert → elements 0px → 10 *correct* drag
   tests failed.
2. The same spec used page-absolute pixel math → every coordinate 40px off → the test named "snaps
   onto the boundary" never got within the snap threshold, so snapping was never exercised.
3. `introcarddiag` had **no size constraint** → a UX redesign was validated at full viewport when
   production is `IntroCardsModal`'s `max-w-5xl h-[85vh]` with internal scroll. Under the real cap that
   redesign scrolled **worse** than the baseline it was fixing.
**A harness must reproduce its production host's constraints.** T6540 fixed `introcarddiag` to wrap
the editor in the modal's exact box — keep it that way.

### Rapid pushes cancel Master CI
Four consecutive master SHAs finished `cancelled` (superseded by the next push), several caused by my
own docs-commit cadence. **T5205's merge commit never got a full-suite verdict** — it was covered only
incidentally by a later docs commit. Treat `cancelled` as **no verdict**, never as "not failed", and
batch doc pushes. This is live evidence for **T6460 (P0)** and is recorded in that task file.

---

## 5. Open tasks filed today

| Task | What |
|---|---|
| **T6560** | *in flight* — preview image can be cleared from the timeline (violates T6510's "always a frame"); remove "Applies highlight overlay (H.264)" |
| **T6570** | *in flight* — title from profile **Full Name** (no migration: facts live in `user_settings` k/v) + **subtitle** (needs `subtitle_text`, a real migration) + stop naming the layout |
| **T6580** | *in flight* — bigger card, readable controls, modal must suppress the page, treatments must visibly differ, **order-dependent render bug** |
| **T6520** | size/align back as a **multiplier** + alignment override (absolute would frame right at 9:16 and wrong at 16:9) |
| **T6530** | how to SURFACE the feature — deliberately **after T5215+T5220** |
| **T6550** | `set_project_poster_marker_time` write is not column-guarded → 500s in the deploy→migrate window |
| **T6500** | more fonts for overlay (current 4 are intro-card faces) |
| **T6480** | overlay text editor contrast |
| **T6490** | pause-during-text — **design settled, deferred to Post Launch** |

**Owed and still unstarted: T6460 (P0, CI integrity) and T6470.**

---

## 6. The epic's remaining critical path

**T5215** (attach a card to a reel — `intro_card_id` shipped in v034, so it is wiring not schema) then
**T5220** (prepend at every egress). Until both land, **a user can build and preview cards but they
appear on nothing**. T5220 is also where `_concat_copy`/`_concat_reencode`/`_validate_concat` become
the **third** copy — the project rule says abstract on the third, so the extraction belongs there.

---

## 7. Verification state (so it is not re-run blindly)

| Suite | Result |
|---|---|
| T5195 backend | 38 passed |
| T5210 | 32 passed; **24 real MP4s** built (4 compositions × 3 treatments × 2 aspects) |
| T5205 | 40 unit, 344 `vitest related`, 7 real-browser |
| T5225 | 86 backend, 86 frontend, 10 Playwright |
| T6510 | 34 backend poster, 5 real-browser |
| T6540 | 18 unit, 7 real-browser; density numbers in `docs/plans/tasks/T6540-critique.md` |

**Known flake on master:** `tests/test_vacuum_on_signout.py::test_logout_fires_vacuum_when_user_archived`
— intermittent, unrelated to this work, deliberately NOT in `known-failures.md`.

---

## 8. Links

| What | Where |
|---|---|
| Staging | https://reel-ballers-staging.pages.dev |
| T5225 design gate | https://claude.ai/code/artifact/fdff5983-147e-4143-a86a-56947d9793b1 |
| T5210 design gate (compositions + motion rendered) | https://claude.ai/code/artifact/739e4fbe-5465-4530-b9c2-b43f174e9ded |
| Pause: Framing vs Overlay analysis | https://claude.ai/code/artifact/69124049-e20a-405a-a171-05952bd91874 |
| Epic UI mockups | https://claude.ai/code/artifact/93478a34-c7e5-406f-a56b-3c3724e4b6dd |
| T6540 before/after screenshots | `C:\work\tasks\t6540\qa\{before,after}\` |

**Dev-login for a container stack** (Google OAuth fails on any port but 5173):
```js
await fetch('/api/auth/dev-login', {
  method: 'POST', credentials: 'include',
  headers: { 'Content-Type': 'application/json', 'X-Test-Mode': 'true' },
  body: JSON.stringify({ email: 'imankh@gmail.com' }),
});
location.reload();
```

---

## 9. Immediate next steps

1. **Poll both containers.** Read each worker's LAST ASSISTANT MESSAGE, not just git state.
2. **Deliver T6580's appended instructions** (§ 1) the moment it reports.
3. **Relay T6580's treatment options** to the user before it commits to a direction.
4. Per worker: sanity-check the diffstat → `bash scripts/task.sh push <slug>` → fetch the Branch CI
   verdict **by SHA** → **ask the user before merging** (standing rule).
5. Then **T5215**, which is what makes any of this appear on a reel.
