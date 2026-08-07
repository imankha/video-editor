# Session handoff — 2026-08-07 (~02:15 UTC). Supersedes SESSION-HANDOFF-2026-08-06.md

**master @ `450b081b`** (docs). Master CI **green** on a post-outage `workflow_dispatch` run (`31133477866`).
Staging unchanged since T6620 (docs-only commits after). Everything below is LIVE STATE.

**Mode this session ran in: fast per-round user iteration.** The user tests a container port, gives
notes, the supervisor briefs the worker for another round in the SAME container/session (explicit
`--resume <session-id>`), pushes nothing until a round is noteless. **The user merges only noteless
branches — do not ask to merge anything that has open notes.**

---

## 1. QUOTA: the wave is DEAD until 04:50 UTC

Both active workers died at ~02:08 UTC: `You've hit your session limit · resets 4:50am (UTC)`.
This is the SECOND quota death today (first at ~23:50 UTC killed three). Even 2 workers + a busy
supervisor session exhausts it in ~2h. Poll workers' LAST MESSAGE to tell finished/quota/auth apart
— all three look identical (quiet, exit 0). Recipes: memory
`project_dotask_worker_yield_and_supervisor_fallback` §3/§9/§10-12.

**Resume commands** (after reset; re-seed creds first if `.credentials.json` is 280 bytes not 508):
```
docker exec -d -u dev reel-task-t6630 bash -lc 'cd /workspace && claude -p --resume a2ddc9d9-f812-4798-b248-ff18c45d623f --model sonnet "<prompt>" > /tmp/log 2>&1'
docker exec -d -u dev reel-task-t5215 bash -lc 'cd /workspace && claude -p --resume ea8322fc-4645-45b4-83b8-541467ee09a7 --model sonnet "<prompt>" > /tmp/log 2>&1'
docker exec -d -u dev reel-task-t6640 bash -lc 'cd /workspace && claude -p --resume ebf5ae26-9a93-4299-a52c-36d54e744778 --model sonnet "<prompt>" > /tmp/log 2>&1'
```
Round briefs already in each container at `/tmp/round*.md` (and staged copies in the old session's
scratchpad). Workers NEVER push — the supervisor pushes via
`git fetch C:/work/tasks/<slug> <branch>:<branch> && git push origin <branch>` (works from the shared
checkout without switching its branch).

---

## 2. PER-TASK STATE (containers survive; all sessions resumable)

### T6640 — cards (`reel-task-t6640`, :5174/:8001) — **ROUND 2 COMPLETE, awaiting user verdict**
- Branch `feature/T6640-cards-cannot-be-ugly`: pushed `dc150f5c` + container-local `8b268706`
  (collision fix) + `87cd6e89` (rename + default). Clean tree. **:5174 serves it, verified.**
- Round 2 delivered: live-preview collision was a **stale first-render measurement** (computed once
  pre-font-settle, never recomputed even 4s later) → settle-aware `useCardPreviewElements` with a
  6-consecutive-frame stability check; fact-subset regression matrix (all 8 subsets × both aspects,
  backend + JS); rename affordance made visible-at-rest (was hover-only `border-transparent`);
  "Intro Card N" gap-fill naming; first-card-auto-default; ALWAYS-a-default invariant with
  same-transaction auto-promote of the **newest** remaining card on default delete ("newest" is a
  supervisor call — user said "the next card"; reversible).
- **Merge-time check owed:** T5215's resolver reads `is_default`; T6640 now writes it. Verify the
  contract when BOTH branches land (worker could only grep its own branch).

### T6630 + T6590 — one branch (`reel-task-t6630`, :5175/:8002) — round 4 ~90% done, QA cut off
- Branch `feature/T6630-overlay-text-add-remove-drag-ux` (pushed: round 1 only `8946f9ab`).
  Container-local: `20e1d1ca`+`f0157917` (round 2), `5705b476`+`d489ef16` (round 3),
  `269c13f1` (round 4 REGIONS backend), `0639b6a1` (REGIONS frontend), `bf2948fe` (default preset +
  two-column layout), `463a2cba` (SW dev-hardening). dirty=1, QA/evidence incomplete when quota hit.
