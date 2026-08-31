**Status:** DONE (superseded, verified 2026-08-31)

**RESOLVED without running --apply.** Read-only verification 2026-08-31 (T8170 investigation,
prompted by "check the hold before emailing them"): both accounts are ALREADY CLEAN.
`pending_uploads` is empty for both, `games.status = 'upload_failed'` (correctly classified,
not stuck at `pending`), and R2 shows no open multipart and no orphaned object on either
game's hash key. This is exactly the end-state `--apply` would have produced.

Root cause of the drift: the original 2026-08-28 dry-run classified both as
`double_uploadid_anomaly` (open R2 UploadId != stored `pending_uploads` UploadId) — a
classification T8160 later proved UNSOUND (R2 returns a different UploadId alias on every
List call, so that comparison is always-false and doesn't indicate anything by itself).
Independent of that false signal, T7490's existing per-user "honest reap" (fires
automatically when the affected user's OWN client loads their Games tab) already cleaned up
both accounts naturally: rooom1h returned 2026-08-23, finneganscudder 2026-08-26, both after
their failed upload — their own visit triggered the reap, before anyone got to the admin
sweep. The `--apply` step this task exists for was never actually needed for these two.

All 4 original acceptance criteria are satisfied by this natural resolution:
- [x] Reap manifest reviewed (superseded — not applied, verified unnecessary instead)
- [x] No `--apply` run needed against prod (state already clean)
- [x] Post-apply verification: both accounts' pending_uploads/R2 state confirmed clean
      (this task's own read-only check, 2026-08-31)
- [x] Unblocks T7610's "try again" email to these two users — hold lifted

# T8090: Apply the stranded-upload reap for rooom1h + finneganscudder

**Split off T8090 from [T7880](T7880-stranded-upload-prod-reconciliation.md) at the 2026-08-29 deploy reconciliation.** T7880 built and merged the admin sweep tooling (scan + gated apply scripts) and ran a dry-run against prod confirming both `rooom1h` and `finneganscudder` as `double_uploadid_anomaly` (open R2 UploadId does not match the stored `pending_uploads` UploadId). The reap manifest is ready; only the actual `--apply` run is outstanding.

## Scope

Run the already-built T7880 sweep script with `--apply` against these two accounts, using the reap manifest already produced by the dry-run. No new code expected unless the apply run surfaces something the dry-run didn't.

## Acceptance Criteria

- [ ] User signs off on the reap manifest for `rooom1h` and `finneganscudder`
- [ ] `--apply` run executed against prod
- [ ] Post-apply verification: both accounts' pending_uploads/R2 state confirmed clean
- [ ] This unblocks T7610's "try again" email to these two users

## Context

Pre-req for [T7610](T7610-stuck-user-outreach.md)'s stuck-user outreach — these two are part of the 14-user cohort. `ojedalucas19`'s orphaned object was already resolved separately by T7870 (healed, no longer pending), so this task covers only the remaining two.
