# T12890: Archive Fly app logs to R2 (self-hosted log shipper + window fetch script)

**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Created:** 2026-10-18
**Updated:** 2026-10-18

## Problem

We cannot look back at production logs. `fly logs --no-tail` returns only Fly's in-memory
buffer: on 2026-10-18 that was 100 lines, about 2 minutes of `reel-ballers-api` traffic.
`fly logs` has no time-range flag, and nothing in the repo archives logs. "Check prod for
errors over the last day" is unanswerable, and every incident investigation starts blind.

The AI also needs logs in a FILE so it can query them through `reduce_log` / `/logdump`
without pulling raw lines into context (CLAUDE.md § Log handling).

## Solution

Self-hosted only (user decision 2026-10-18: no hosted log vendors such as Axiom or Better
Stack). Run Fly's open-source log shipper as its own Fly app and have it write gzipped
NDJSON batches into a dedicated private R2 bucket. Add a local script that downloads an
N-hour window for one app into a single file for `reduce_log`.

```
Fly org log stream (NATS)
   -> reel-ballers-log-shipper (Fly app, Vector)
   -> R2 bucket reelballers-logs  {app}/YYYY/MM/DD/HH/<batch>.ndjson.gz
   -> scripts/fetch_prod_logs.py --app reel-ballers-api --hours 36
   -> one local file -> reduce_log
```

Why this shape:
- R2 is already our storage and has zero egress fees, so pulling a window is free beyond
  storage. Log volume is small, so storage is pennies per month.
- Cloudflare Logpush / Workers Logs do NOT apply: they cover traffic proxied by Cloudflare
  and Workers output, not stdout of a Fly app.
- The hour-partitioned key layout makes any time window a list of hourly prefixes.

## Context

### Relevant Files (REQUIRED)
- `infra/log-shipper/fly.toml` (new) - Fly app config for the shipper (image `ghcr.io/superfly/fly-log-shipper`, pinned tag)
- `infra/log-shipper/vector.toml` (new, only if the image's env-var S3 sink cannot express the R2 settings) - Vector `aws_s3` sink override
- `scripts/fetch_prod_logs.py` (new) - window fetch: `--app`, `--hours` or `--since/--until`, `--out`
- `docs/runbooks/log-archive.md` (new) - setup, secrets, retention, how to query, how to rotate keys
- `CLAUDE.md` § Log handling - one line pointing at the fetch script for historical prod/staging logs
- `.claude/skills/deploy/SKILL.md` line ~296 - "Backend deploy failure" hint can mention the archive

Check first whether the repo already has an infra/ convention for non-app Fly configs; follow it if so.

### Related Tasks
- Depends on: none
- Blocks: nothing hard; makes every future prod incident triage cheaper

### Technical Notes
- **Shipper:** `superfly/fly-log-shipper` subscribes to the org log stream with `ORG` +
  `ACCESS_TOKEN` (a read-only org token, `fly tokens create readonly`). It ships every app in
  the org; key the objects by app name so `reel-ballers-api` and `reel-ballers-api-staging`
  separate cleanly. Filter out the shipper's own logs.
- **R2 as the S3 sink:** Vector `aws_s3` sink with `endpoint = https://<account_id>.r2.cloudflarestorage.com`,
  `region = "auto"`, `compression = "gzip"`, `encoding.codec = "json"` (NDJSON),
  `key_prefix = "{{ fly.app.name }}/%Y/%m/%d/%H/"`. Confirm the image's env var names
  (`S3_BUCKET`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, endpoint override)
  against the shipper README at the pinned tag; R2 compatibility (ACL / storage-class headers)
  is NOT yet proven and is the first thing to smoke-test.
- **Batching:** set batch timeout around 300s (bounded lag) and a disk buffer so a shipper
  restart does not drop the in-flight batch. Delivery is at-least-once; duplicate lines are
  acceptable for debugging. For the last few minutes, `fly logs` remains the live source.
- **Credentials:** two R2 API tokens scoped to `reelballers-logs` only. Write token lives in
  `fly secrets` on the shipper app. Read token lives in the local `src/backend/.env` under
  new names (`R2_LOGS_ACCESS_KEY_ID`, `R2_LOGS_SECRET_ACCESS_KEY`, `R2_LOGS_BUCKET`); reuse
  the existing `R2_ENDPOINT`. Never reuse the app's media-bucket keys. No secrets in the repo
  or workflows.
- **Retention:** R2 lifecycle rule deleting objects older than 30 days.
- **Privacy:** logs carry user ids and request paths. Bucket stays private, no public
  access, no r2.dev URL.
- **Fetch script:** list hourly prefixes covering the window, download, gunzip, filter rows to
  the exact `[since, until)` by timestamp, sort by timestamp, write one file. Default output
  in the session scratchpad. Output the Fly message text plus timestamp/instance/region so
  `reduce_log` collapses it well; `--json` keeps raw NDJSON.
- **No backfill:** history starts when the shipper is deployed.

## Implementation

### Steps
1. [ ] Create `reelballers-logs` bucket, 30-day lifecycle rule, scoped write + read tokens (user does the Cloudflare dashboard clicks; AI writes exact steps)
2. [ ] Smoke test: Vector -> R2 write + read-back of one object from a local run before deploying
3. [ ] `infra/log-shipper` Fly app config with pinned image tag, secrets set via `fly secrets set`
4. [ ] Deploy the shipper; confirm hourly objects appear for both API apps
5. [ ] `scripts/fetch_prod_logs.py` + unit tests for window -> prefix math and timestamp filtering/sorting
6. [ ] Runbook + CLAUDE.md § Log handling pointer

### Progress Log

**2026-10-18**: Filed. Triggered by an attempt to check 36h of prod errors that could only
see ~2 minutes of buffer.

## Acceptance Criteria

- [ ] Shipper running as its own Fly app; restart does not lose an in-flight batch (disk buffer)
- [ ] Objects land under `{app}/YYYY/MM/DD/HH/` for `reel-ballers-api` and `reel-ballers-api-staging`
- [ ] `fetch_prod_logs.py --app reel-ballers-api --hours 36` produces one time-sorted file covering exactly the window that `reduce_log` can query
- [ ] Lifecycle rule verified (rule present in bucket config)
- [ ] Shipper credentials are write-only and scoped to the logs bucket; read credentials are scoped to the logs bucket
- [ ] No hosted log vendor anywhere in the path
- [ ] Unit tests for the fetch script's window/prefix math pass
