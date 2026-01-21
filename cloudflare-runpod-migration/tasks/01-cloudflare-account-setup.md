# Task 01: Cloudflare Account Setup

## Overview
Create a Cloudflare account and enable the required services for the migration.

## Owner
**User** - Requires account creation and billing setup

## Prerequisites
- None (this is the first task)

## Time Estimate
20 minutes

---

## Architecture Note

| Data Type | Storage | Dashboard Setup? |
|-----------|---------|------------------|
| Per-user data (projects, clips) | Durable Objects + SQLite | No - created via code |
| Shared data (job queue, billing) | D1 | Optional - can create later |
| Video files | R2 | Yes - create bucket |

**Durable Objects don't require dashboard setup** - they're created automatically when your Worker code references them. Each user gets their own DO with embedded SQLite.

---

## Steps

### 1. Create Cloudflare Account
1. Go to https://dash.cloudflare.com/sign-up
2. Create account with email/password
3. Verify email

### 2. Upgrade to Workers Paid Plan
1. Go to **Workers & Pages** in the sidebar
2. Click **Plans** tab
3. Select **Workers Paid** ($5/month)
   - This unlocks: Durable Objects, higher limits

**Why Paid?** Free tier doesn't include Durable Objects, which we need for per-user SQLite databases and WebSocket connections.

### 3. Enable R2 Storage
1. Go to **R2** in the sidebar
2. Click **Create bucket**
3. Name: `reel-ballers-users`
4. Location: **Automatic**
5. Click **Create bucket**

### 4. Create API Token for Wrangler
1. Go to **My Profile** (top right) → **API Tokens**
2. Click **Create Token**
3. Use template: **Edit Cloudflare Workers**
4. Permissions should include:
   - Account: Workers Scripts: Edit
   - Account: Workers KV Storage: Edit
   - Account: Workers R2 Storage: Edit
5. Click **Continue to summary** → **Create Token**
6. **Copy the token immediately** (shown only once)

```
API Token: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx  ← Save this!
```

### 5. Install Wrangler CLI
```bash
npm install -g wrangler

# Login with your token
wrangler login
# OR set token directly
export CLOUDFLARE_API_TOKEN=your_token_here
```

### 6. Verify Setup
```bash
# Check authentication
wrangler whoami

# List R2 buckets
wrangler r2 bucket list
```

---

## Deliverables

After completing this task, you should have:

| Item | Example | Where to Save |
|------|---------|---------------|
| Cloudflare Account | user@example.com | Password manager |
| Workers Paid Plan | Active | Dashboard shows "Paid" |
| R2 Bucket Name | `reel-ballers-users` | Share with Claude for Task 04 |
| API Token | `xxxxx...` | `~/.wrangler/config/default.toml` or env var |
| Wrangler CLI | `wrangler whoami` works | Installed globally |

---

## Handoff Notes

**For Task 02 (Workers Project Setup):**
- Provide the R2 Bucket Name
- Confirm wrangler CLI is working (`wrangler whoami`)

**For Task 03 (Durable Objects + SQLite):**
- No dashboard setup needed - DOs are created via code
- Your local SQLite schema will be replicated in each user's DO

**For Task 04 (R2 Bucket Setup):**
- R2 bucket should exist but CORS not yet configured

---

## Troubleshooting

### "You need to enable Workers Paid"
Make sure you upgraded from the free plan. Durable Objects require paid.

### Wrangler login issues
Try setting the token directly:
```bash
export CLOUDFLARE_API_TOKEN=your_token_here
wrangler whoami
```

---

## Cost After This Task

| Service | Monthly Cost |
|---------|--------------|
| Workers Paid | $5.00 |
| R2 | $0.00 (until you store data) |
| Durable Objects | $0.00 (pay per request/storage) |
| **Total** | **$5.00** |