- Model now: **text REGIONS (time spans) contain ELEMENTS**; all elements of a region render
  simultaneously; Text tab = list + add/remove + settings; 9-slot position grid (3×3) + per-element
  align replaced stage drag; new element spawns bottom-center (stepping up if taken); marker (T6590)
  at TOP of timeline, draggable at rest, occlusion solved via z-order+halo (evidence: marker≡playhead
  at 100% and 500%).
- **Resume brief must ADD one item:** the "Video failed to load" overlay must CLEAR when the
  `/stream` fallback succeeds (user screenshots show the frame visible BEHIND the stuck error).
  Also tell it: the SW theory is REFUTED (user unregistered SWs, still failed) — real cause was R2
  CORS (§4, fixed) — so its `463a2cba` SW-gating stays as hygiene but is NOT the fix; do not claim it is.
- Round-4 items the user has NOT yet seen: regions model, default preset, two-column layout. Expect
  notes once tested.

### T5215 — intro attachment (`reel-task-t5215`, :5176/:8003) — round 3 cut off at start
- Branch `feature/T5215-intro-attachment`: pushed round 1 (`761aa859..ad76e229`). Container-local:
  round 2 `b6d466fa` (picker-shows-selection fix — was PRESENTATION not persistence + 3 distinct
  states: Selected / Following-default / No-intro), `383ad0d7` (collection intros — same carousel;
  resolution call: collection's own intro governs collection playback, member intros not consulted;
  duration gate = collection total; flagged reversible for T5220), `6bbe16fb` (QA). dirty=2 (round-3
  start, minor).
- **Round 3 brief** at `/tmp/round3.md` in-container, barely started: (1) z-order — tile play button
  paints OVER the open kebab menu; fix via zLayers.js ladder (add a dropdown rung if missing, check
  all tile overlays); (2) badge gaps — collection cards have NO intro badge at all, and the ReelTile
  badge doesn't appear until reload after a PATCH (must update optimistically/refetch);
  (3) picker commit UX — SELECT → motion preview plays (reuse T5205 path) → explicit **OK** commits
  (the one surgical write moves to OK-click), Cancel/Esc = no write, Enter = OK, both hosts.
- v037 = T5215's, v038 = T6640's, **v039 = next free**.

---

## 3. NEW OPEN BUG (file a task): intro photo upload lost — key persisted, object never landed

User uploaded a profile intro photo during this session (consent stamp `2026-08-07T00:32Z`), then
found the Edit Profile photo thumb broken. Verified end-to-end:
- `user_settings.intro_photo_key.9fa7378c` = `dev/users/3ed03fb5.../profiles/9fa7378c/intro/66b98be0226a4c52b82a4ead6b1cb529.png`
- HAR (`Downloads/localhost.har`): presigned GET for that key → **404** (`ERR_BLOCKED_BY_ORB` is just
  Chrome masking the opaque img error).
