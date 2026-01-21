# Task 06: RunPod Endpoint Setup

## Overview
Create a RunPod serverless endpoint that will run our GPU video processing container.

## Owner
**User** - Requires RunPod dashboard access

## Prerequisites
- Task 05 complete (RunPod account with credits)

## Testability
**After this task**: Endpoint exists but no container yet. Can test with a simple echo handler.

---

## Steps

### 1. Create Serverless Endpoint

1. Go to **Serverless** in the left menu
2. Click **+ New Endpoint**
3. Configure:

| Setting | Value | Notes |
|---------|-------|-------|
| Endpoint Name | `reel-ballers-export` | |
| Select Template | **Custom** | We'll provide our own Docker image |
| GPU Type | **RTX 4000 Ada** | Best price/performance for video encoding |
| Max Workers | 3 | Scale based on demand |
| Idle Timeout | 5 seconds | Fast scale-down when idle |
| Execution Timeout | 300 seconds | 5 min max per job |

4. For now, use a **test container image**: `runpod/base:0.4.0-cuda11.8.0`
5. Click **Create Endpoint**

### 2. Get Endpoint Credentials

After creating the endpoint:

1. Click on your endpoint name
2. Find the **Endpoint ID** (looks like: `abc123def456`)
3. Note the **Endpoint URL**: `https://api.runpod.ai/v2/{endpoint_id}`
4. **Save these values:**

```
Endpoint ID: ________________________________
Endpoint URL: https://api.runpod.ai/v2/{endpoint_id}
```

### 3. Test the Endpoint

```bash
# Test with a simple job
curl -X POST "https://api.runpod.ai/v2/{endpoint_id}/run" \
  -H "Authorization: Bearer {api_key}" \
  -H "Content-Type: application/json" \
  -d '{"input": {"test": "hello"}}'

# Response should include a job ID:
# {"id": "xxxxx-xxxxx", "status": "IN_QUEUE"}

# Check job status
curl "https://api.runpod.ai/v2/{endpoint_id}/status/{job_id}" \
  -H "Authorization: Bearer {api_key}"
```

---

## Environment Variables

Add to your `.env` file:

```bash
RUNPOD_API_KEY=your_api_key_here
RUNPOD_ENDPOINT_ID=your_endpoint_id_here
RUNPOD_ENDPOINT_URL=https://api.runpod.ai/v2/your_endpoint_id_here
```

---

## R2 Credentials for RunPod

The GPU worker needs S3-compatible credentials to access R2 for downloading input videos and uploading outputs.

### Create R2 API Token

1. Go to **R2** → **Manage R2 API Tokens**
2. Click **Create API Token**
3. Permissions: **Object Read & Write**
4. Specify bucket: `reel-ballers-users`
5. Click **Create API Token**
6. **Save these values:**

```
Access Key ID: ________________________________
Secret Access Key: ________________________________
Endpoint: https://<account_id>.r2.cloudflarestorage.com
```

### Add to RunPod Environment

When configuring your RunPod endpoint (or in Task 07 GPU Worker):

```bash
# R2 credentials (add to RunPod endpoint environment variables)
R2_ACCESS_KEY_ID=your_access_key_id
R2_SECRET_ACCESS_KEY=your_secret_access_key
R2_ENDPOINT_URL=https://<account_id>.r2.cloudflarestorage.com
R2_BUCKET_NAME=reel-ballers-users
```

The GPU worker uses these credentials with boto3's S3-compatible client to:
- Download input videos from `{user_id}/working_videos/`
- Upload processed videos to `{user_id}/final_videos/`

---

## GPU Selection Guide

| GPU | $/second | Good For |
|-----|----------|----------|
| RTX 4000 Ada | $0.00031 | **Recommended** - Best value, 20GB VRAM |
| RTX A4000 | $0.00036 | Good balance |
| RTX A5000 | $0.00044 | More VRAM (24GB) |
| RTX 4090 | $0.00069 | Fastest, overkill for encoding |

---

## Deliverables

| Item | Where to Save |
|------|---------------|
| Endpoint ID | `.env` file |
| Endpoint URL | `.env` file |
| Test job succeeded | Verified via curl |

---

## Handoff Notes

**For Task 07 (GPU Worker Code):**
- Endpoint exists and accepts jobs
- Currently using test container
- Next: Build and deploy actual video processing container

---

## Troubleshooting

### "No workers available"
- Check that Max Workers > 0
- GPU type might have low availability - try a different type

### "Unauthorized"
- Verify API key is correct
- Check that API key has permission for the endpoint

### Job stays in queue
- Workers are scaling up (takes 10-30s first time)
- Check RunPod status page for outages
