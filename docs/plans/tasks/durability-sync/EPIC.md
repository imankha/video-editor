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
| T4310 | [R2 Version-Conflict Detection (CAS)](T4310-r2-version-conflict-detection.md) | TODO |
| T4320 | [Durable Sync for Clip-Creating Gestures](T4320-durable-clip-gestures.md) | TODO |
| T4330 | [Unified Action Client: Serialization + Versioning + 409](T4330-action-client-serialization-conflicts.md) | TODO |
| T4340 | [Canonicalize segments_data at Write Time](T4340-canonicalize-segments-at-write.md) | TODO |
| T4350 | [Re-Export Must Re-Transform Carried-Forward Highlights](T4350-reexport-retransform-highlights.md) | TODO |
| T4360 | [Explicit Orderings: BEGIN IMMEDIATE + Invariant Tests](T4360-explicit-orderings-invariants.md) | TODO |

## Completion Criteria

- [ ] No production R2 upload path silently last-write-wins
- [ ] A clip save that returned success survives a machine replacement
- [ ] Two concurrent tabs/gestures cannot silently lose an edit (409 + retry UX instead)
- [ ] `segments_data` has one on-disk format; readers don't canonicalize
- [ ] Backend import check + full backend tests green after each task