- R2 `list_objects` under the `intro/` prefix: newest object is **2026-08-04**; today's object never
  arrived. (The Aug-4 2.2MB `5c8b0ffd...png` is the user's earlier upload and still exists.)

So the upload path **persisted the key without proving the object landed** — the T4310 rule
("a write path must prove its copy is current, or fail loudly") violated on the photo-upload side.
Root-cause in `profiles.py` photo upload (+ `set_intro_photo_key` in `user_db.py`): the object PUT
must succeed BEFORE the key write, and a PUT failure must surface to the user, never silently.
Note the upload happened while multi-container sync conflicts were active — but object PUTs are
independent of DB sync, so a frozen DB sync does NOT explain a missing object. User impact: they
must re-upload once fixed. **Do not "heal" by pointing the key at the Aug-4 object** — different photo.

---

## 4. INFRA FACTS ESTABLISHED TODAY (memory has details; do not re-derive)

- **"Video failed to load / head fetch threw" on container ports was R2 bucket CORS** — the bucket
  allowlist lacked 5174-5176. **FIXED (persistent)**: added via boto3 `put_bucket_cors`
  (root `.env`, `R2_ENDPOINT`/`R2_BUCKET`, `region_name='auto'` required). Two wrong theories cost
  a round each (zombie Vite; stale SW). The user's `/logdump` console dump solved it in one look:
  presigned r2.cloudflarestorage.com fetch + "No ftyp box" + successful `/stream` fallback behind a
  stuck error overlay. **Ask for logs EARLY.** Memory: `project_container_ports_r2_cors`.
- **Multi-container QA on one dev account ⇒ recurring `stale_baseline` CAS freezes** (each backend
  advances R2 behind the others). Recovery: kill backend, `rm -rf /workspace/user_data/<user_id>`,
  restart, re-login (fresh pull). Recurs while any other container writes.
- **esbuild strips comments** — verifying served code by grepping a comment ALWAYS returns 0; grep a
  real code token. Vite watcher is broken in containers: restart Vite after edits, then curl-verify,
  then tell the user to hard-reload (PWA SW caches aggressively).
- **Worker deaths:** premature-yield ("I'll wait for the notification") hit TWICE more — a headless
  worker gets no notifications; resume with a nudge that says run-foreground-redirected. Kill sweeps
  via /proc must use a split pattern (`PAT="cla""ude"`) or they kill your own exec shell (exit 137).
- **Backends/Vite in containers must bind 0.0.0.0** — localhost-bound servers are invisible through
  the port mapping (hit this twice: Vite AND uvicorn).
- dev-login recipe (works on any container port): POST `/api/auth/dev-login`
  `{"email":"imankh@gmail.com"}` → real account, real R2 data. Writes are real dev writes.

---

## 5. USER DECISIONS THIS SESSION (do not relitigate)

| Decision | Value |
|---|---|
| Overlay text model | REGIONS (time spans) contain ELEMENTS; region selected → all its elements accessible |
| Text management | In the Text tab (list + add/remove + per-element settings); in-lane Add button rejected; lane = timing only |
| Text positioning | 3×3 preset grid (top/center/bottom × left/middle/right) + per-element alignment; stage free-drag removed |
| Overlay tabs | Overlay (default) / Text / Thumbnail; Thumbnail tab is DISPLAY-ONLY (shows the chosen thumbnail) |
| "Thumbnail" | Canonical user-facing term (was preview image/cover photo) |
| Thumbnail marker | TOP of timeline, draggable; solve occlusion at the top, never relocate lower |
| Layer z-order | Text above spotlight/tracking, like every editor |
| Cards: naming | Auto-names "Intro Card N", lowest free N; rename inline in breadcrumb |
| Cards: default | FIRST card auto-defaults; badge (derived) marks it; set-as-default on others; ALWAYS exactly one default while cards exist; delete auto-promotes (supervisor picked newest; reversible) |
| Duration gating | Already exists (T5215 v037 `intro_min_duration_seconds`, default 20s) — do NOT build a second setting |
| Picker commit | SELECT → animation preview → explicit OK commits; no commit-on-click |
| Merge policy | Only noteless branches; the user tests each round on container ports first |

---

## 6. NEXT SESSION, IN ORDER

1. **Wait/verify quota reset (04:50 UTC)**, re-seed creds if needed, then resume **max 2 workers**:
   T6630 (finish round-4 QA + the error-overlay-clear addendum) and T5215 (round 3). T6640 is done
   pending user verdict — do not resume it without notes.
2. **User tests :5174 (T6640 round 2)** — collision on Mehdi's exact card, rename, defaults. If
   noteless → push container commits → Branch CI → user merges.
3. When T6630/T5215 rounds land: restart Vite, curl-verify a code token, THEN hand the user links.
4. **File the photo-upload bug (§3)** as a task; fix is upload-path ordering + loud failure.
5. At merges: the `is_default` contract check (T6640 writer ↔ T5215 resolver), migration order
   v037/v038 (both fresh-DB DDL + migration files), and delete-merged-branches hygiene.
6. Longer horizon: **T5220 (prepend at egress) is still the epic's missing end** — nothing the user
   built today plays anywhere until it ships. T6460 (CI cancel-on-push) remains open.

**Kickoff prompt for a fresh session:**
> Read docs/plans/tasks/player-intro/SESSION-HANDOFF-2026-08-07.md and continue driving the
> subagents. Respect the quota ceiling (2 workers max), poll workers' last messages before
> trusting silence, and hand the user test links only after curl-verifying served code.
