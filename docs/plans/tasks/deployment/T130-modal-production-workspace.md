# T130: Modal Production Workspace

**Status:** TODO
**Priority:** HIGH
**Complexity:** MEDIUM
**Created:** 2026-02-09

## Problem

Modal GPU jobs currently run in development workspace. For production deployment, need a separate Modal workspace with proper configuration, secrets, and resource limits.

## Acceptance Criteria

- [ ] Production Modal workspace created
- [ ] GPU functions deployed to production workspace (framing, overlay, detection)
- [ ] Production secrets configured (R2 credentials, API keys)
- [ ] Backend can switch between dev/prod Modal workspaces via environment
- [ ] Production Modal endpoints working with Fly.io backend
- [ ] Cost monitoring/alerting configured

## Context

Currently Modal functions are deployed via:
- `src/backend/modal_app/` - GPU function definitions
- Development workspace used for all environments

For production, need:
- Separate workspace for isolation
- Production-specific secrets
- Resource limits and scaling policies
- Cost visibility

## Implementation Notes

### Modal Workspace Setup
```
1. Create new Modal workspace (e.g., "reelballers-prod")
2. Configure secrets:
   - R2_ACCESS_KEY_ID
   - R2_SECRET_ACCESS_KEY
   - R2_BUCKET_NAME
   - R2_ENDPOINT_URL
3. Deploy functions to production workspace
```

### Backend Environment Switch
```python
# Environment variable to select workspace
MODAL_WORKSPACE = os.getenv("MODAL_WORKSPACE", "development")

# Function lookup should use appropriate workspace
```

### Deployment Flow
```
Development:
  Local backend → dev Modal workspace

Production (Fly.io):
  Fly.io backend → prod Modal workspace
```

## Dependencies

- T100: Fly.io Backend (prod backend needs to exist first)

## Related

- [Deployment Epic](EPIC.md)
- `src/backend/modal_app/` - Modal function definitions
- `src/backend/app/services/modal_service.py` - Modal client code
