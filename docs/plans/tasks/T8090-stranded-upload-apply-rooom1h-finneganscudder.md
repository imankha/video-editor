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
