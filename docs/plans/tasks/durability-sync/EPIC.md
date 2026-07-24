# Durability & Sync Hardening Epic

**Status:** TOP PRIORITY (escalated 2026-07-17)
**Started:** -
**Completed:** -
**Source:** [Code quality audit 2026-07-03](../../audit-2026-07-03-code-quality.md) items B2, B3, B5, B6, B7, B8, C8, G1, G3

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
> **Sequence:** T4320 first (prod-proven, complexity 3, no design gate) → T4310 + T4400 (both
> Impact 9, need the Architect design gate) → T4330/T4340/T4350/T4360 + T2260. Sequenced campaign
> with design approvals, NOT a parallel fan-out (these share db_sync.py/overlay.py/segments_data).

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

Every user write becomes durable and conflict-safe, and persistence loses its timing dependencies. Directives: [SYNC] + [DEP].

The gesture-based persistence model is solid at the frontend layer (T350/T3800/T4020 lessons hold). The remaining risk is below it:
- **Conflict detection is compiled out.** Every production R2 upload passes `skip_version_check=True` — cross-machine last-write-wins on a user's entire profile DB.
- **Durability windows.** Clip-creating gestures ride a deferrable fire-and-forget sync (0.5s lock timeout → `.sync_pending` marker); a machine replacement loses whole annotation sessions the user saw success toasts for. `user.sqlite` isn't in the shutdown sync at all.
- **Ordering by accident.** Action endpoints are atomic only because there's no `await` between read and commit; in-flight gesture POSTs can reorder on the network; `segments_data` exists in two formats depending on which path wrote it.

## Shared design decisions

1. **Conflict detection returns as CAS, applied first where latency doesn't matter** (background/worker syncs), then request-path. Never re-introduce the T2720 blocking-sync regression — ordering changes only, no new locks on the request path.
2. **One action client** (`api/actionClient.js`) serves framing + overlay: per-entity FIFO serialization (a gesture's POST awaits the previous one), `expected_version` on every action, one error/retry taxonomy. The backend 409 path is already scaffolded (overlay.py:384-391, commented out) — implement it, don't redesign it.
3. **Canonical formats at write time, not read time.** `segments_data` is canonicalized when written; readers stop defensively normalizing.
4. **Invariants become code.** Orderings that today live in comments (games activation sequencing, no-await RMW atomicity) become `BEGIN IMMEDIATE` transactions + tests that fail loudly if broken.

## Tasks (mostly independent — implementable in any order except T4330 before its frontend consumers rely on 409s)

| ID | Task | Status |
|----|------|--------|
| T4310 | [R2 Version-Conflict Detection (CAS) — upload side](T4310-r2-version-conflict-detection.md) | TODO |
| T4315 | [Restore-on-staleness — local copy not authoritative forever (restore side)](T4315-local-authoritative-restore-staleness.md) | TODO |
| T4320 | [Durable Sync for Clip-Creating Gestures](T4320-durable-clip-gestures.md) | DONE |
| T4330 | [Unified Action Client: Serialization + Versioning + 409](T4330-action-client-serialization-conflicts.md) | TODO |
| T4340 | [Canonicalize segments_data at Write Time](T4340-canonicalize-segments-at-write.md) | TODO |
| T4350 | [Re-Export Must Re-Transform Carried-Forward Highlights](T4350-reexport-retransform-highlights.md) | TODO |
| T4360 | [Explicit Orderings: BEGIN IMMEDIATE + Invariant Tests](T4360-explicit-orderings-invariants.md) | TODO |

## Completion Criteria

- [ ] No production R2 upload path silently last-write-wins
- [ ] No machine serves a stale local DB as authoritative after R2 has a newer version (T4315 restore-if-newer)
- [ ] No write path force-pushes a stale/unconfirmed copy — refresh-or-fail is the rule, not a per-caller guard
- [ ] A clip save (and an admin credit grant) that returned success survives a machine replacement
- [ ] Two concurrent tabs/gestures cannot silently lose an edit (409 + retry UX instead)
- [ ] `segments_data` has one on-disk format; readers don't canonicalize
- [ ] CLAUDE.md persistence doctrine gains the completion rule: a write path proves its copy is current or fails loudly
- [ ] Backend import check + full backend tests green after each task
