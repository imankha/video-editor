# Deployment Epic

**Status:** TODO
**Started:** -
**Completed:** -

## Goal

Deploy the video editor to production: backend on Fly.io, frontend on Cloudflare Pages, with proper DNS and SSL.

## Prerequisites

- Core app functionality stable
- Modal integration complete (DONE)
- R2 storage working (DONE)

## Tasks

| ID | Task | Status |
|----|------|--------|
| T100 | [Fly.io Backend](T100-flyio-backend.md) | TODO |
| T110 | [Cloudflare Pages Frontend](T110-cloudflare-pages.md) | TODO |
| T120 | [DNS & SSL Setup](T120-dns-ssl.md) | TODO |
| T130 | [Modal Production Workspace](T130-modal-production-workspace.md) | TODO |

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
