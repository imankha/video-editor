# Deployment Epic

**Status:** IN_PROGRESS
**Started:** 2026-02-01
**Completed:** -

## Goal

Deploy the video editor to production: backend on Fly.io, frontend on Cloudflare Pages, with proper DNS and SSL.

## Prerequisites

- Core app functionality stable
- Modal integration complete (DONE)
- R2 storage working (DONE)

## Tasks

### Phase 1: Staging Infrastructure

| ID | Task | Status |
|----|------|--------|
| T100 | [Fly.io Backend](T100-flyio-backend.md) | TESTING |
| T110 | [Cloudflare Pages Frontend](T110-cloudflare-pages.md) | TESTING |
| T125 | [CI/CD Auto-Deploy](T125-cicd-auto-deploy.md) | TESTING |
| T126 | [Fly.io Suspend + Graceful Shutdown](T126-flyio-suspend-graceful-shutdown.md) | TODO |
| T127 | [R2 Database Restore on Startup](T127-r2-database-restore-on-startup.md) | TODO |
| T128 | [WebSocket Reconnection Resilience](T128-websocket-reconnection-resilience.md) | TODO |

### Phase 2: Staging Features

| ID | Task | Status |
|----|------|--------|
| T200 | User Management | TODO |
| T210 | Wallet & Payments | TODO |

### Phase 3: Production Infrastructure

| ID | Task | Status |
|----|------|--------|
| T105 | [Production Backend Scaling](T105-production-backend-scaling.md) | TODO |
| T115 | [Cloudflare Pages Production](T115-cloudflare-pages-production.md) | TODO |
| T120 | [DNS & SSL Setup](T120-dns-ssl.md) | TODO |

## Architecture

```
Production:
┌─────────────────┐     ┌─────────────────┐     ┌─────────────┐
│ Frontend        │────►│ FastAPI         │────►│ R2 Storage  │
│ (CF Pages)      │     │ (Fly.io)        │     │ (Cloudflare)│
│ app.reelballers │     │ api.reelballers │     │             │
└─────────────────┘     └────────┬────────┘     └─────────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │ Modal GPU       │
                        └─────────────────┘
```

## Completion Criteria

- [ ] Staging environment works end-to-end
- [ ] Production environment works end-to-end
- [ ] Custom domains configured (app.reelballers.com, api.reelballers.com)
- [ ] SSL certificates active
- [ ] Scale-to-zero working (no idle costs)
- [ ] WebSocket connections work in production
- [ ] Modal production workspace configured with GPU functions deployed
