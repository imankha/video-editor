# T115: Cloudflare Pages Production

## Overview
Deploy the React frontend to Cloudflare Pages production at `app.reelballers.com`.

**Do this task after:** T200 and T210 tested on staging.

## Prerequisites
- T110 complete (staging frontend working)
- T200 complete (auth working on staging)
- T210 complete (payments working on staging)
- T105 complete (production backend deployed)

## Testability
**After this task**:
- Production: `app.reelballers.com` serves the React app
- API calls go to `api.reelballers.com`

---

## Steps

### 1. Configure Production Build

Update frontend to use production API URL:

```javascript
// src/frontend/src/config.js
export const API_BASE = import.meta.env.PROD
  ? 'https://api.reelballers.com'
  : '';
```

### 2. Create Production Pages Project

Either:
- Add custom domain to existing staging project
- Or create separate production project

```bash
# Option: Add custom domain to existing project
# In Cloudflare Dashboard: Pages > Project > Custom domains > Add
```

### 3. Configure Custom Domain

In Cloudflare Dashboard:
1. Go to Pages > your project
2. Custom domains > Add custom domain
3. Enter `app.reelballers.com`
4. Cloudflare auto-configures DNS (same account)

### 4. Update CORS on Backend

Ensure `api.reelballers.com` allows `app.reelballers.com`:

```python
# main.py
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "https://reel-ballers-staging.pages.dev",
        "https://app.reelballers.com",
    ],
    # ...
)
```

### 5. Test Production

```bash
# Test app loads
curl -I https://app.reelballers.com

# Test API connection
# (open app, check Network tab for successful API calls)
```

---

## Deliverables

| Item | Description |
|------|-------------|
| Production deployment | `app.reelballers.com` |
| API configuration | Points to `api.reelballers.com` |
| CORS configured | Backend allows production origin |
