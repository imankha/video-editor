# Task 05: Modal Account Setup

## Overview
Create a Modal account and configure authentication for GPU video processing.

## Owner
**User** - Requires account creation and billing setup

## Prerequisites
- Task 04 complete (Database sync working)

## Testability
**After this task**: Modal CLI authenticated, ready to deploy functions

---

## Steps

### 1. Create Modal Account

1. Go to [modal.com](https://modal.com)
2. Sign up with GitHub (recommended) or email
3. Verify your email if required

### 2. Install Modal CLI

```bash
pip install modal
```

### 3. Authenticate CLI

```bash
modal token new
```

This opens a browser to authenticate. After success, credentials are stored locally.

### 4. Verify Setup

```bash
# Check authentication
modal token show

# Run a test function
modal run --help
```

### 5. Add Credits (Optional for Testing)

Modal provides $30 free credits for new accounts. For production:

1. Go to Modal Dashboard → Settings → Billing
2. Add payment method
3. Set spending limits if desired

---

## Environment Variables

Modal uses token-based auth stored locally by the CLI. For production (Fly.io), you'll need:

| Variable | Description | How to Get |
|----------|-------------|------------|
| MODAL_TOKEN_ID | API token ID | `modal token new` creates this |
| MODAL_TOKEN_SECRET | API token secret | Stored in ~/.modal.toml |

To get tokens for CI/CD or server deployment:
```bash
# Create a new token for production
modal token new --name production

# View token location
cat ~/.modal.toml
```

---

## Cost Structure

| Resource | Cost |
|----------|------|
| CPU | $0.000024/sec (~$0.09/hr) |
| GPU T4 | $0.000164/sec (~$0.59/hr) |
| GPU A10G | $0.000306/sec (~$1.10/hr) |
| Memory | $0.000003/GB/sec |
| Storage | Free (ephemeral) |

**Key advantage**: Pay only when code runs. No idle costs.

**Estimate for 1000 exports/month**:
- 1000 exports × 30 sec avg × $0.000164/sec = **~$5/month**

---

## Deliverables

| Item | Description |
|------|-------------|
| Modal account | Created and verified |
| CLI authenticated | `modal token show` works |
| Credits available | $30 free or payment added |

---

## Next Step
Task 06 - GPU Functions Code (Claude creates Modal functions)
