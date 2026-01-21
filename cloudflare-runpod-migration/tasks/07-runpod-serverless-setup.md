# Task 07: RunPod Serverless Setup

## Overview
Create a RunPod account and configure a serverless endpoint for GPU video processing.

## Owner
**User** (account setup) + **Claude** (endpoint configuration)

## Prerequisites
- Task 04 complete (R2 bucket with credentials)

## Time Estimate
30 minutes

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

### 3. Create Serverless Endpoint

1. Go to **Serverless** in the left menu
2. Click **+ New Endpoint**
3. Configure:

| Setting | Value |
|---------|-------|
| Endpoint Name | `reel-ballers-export` |
| Select Template | **Custom** |
| Container Image | `your-dockerhub/reel-ballers-gpu:latest` (after Task 08) |
| GPU Type | **RTX A4000** or **RTX 4000 Ada** (best price/performance) |
| Max Workers | 3 |
| Idle Timeout | 5 seconds |
| Execution Timeout | 300 seconds (5 min) |

4. Click **Create Endpoint**

### 4. Get API Credentials

After creating the endpoint:

1. Click on your endpoint name
2. Find the **Endpoint ID** (looks like: `abc123def456`)
3. Go to **Settings** → **API Keys**
4. Create new API key or use existing
5. **Save these values:**

```
Endpoint ID: ________________________________
API Key: ________________________________
Endpoint URL: https://api.runpod.ai/v2/{endpoint_id}
```

### 5. Configure Environment Variables

Add to Workers `wrangler.toml`:

```toml
[vars]
RUNPOD_ENDPOINT = "https://api.runpod.ai/v2/YOUR_ENDPOINT_ID"
RUNPOD_API_KEY = "YOUR_API_KEY"
```

For production, use secrets instead:
```bash
wrangler secret put RUNPOD_API_KEY
# Enter your API key when prompted
```

---

## RunPod Serverless API

### Submit Job

```bash
curl -X POST "https://api.runpod.ai/v2/{endpoint_id}/run" \
  -H "Authorization: Bearer {api_key}" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "job_id": "abc123",
      "type": "overlay",
      "input_video_key": "input/abc123/video.mp4",
      "params": { ... },
      "callback_url": "https://workers.dev/api/jobs/abc123/do"
    }
  }'
```

Response:
```json
{
  "id": "runpod-job-id",
  "status": "IN_QUEUE"
}
```

### Check Status (Alternative to Webhook)

```bash
curl "https://api.runpod.ai/v2/{endpoint_id}/status/{runpod_job_id}" \
  -H "Authorization: Bearer {api_key}"
```

Response:
```json
{
  "id": "runpod-job-id",
  "status": "COMPLETED",
  "output": {
    "output_video_key": "output/abc123/video.mp4"
  },
  "executionTime": 12345
}
```

### Job Statuses

| Status | Meaning |
|--------|---------|
| `IN_QUEUE` | Waiting for GPU worker |
| `IN_PROGRESS` | Processing |
| `COMPLETED` | Success |
| `FAILED` | Error occurred |
| `CANCELLED` | Job was cancelled |
| `TIMED_OUT` | Exceeded execution timeout |

---

## GPU Selection Guide

| GPU | $/second | Good For |
|-----|----------|----------|
| RTX 4000 Ada | $0.00031 | Best value, 20GB VRAM |
| RTX A4000 | $0.00036 | Good balance |
| RTX A5000 | $0.00044 | More VRAM (24GB) |
| RTX 4090 | $0.00069 | Fastest, overkill |

**Recommendation**: Start with **RTX 4000 Ada** - best price/performance for video encoding.

---

## Testing the Endpoint

Before deploying GPU worker (Task 08), test with a simple handler:

### Temporary Test Handler

Create a simple Docker image to test the endpoint:

```dockerfile
FROM python:3.10-slim

RUN pip install runpod

COPY handler.py /handler.py

CMD ["python", "-u", "/handler.py"]
```

```python
# handler.py
import runpod
import time

def handler(job):
    job_input = job["input"]
    print(f"Received job: {job_input}")

    # Simulate processing
    for i in range(10):
        time.sleep(1)
        # Progress would be sent via callback in real implementation

    return {
        "status": "success",
        "output_video_key": f"output/{job_input['job_id']}/video.mp4"
    }

runpod.serverless.start({"handler": handler})
```

Build and push:
```bash
docker build -t your-dockerhub/reel-ballers-test:latest .
docker push your-dockerhub/reel-ballers-test:latest
```

Update endpoint to use this image, then test.

---

## Cost Estimation

| Scenario | GPU Time | Cost |
|----------|----------|------|
| 30s video export | ~15s | $0.005 |
| 1 min video export | ~30s | $0.01 |
| 100 exports/month | ~25 min | $0.50 |
| 1000 exports/month | ~4 hrs | $5.00 |

**Note**: You only pay for active GPU time. Zero cost when idle.

---

## Handoff Notes

**For Task 08 (GPU Worker Code):**
- Endpoint exists and is configured
- Need to create the actual Docker image with video processing code
- Handler receives `input` dict with job details
- Handler should call `callback_url` for progress updates

**For Workers (Task 06):**
- Use `RUNPOD_ENDPOINT` and `RUNPOD_API_KEY` env vars
- Submit jobs to `{RUNPOD_ENDPOINT}/run`
- Optionally poll `{RUNPOD_ENDPOINT}/status/{id}` for status

---

## Troubleshooting

### "No workers available"
- Check that Max Workers > 0
- GPU type might have low availability - try a different type
- Check RunPod status page for outages

### Job times out
- Increase Execution Timeout in endpoint settings
- Check if video processing is actually slow

### "Unauthorized"
- Verify API key is correct
- Check that API key has access to the endpoint

### Container won't start
- Check Docker image exists and is public (or configure registry auth)
- Look at endpoint logs for startup errors
