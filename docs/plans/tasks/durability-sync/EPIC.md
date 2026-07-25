# Durable Sync — No Silent Data Loss (Epic)

**Status:** TOP PRIORITY (escalated 2026-07-17; re-escalated + narrowed 2026-07-24)
**Started:** -
**Completed:** -
**Source:** [Code quality audit 2026-07-03](../../audit-2026-07-03-code-quality.md) items B2, B3
**Scope note (2026-07-24):** narrowed to the SILENT-DATA-LOSS class only. The format /
concurrency / atomicity tasks that were bundled here (T4330/T4340/T4350/T4360) moved to the
lower-priority [Write Correctness & Concurrency epic](../write-correctness/EPIC.md) — they are
real bugs but none silently destroys committed data across a machine cycle.

> **Escalation (2026-07-17):** T5310 proved this epic's failure mode is LIVE ON PROD — arshia lost
> 2 profiles to a create-without-durable-sync race (same class as T4320). This epic is now the top
> priority. The campaign extends beyond these 6 tasks to same-class siblings in other epics —
> coordinate them as one push:
> - **T4400** (export-write-path epic) — backend-authoritative export; client full-state PUT
>   clobbers newer surgical edits, multi-clip stamps DB "exported" without reconciling (DB≠video).
>   Impact 9, Architect gate.
> - **T2260** (session-scaling epic) — data-loss detection + recovery on reconnect after a crash.
> - **T5310 source-fix** — `POST /api/profiles` create must durably sync the new profile.sqlite
>   before returning (the exact bug that lost arshia's profiles). **Fold into T4320** — same
>   `Depends(durable_sync)` mechanism, same file family.
>
> **Sequence (this epic):** T4320 (DONE) → **T4310 + T4315 together** (the CAS/restore interlock;
> both need the Architect design gate) → T5840 (credits→Postgres, removes money from the surface)
> alongside sibling **T4400** (backend-authoritative export). The moved-out correctness tasks
> (T4330/T4340/T4350/T4360) and T2260 follow in the lower-priority
> [Write Correctness epic](../write-correctness/EPIC.md). Sequenced with design approvals, NOT a
> parallel fan-out (T4310/T4315 share db_sync.py/storage.py/materialization.py).

> **Re-escalation (2026-07-24): this fires on a SINGLE server — the "deferred until multi-server"
> framing is partly wrong.** arshia lost a 400-credit grant AND 5 published reels the same day,
> both to this epic's core failure (force-push of a stale/partial local snapshot over good R2
> state). Neither needed two live machines. Two single-server mechanisms:
> - **Machine replacement on deploy.** A write that lives only on the local volume (here: an
>   admin credit grant the middleware never uploaded) dies when the next deploy swaps the machine
>   and the fresh volume pulls the R2 copy that never saw it. `ensure_user_database` only restores
>   `user.sqlite` when `local_version is None`, so the local copy is authoritative for the process
>   lifetime and out-of-band R2 repair is impossible while a session is live.
> - **R2-error force-push of a stale local.** `move_reels` resolved the target profile through a
>   read-optimized helper that returns the stale local copy on an R2 blip, then force-pushed
>   `[stale + new row]`, reverting the profile and silently deleting reels moved earlier (the
>   reverted `sqlite_sequence` even let the next insert reuse the freed id, hiding the loss).
>
> **Landed point-fixes 2026-07-24 (branch `fix/admin-credit-grant-r2-sync`; do NOT re-solve — the
> tasks below generalize them):**
> - **fec38d12 / e1e324ac** — admin credit writes now sync the GRANTEE's `user.sqlite` and refresh
>   it before granting (`_refresh_target_user_db`); sync failure surfaced in the admin UI.
> - **b9302790** — `TrackedConnection` records `owner_user_id`/`owner_profile_id`; the middleware
>   syncs every DB a request wrote, not just the session user's. Retires the per-call-site patching
>   (this gap had already been patched twice: T4940 webhook, then admin). Remainder: raw
>   `_open_profile_db` connections are still untracked.
> - **a5ff3e48** — `move_reels` refuses to write into an unconfirmed target (`require_fresh` →
>   `ProfileDBRefreshFailed`); also closes the empty-DB force-push that could wipe a whole profile.
>   The 5 lost reels were recovered out-of-band (rows re-inserted from authoritative source data).
>
> **New tasks from this incident:**
> - **T4315** — the RESTORE-side sibling of T4310: stop the local copy being authoritative forever
>   (`user.sqlite` restore-if-newer; generalize `require_fresh` to all write paths). CAS (T4310) +
>   restore-if-newer (T4315) must interlock — neither alone closes the loop.
> - **T5840** (standalone, design-gated, NOT in this epic) — move credits/ledger/reservations to
>   Postgres. A money balance does not belong in a last-write-wins blob; this removes the highest-
>   stakes data from the risky path entirely and gives grants real idempotency + atomic deduction.
>
> **Doctrine gap:** CLAUDE.md's persistence rules govern *what triggers* a write (gesture-based,
> surgical, never reactive) but say nothing about *whether the write lands safely*. Add a fourth
> rule on completion: **a write path must prove its copy is current, or fail loudly** — the
> guarantee the sanctioned read-modify-write pattern silently assumed and never required.

