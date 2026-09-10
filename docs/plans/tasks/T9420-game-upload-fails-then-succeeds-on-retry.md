# T9420: Game upload fails at ~15% ("Failed to fetch"), succeeds on retry

**Status:** WIP
**Impact:** 8
**Complexity:** 5
**Created:** 2026-09-10
**Updated:** 2026-09-10

## Source

2026-09-09/10 first-time-parent walkthrough of **staging** (`reel-ballers-staging.pages.dev`),
run in a Codex in-app desktop browser, plus Andrew's supplied feedback and screenshots.
Handoff archive: `C:/Users/imank/Documents/Codex/2026-09-09/can/outputs/reelballers-engineering-handoff`
(`05-engineering-handoff.md`, bugs `01-bugs.html`, UX specs `04-ux-change-specifications.html`,
naming `03-naming-consistency.html`). Handoff item(s): **B1, UX-04 (handoff E3-01)**.

The walkthrough uploaded `wcfc-carlsbad-trimmed.mp4` (45.8 MB, 1:29), saved two rated/tagged
plays (0:03-0:09 Control/Pass, 0:13-0:19 Dribble), framed and rendered a six-second highlight,
applied a spotlight and saved a private draft. Balance moved 88 -> 79 credits. No purchase,
invite or publication was performed, so publish/link-access behavior is UNVERIFIED, not proven
working. No source-code or network diagnosis was done by the reporter: every claim below is an
observation, and the mechanism is ours to establish.

## Problem

Add Game -> pick `wcfc-carlsbad-trimmed.mp4` (45.8 MB) -> enter opponent -> Add Game. The local
preview appeared, upload reached **Hash complete / 15%**, then reported **Failed to fetch**.
**Retry succeeded**, two credits were charged, and no duplicate charge was observed.

**Observed once. There is no saved screenshot of the original error** - later screenshots must not
be treated as evidence of it. Do not assume CORS, and do not assume a backend cause.

## Why this matters beyond the one occurrence

An intermittent first-upload failure sits directly on the activation cliff. The upload-integrity
family is well-trodden here: T8160 (R2 `UploadId` unstable across `ListMultipartUploads` calls,
which caused the 2026-08-30 prod upload outage), the Upload Failure Integrity epic, and T8150
(durable-sync missing on `activate_game`/`create_game`). **Check whether this is a survivor of that
family before treating it as new** - and check the container/R2 CORS landmine recorded for
multi-container QA on one account.

## Solution

1. Reproduce with the supplied file against staging. Capture the failing request: URL, status,
   timing, and whether the failure is at the R2 leg or our API leg.
2. Establish the cause. Only then fix.
3. Prove retry idempotency: one game, one charge, one R2 object. A retry after an ambiguous failure
   must not create a second game or a second debit.
4. Reconcile the success state: "Saved" is displayed only after the server acknowledges persistence.

## Context

### Relevant Files
- `src/frontend/src/hooks/useUpload.js` (confirm actual name) and the Add Game modal
- `src/backend/app/routers/games.py` - `create_game` / `activate_game`
- `src/backend/app/services/storage.py` - multipart upload, CAS
- `.claude/knowledge/persistence-sync.md` - CAS / SyncResult section

### Related Tasks
- T9430 - the upload state machine and failure UX (this task is the diagnosis half)
- T8150, T8160 - the prior upload-integrity work this must be checked against

### Technical Notes
"Hash complete / 15%" is `Computing hash` progress copy; N37 renames that surface, owned by T9540.
Keep the diagnosis independent of the rename.

## Acceptance Criteria

- [ ] The failing request is captured and the cause established, or the task closes with the tested conditions recorded and what evidence is still needed
- [ ] A simulated failure retains the selected file, name and metadata
- [ ] Retry yields exactly one game and one valid charge
- [ ] Saved is displayed only after successful persistence
- [ ] Relevant test set (curated ~10, per CLAUDE.md Test Scope Policy) green, with output attached
- [ ] Branch CI green
