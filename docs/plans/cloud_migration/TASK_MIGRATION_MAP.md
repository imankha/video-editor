# Task File Migration Map

This document tracks what content from old task files was migrated to new files.

**Review this before deleting any old files.**

---

## Old Files → New Files Mapping

### OLD: 02-workers-project-setup.md
**Content:**
- wrangler.toml configuration
- package.json for Workers
- tsconfig.json
- src/index.ts skeleton
- src/durable-objects/ExportJobState.ts skeleton
- src/lib/types.ts (ExportJob, CreateJobRequest, CropKeyframe, HighlightRegion, WebSocketMessage interfaces)
- Verification steps (npm install, tsc, wrangler dev)
- Common issues (workers-types module, DO not found, persist flag)

**Migrated to:** `11-workers-project-setup.md`
**Status:** ✅ FULLY CAPTURED - All content incorporated

---

### OLD: 03-r2-user-data-structure.md
**Content:**
- Architecture decision (ALL user data in R2)
- R2 bucket structure mirroring local user_data/
- File types by folder table
- R2 key naming convention
- StorageBackend interface (get, put, delete, list, getSignedUrl, getUploadUrl)
- R2Storage class implementation
- R2SqliteDatabase class with full schema (games, raw_clips, projects, working_clips, highlight_regions, final_videos)
- Request pattern for loading/saving DB
- Performance considerations table
- sql.js dependency note

**Migrated to:** `12-workers-api-routes.md` (Storage Layer section with R2Storage and R2SqliteDatabase implementations)
**Status:** ✅ FULLY CAPTURED - R2SqliteDatabase code added to Workers API routes task

---

### OLD: 04-r2-bucket-setup.md
**Content:**
- R2 bucket structure diagram
- CORS configuration JSON (both dashboard and wrangler CLI methods)
- Public access settings (keep private, use presigned URLs)
- Lifecycle rules for clip_cache
- Testing R2 access (Workers code and wrangler CLI commands)
- Presigned URL strategy (upload and download)
- R2 credentials for RunPod (how to create API token)
- Cost tracking table

**Migrated to:** R2 credentials for RunPod added to `06-runpod-endpoint-setup.md`. CORS and bucket setup is Phase 1 work (already complete).
**Status:** ✅ FULLY CAPTURED - R2 credentials section added to task 06

---

### OLD: 05-durable-objects-job-state.md
**Content:**
- Full ExportJobState DO implementation
- WebSocket handling (handleWebSocket, webSocketMessage, webSocketClose)
- Job state machine (init, status, progress, complete, error endpoints)
- Broadcast to connected clients
- wrangler.toml DO bindings
- Routing from Worker to DO

**Migrated to:** `13-durable-objects-job-state.md`
**Status:** ✅ FULLY CAPTURED - Code structure preserved

---

### OLD: 06-workers-api-routes.md
**Content:**
- Full route implementations:
  - POST /api/jobs (create job)
  - GET /api/jobs/:id (get job)
  - POST /api/videos/upload-url (presigned upload)
  - GET /api/videos/download-url (presigned download)
  - POST /api/jobs/:id/do (RunPod callback)
  - WebSocket /api/jobs/:id/ws
- RunPodClient implementation
- Complete index.ts with routing

**Migrated to:** `12-workers-api-routes.md`
**Status:** ✅ FULLY CAPTURED - Route structure preserved

---

### OLD: 07-runpod-serverless-setup.md
**Content:**
- RunPod account creation steps
- Adding credits
- Creating serverless endpoint (settings table)
- Getting API credentials
- Environment variables for Workers
- RunPod API examples (submit job, check status)
- Job status table
- GPU selection guide with costs
- Test handler code (temporary)
- Cost estimation table
- Troubleshooting section

**Migrated to:** Split between `05-runpod-account-setup.md` and `06-runpod-endpoint-setup.md`
**Status:** ✅ FULLY CAPTURED - Content split appropriately

---

### OLD: 08-gpu-worker-code.md
**Content:**
- Directory structure for gpu-worker/
- Dockerfile (CUDA base, ffmpeg, python dependencies)
- handler.py (RunPod entry point with job routing)
- requirements.txt
- processors/ (overlay.py, framing.py, annotate.py)
- services/r2_client.py (R2Client class)
- services/ffmpeg.py wrapper
- utils/keyframe.py (keyframe interpolation)
- CallbackClient for progress reporting
- Build and deploy commands
- Testing curl command

**Migrated to:** `07-gpu-worker-code.md` (new)
**Status:** ✅ FULLY CAPTURED - Full implementation preserved

---

### OLD: 09-backend-migration.md
**Content:**
- WorkersClient class for backend → Workers communication
- Modified routers to use Workers flag
- Dual mode operation diagram
- USE_WORKERS_EXPORT feature flag approach
- Testing steps for migration
- Rollback plan

**Migrated to:** `14-backend-workers-migration.md`
**Status:** ✅ FULLY CAPTURED

---

### OLD: 10-frontend-migration.md
**Content:**
- Configuration updates (WORKERS_API_URL, WORKERS_WS_URL, USE_CLOUD_EXPORTS)
- Full exportStore.js with:
  - startExport, startCloudExport, startLocalExport
  - connectWebSocket, handleWebSocketMessage, disconnectWebSocket
  - pollJobStatus (fallback)
  - syncWithServer, clearExport, downloadExport
- useExportRecovery hook
- useExportManager hook
- GlobalExportIndicator component
- App.jsx integration
- Testing steps

**Migrated to:** `15-frontend-workers-updates.md`
**Status:** ✅ FULLY CAPTURED

---