## Goal

A committed user write is never silently destroyed — not by a machine replacement, an R2 error,
or a stale local snapshot force-pushing over newer cloud state. This is the class that has twice
lost real prod data.

The gesture-based persistence model is solid at the frontend layer (T350/T3800/T4020 lessons
hold). The loss happens below it, in the R2 replication of per-user SQLite:
- **Conflict detection is compiled out.** Every production R2 upload passes
  `skip_version_check=True` — last-write-wins on a user's entire profile DB. Bites cross-machine
  AND single-machine (a stale writer racing R2's own newer state — the move_reels clobber).
- **The local copy is authoritative forever.** `ensure_user_database` restores `user.sqlite` from
  R2 only when `local_version is None`, so once a machine has the file it never re-pulls — a
  deploy that replaces the machine pulls a stale R2 copy and destroys anything that lived only
  locally (the 400-credit grant).
- **Durability windows.** Clip-creating gestures rode a deferrable fire-and-forget sync
  (addressed by T4320, DONE); `user.sqlite` still isn't fully covered.

## Shared design decisions

1. **Conflict detection returns as CAS, applied first where latency doesn't matter**
   (background/worker syncs), then request-path. Never re-introduce the T2720 blocking-sync
   regression — ordering changes only, no new locks on the request path.
2. **Restore-if-newer, not restore-if-absent, on write paths.** A machine must confirm it holds
   the current copy before mutating it, or fail loudly (`require_fresh` / `ProfileDBRefreshFailed`
   pattern, already landed for move_reels).
3. **CAS (upload) and restore-if-newer (read) interlock.** Neither alone closes the loop: CAS
   alone still serves stale reads; restore-if-newer alone still races the upload.

## Tasks

| ID | Task | Status |
|----|------|--------|
| T4310 | [R2 Version-Conflict Detection (CAS) — upload side](T4310-r2-version-conflict-detection.md) | TODO |
| T4315 | [Restore-on-staleness — local copy not authoritative forever (restore side)](T4315-local-authoritative-restore-staleness.md) | TODO |
| T4320 | [Durable Sync for Clip-Creating Gestures](T4320-durable-clip-gestures.md) | DONE |

**Sibling in another epic:** T5840 (standalone, design-gated) — move credits to Postgres, so the
highest-stakes data leaves this risk surface entirely.

**Moved out (2026-07-24) to [Write Correctness & Concurrency](../write-correctness/EPIC.md):**
T4330 (concurrent-tab conflicts), T4340 (segments format), T4350 (re-export transform), T4360
(atomic orderings). Real bugs, different class, lower priority.

## Completion Criteria

- [ ] No production R2 upload path silently last-write-wins (T4310)
- [ ] No machine serves a stale local DB as authoritative after R2 has a newer version (T4315)
- [ ] No write path force-pushes a stale/unconfirmed copy — refresh-or-fail is the rule, not a per-caller guard
- [ ] A clip save (and an admin credit grant) that returned success survives a machine replacement
- [ ] CLAUDE.md persistence doctrine gains the completion rule: a write path proves its copy is current or fails loudly
- [ ] Backend import check + full backend tests green after each task
