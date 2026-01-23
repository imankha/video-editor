# Task 13: Production DNS & SSL Setup

## Overview
Configure custom domains for production deployment.

## Owner
**User** - Requires domain registrar and Cloudflare dashboard access

## Prerequisites
- Task 11 complete (Backend on Fly.io)
- Task 12 complete (Frontend on Cloudflare Pages)
- Domain registered (reelballers.com)

## Testability
**After this task**: App accessible via custom domains with HTTPS

---

## Domain Structure

| Domain | Points To | Purpose |
|--------|-----------|---------|
| reelballers.com | Cloudflare Pages | Landing page |
| app.reelballers.com | Cloudflare Pages | React app |
| api.reelballers.com | Fly.io | FastAPI backend |

---

## Steps

### 1. Add Domain to Cloudflare (if not already)

1. Go to Cloudflare Dashboard
2. Click "Add a Site"
3. Enter `reelballers.com`
4. Select Free plan
5. Update nameservers at your registrar

### 2. Configure Frontend Domain (Cloudflare Pages)

1. Go to Pages → reel-ballers-app → Custom domains
2. Click "Set up a custom domain"
3. Enter `app.reelballers.com`
4. Cloudflare auto-creates DNS record (CNAME to pages.dev)
5. SSL certificate is automatic

### 3. Configure Landing Page Domain

Same process for `reelballers.com`:
1. Pages → your-landing-project → Custom domains
2. Add `reelballers.com`

### 4. Configure API Domain (Fly.io)

```bash
# Add certificate to Fly.io
cd src/backend
fly certs add api.reelballers.com
```

Then in Cloudflare DNS:

| Type | Name | Content | Proxy |
|------|------|---------|-------|
| CNAME | api | reel-ballers-api.fly.dev | DNS only (gray cloud) |

**Important**: Use "DNS only" (gray cloud) for Fly.io - don't proxy through Cloudflare.

### 5. Verify SSL

```bash
# Check frontend
curl -I https://app.reelballers.com

# Check API
curl -I https://api.reelballers.com/api/health
```

Both should return `HTTP/2 200` with valid SSL.

---

## DNS Records Summary

| Type | Name | Content | Proxy Status |
|------|------|---------|--------------|
| CNAME | @ | your-landing.pages.dev | Proxied (orange) |
| CNAME | app | reel-ballers-app.pages.dev | Proxied (orange) |
| CNAME | api | reel-ballers-api.fly.dev | DNS only (gray) |

---

## CORS Configuration

Update FastAPI backend to allow the new domains:

```python
# src/backend/app/main.py
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",           # Local dev
        "http://localhost:4173",           # Local preview
        "https://app.reelballers.com",     # Production
        "https://reelballers.com",         # Landing
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

Redeploy after updating:
```bash
cd src/backend && fly deploy
```

---

## Deliverables

| Item | Description |
|------|-------------|
| app.reelballers.com | Points to Cloudflare Pages |
| api.reelballers.com | Points to Fly.io |
| SSL certificates | Valid on all domains |
| CORS updated | Backend allows production origins |

---

## Troubleshooting

### "SSL certificate pending"
- Wait up to 24 hours for propagation
- Check DNS is correctly configured

### "API CORS error"
- Verify origin is in allow_origins list
- Check for trailing slashes
- Redeploy backend after CORS changes

### "DNS not resolving"
- Verify nameservers are Cloudflare's
- Check DNS records in Cloudflare dashboard
- Use `dig` or `nslookup` to debug

### "Mixed content warning"
- Ensure all URLs use HTTPS
- Check API_BASE_URL in frontend config
- Look for hardcoded HTTP URLs

---

## Cost

| Item | Cost |
|------|------|
| Cloudflare DNS | Free |
| Cloudflare SSL | Free |
| Fly.io SSL | Free |
| Domain registration | ~$10-15/year (varies) |
