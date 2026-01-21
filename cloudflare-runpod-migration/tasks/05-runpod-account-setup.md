# Task 05: RunPod Account Setup

## Overview
Create a RunPod account and add initial credits for GPU video processing.

## Owner
**User** - Requires account creation and billing setup

## Prerequisites
- Task 01-04 complete (R2 storage working)

## Testability
**After this task**: No app changes yet - this is account setup only.

---

## Steps

### 1. Create RunPod Account

1. Go to https://www.runpod.io/
2. Click **Sign Up**
3. Verify email
4. Add payment method (pay-as-you-go)

### 2. Add Credits

1. Go to **Billing** → **Add Credits**
2. Add $10-20 to start (testing will use ~$1-2)
3. Note: Unused credits don't expire

### 3. Get API Key

1. Go to **Settings** → **API Keys**
2. Click **Create API Key**
3. **Save this value:**

```
API Key: ________________________________
```

---

## Deliverables

After completing this task, you should have:

| Item | Where to Save |
|------|---------------|
| RunPod Account | Password manager |
| API Key | `.env` file (RUNPOD_API_KEY) |
| Initial credits | $10-20 added |

---

## Handoff Notes

**For Task 06 (RunPod Endpoint Setup):**
- Account exists with credits
- API key is ready
- Next: Create the serverless endpoint

---

## Cost Notes

| Usage | Cost |
|-------|------|
| Account creation | Free |
| Credits added | $10-20 (prepaid) |
| Testing (~10 exports) | ~$0.50 |

You only pay for actual GPU time used.