### OLD: 11-testing-deployment.md
**Content:**
- Testing phases (Local Integration, Cloudflare Deployment, RunPod Deployment, E2E Production)
- Test case table
- Test scripts (test-job-flow.sh, test-websocket.js)
- Deploy commands (wrangler deploy, d1 migrations, secrets)
- Docker build/push for RunPod
- Monitoring & debugging (Cloudflare dashboard, wrangler tail, RunPod dashboard)
- Rollback procedures
- Performance baseline metrics table
- Cost monitoring setup
- Go-live checklist
- Post-launch plan (Week 1, Week 2-4, Ongoing)

**Migrated to:** `20-deployment-guide.md` (new file with full deployment, monitoring, rollback content)
**Status:** ✅ FULLY CAPTURED - Complete deployment guide created

---

### OLD: 12-wallet-payments.md
**Content:**
- Architecture diagram
- D1 schema (users, wallet, ledger tables)
- Stripe setup steps
- API routes:
  - POST /api/topup (full implementation)
  - POST /api/webhook (full implementation)
  - GET /api/wallet
  - POST /api/debit
- Pricing model table
- Margin calculation
- Frontend components (WalletBalance, startExportWithPayment)
- Environment variables
- Test card numbers
- Webhook testing with Stripe CLI

**Migrated to:** `16-wallet-payments.md`
**Status:** ✅ FULLY CAPTURED - Full API implementations added (topup, webhook, wallet, debit routes + frontend components)

---

### OLD: 13-future-gpu-features.md
**Content:**
- Video Upscaling (models table, API spec, implementation notes)
- Object/Player Tracking YOLO (models table, API spec, use cases)
- Smart Auto-Crop (approach, API spec, smoothing algorithm code)
- Scene Detection (API spec)
- Action Detection (future notes)
- Docker image updates for new dependencies
- Weights management
- Cost summary table
- Implementation priority

**Migrated to:** `19-future-gpu-features.md`
**Status:** ✅ FULLY CAPTURED

---

### OLD: 14-user-management.md
**Content:**
- Architecture options (Single D1 + user_id, DO per user, Hybrid)
- Authentication options (Anonymous, Magic Link, OAuth, Cloudflare Access)
- Recommended path (phases)
- D1 schema for users (users, sessions, login_tokens tables)
- Auth middleware pattern
- R2 multi-tenancy
- Scaling considerations (100K CCU architecture diagram)
- Rate limits table

**Migrated to:** `17-user-management.md`
**Status:** ✅ FULLY CAPTURED - D1 schema, middleware, magic link flow, and scaling architecture added

---

### OLD: 15-do-sqlite-migration.md
**Content:**
- When to migrate triggers
- Architecture change diagram (before/after)
- Migration steps with code:
  - UserDataStore DO class
  - wrangler.toml updates
  - Migration script
  - Updated API routes
- Gradual migration strategy with feature flag
- "Video files stay in R2" section
- Rollback plan
- Cost comparison table

**Migrated to:** `18-do-sqlite-migration.md`
**Status:** ✅ FULLY CAPTURED

---

## Summary

| Old File | Status | New Location |
|----------|--------|--------------|
| 02-workers-project-setup.md | ✅ CAPTURED | 11-workers-project-setup.md |
| 03-r2-user-data-structure.md | ✅ CAPTURED | 12-workers-api-routes.md (Storage Layer) |
| 04-r2-bucket-setup.md | ✅ CAPTURED | 06-runpod-endpoint-setup.md (R2 credentials) |
| 05-durable-objects-job-state.md | ✅ CAPTURED | 13-durable-objects-job-state.md |
| 06-workers-api-routes.md | ✅ CAPTURED | 12-workers-api-routes.md |
| 07-runpod-serverless-setup.md | ✅ CAPTURED | 05 + 06 (split) |
| 08-gpu-worker-code.md | ✅ CAPTURED | 07-gpu-worker-code.md |
| 09-backend-migration.md | ✅ CAPTURED | 14-backend-workers-migration.md |
| 10-frontend-migration.md | ✅ CAPTURED | 15-frontend-workers-updates.md |
| 11-testing-deployment.md | ✅ CAPTURED | 20-deployment-guide.md |
| 12-wallet-payments.md | ✅ CAPTURED | 16-wallet-payments.md (full APIs) |
| 13-future-gpu-features.md | ✅ CAPTURED | 19-future-gpu-features.md |
| 14-user-management.md | ✅ CAPTURED | 17-user-management.md (full schemas) |
| 15-do-sqlite-migration.md | ✅ CAPTURED | 18-do-sqlite-migration.md |

---

## All Old Files Safe to Delete

All content has been fully migrated. The following old files can be safely deleted:

- 02-workers-project-setup.md (→ 11-workers-project-setup.md)
- 03-r2-user-data-structure.md (→ 12-workers-api-routes.md)
- 04-r2-bucket-setup.md (→ 06-runpod-endpoint-setup.md)
- 05-durable-objects-job-state.md (→ 13-durable-objects-job-state.md)
- 06-workers-api-routes.md (→ 12-workers-api-routes.md)
- 07-runpod-serverless-setup.md (→ 05 + 06)
- 08-gpu-worker-code.md (→ 07-gpu-worker-code.md)
- 09-backend-migration.md (→ 14-backend-workers-migration.md)
- 10-frontend-migration.md (→ 15-frontend-workers-updates.md)
- 11-testing-deployment.md (→ 20-deployment-guide.md)
- 12-wallet-payments.md (→ 16-wallet-payments.md)
- 13-future-gpu-features.md (→ 19-future-gpu-features.md)
- 14-user-management.md (→ 17-user-management.md)
- 15-do-sqlite-migration.md (→ 18-do-sqlite-migration.md)
