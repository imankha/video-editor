# Task 01: Cloudflare Account Setup

## Overview
Create a Cloudflare account and enable the required services for the migration.

## Owner
**User** - Requires account creation and billing setup

## Prerequisites
- None (this is the first task)

## Time Estimate
30 minutes

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
   - This unlocks: Durable Objects, higher limits, D1 production

**Why Paid?** Free tier doesn't include Durable Objects, which we need for WebSocket connections and job state.

### 3. Enable D1 Database
1. Go to **Workers & Pages** → **D1**
2. Click **Create database**
3. Name: `reel-ballers`
4. Location: Choose closest to your users (e.g., `wnam` for Western North America)
5. Click **Create**
6. **Save the Database ID** - you'll need it for wrangler.toml

```
Database ID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx  ← Save this!
```

### 4. Enable R2 Storage
1. Go to **R2** in the sidebar
2. Click **Create bucket**
3. Name: `reel-ballers-videos`
4. Location: **Automatic** (or same region as D1)
5. Click **Create bucket**

### 5. Create API Token for Wrangler
1. Go to **My Profile** (top right) → **API Tokens**
2. Click **Create Token**
3. Use template: **Edit Cloudflare Workers**
4. Permissions should include:
   - Account: Workers Scripts: Edit
   - Account: Workers KV Storage: Edit
   - Account: Workers R2 Storage: Edit
   - Account: D1: Edit
5. Click **Continue to summary** → **Create Token**
6. **Copy the token immediately** (shown only once)

```
API Token: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx  ← Save this!
```

### 6. Install Wrangler CLI
```bash
npm install -g wrangler

# Login with your token
wrangler login
# OR set token directly
export CLOUDFLARE_API_TOKEN=your_token_here
```

### 7. Verify Setup
```bash
# Check authentication
wrangler whoami

# List D1 databases
wrangler d1 list

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
| D1 Database ID | `abc123-def456-...` | Share with Claude for Task 03 |
| R2 Bucket Name | `reel-ballers-videos` | Share with Claude for Task 04 |
| API Token | `xxxxx...` | `~/.wrangler/config/default.toml` or env var |
| Wrangler CLI | `wrangler whoami` works | Installed globally |

---

## Handoff Notes

**For Task 02 (Workers Project Setup):**
- Provide the D1 Database ID
- Provide the R2 Bucket Name
- Confirm wrangler CLI is working (`wrangler whoami`)

**For Task 04 (R2 Bucket Setup):**
- R2 bucket should exist but CORS not yet configured

---

## Troubleshooting

### "You need to enable Workers Paid"
Make sure you upgraded from the free plan. Durable Objects require paid.

### "Database not found"
Double-check the database ID. Run `wrangler d1 list` to see all databases.

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
| D1 | $0.00 (free tier) |
| R2 | $0.00 (until you store data) |
| **Total** | **$5.00** |
