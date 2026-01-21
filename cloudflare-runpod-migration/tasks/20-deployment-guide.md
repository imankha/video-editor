# Task 20: Deployment Guide

## Overview
Complete deployment guide for the Cloudflare + RunPod video processing pipeline. This covers deployment commands, monitoring, rollback procedures, and go-live checklist.

## Owner
**User** - Deployment and monitoring requires account access

## Prerequisites
- All Phase 2 tasks complete (RunPod working)
- All Phase 3 tasks complete (Workers ready)
- Frontend and backend integration tested locally

---

## Deployment Phases

### Phase 1: Cloudflare Workers Deployment

#### Deploy Workers

```bash
cd workers

# Deploy to Cloudflare
wrangler deploy

# Note the deployment URL
# Example: https://reel-ballers-api.your-subdomain.workers.dev
```

#### Apply D1 Migrations

```bash
# Apply migrations to production D1
wrangler d1 migrations apply reel-ballers --remote

# Verify tables
wrangler d1 execute reel-ballers --remote --command "SELECT name FROM sqlite_master WHERE type='table';"
```

#### Set Production Secrets

```bash
# RunPod credentials
wrangler secret put RUNPOD_API_KEY
# Enter your RunPod API key

# Any other secrets...
```

#### Verify Deployment

```bash
PROD_URL="https://reel-ballers-api.your-subdomain.workers.dev"

# Health check
curl "$PROD_URL/health"

# Should return: {"status":"ok","env":"production"}
```

---

### Phase 2: RunPod Deployment

#### Build and Push Docker Image

```bash
cd gpu-worker

# Build for amd64 (RunPod uses Linux)
docker buildx build --platform linux/amd64 -t your-dockerhub/reel-ballers-gpu:latest --push .
```

#### Update RunPod Endpoint

1. Go to RunPod Dashboard → Serverless → Your Endpoint
2. Update **Container Image** to `your-dockerhub/reel-ballers-gpu:latest`
3. Set **Environment Variables**:
   ```
   R2_ENDPOINT=https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com
   R2_ACCESS_KEY_ID=your-key
   R2_SECRET_ACCESS_KEY=your-secret
   R2_BUCKET_NAME=reel-ballers-users
   ```
4. Click **Update**

#### Test RunPod Endpoint

```bash
RUNPOD_ENDPOINT="https://api.runpod.ai/v2/YOUR_ENDPOINT_ID"
RUNPOD_API_KEY="your-api-key"

# Submit test job
curl -X POST "$RUNPOD_ENDPOINT/run" \
  -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "job_id": "test-123",
      "type": "overlay",
      "input_video_key": "test/input.mp4",
      "params": {},
      "callback_url": "https://your-workers.dev/api/jobs/test-123/do"
    }
  }'
```

---

### Phase 3: Frontend Deployment

#### Update Frontend Config

```bash
# .env.production
VITE_WORKERS_API_URL=https://reel-ballers-api.your-subdomain.workers.dev
VITE_USE_CLOUD_EXPORTS=true
```

#### Build and Deploy

```bash
cd src/frontend
npm run build

# Deploy to your hosting (Vercel, Netlify, etc.)
```

---

## Monitoring & Debugging

### Cloudflare Dashboard

- **Workers** → **Logs** - View Worker execution logs
- **D1** → **Query** - Run queries against production database
- **R2** → **Objects** - Browse stored files

### Wrangler Tail (Live Logs)

```bash
# Stream production logs
wrangler tail

# Filter for errors
wrangler tail --format=json | jq 'select(.level == "error")'
```

### RunPod Dashboard

- **Serverless** → **Logs** - View GPU worker logs
- **Serverless** → **Metrics** - See execution times, costs

---

## Rollback Procedures

### If Workers Fail

```bash
# Rollback to previous deployment
wrangler rollback

# Or deploy a specific version
wrangler deploy --commit-hash=abc123
```

### If RunPod Fails

1. Update endpoint to use previous Docker image tag
2. Or temporarily disable cloud exports:
   ```bash
   # In frontend .env
   VITE_USE_CLOUD_EXPORTS=false
   ```

### If D1 Has Issues

```bash
# D1 has automatic point-in-time recovery
# Contact Cloudflare support for restore if needed
```

---

## Performance Baseline

Establish baseline metrics after deployment:

| Metric | Target | How to Measure |
|--------|--------|----------------|
| Job creation latency | < 500ms | Workers logs |
| Video upload time | < 5s for 100MB | Frontend timing |
| Processing time (30s video) | < 30s | RunPod metrics |
| Total export time | < 60s | End-to-end test |
| WebSocket latency | < 100ms | Network tab |

---

## Cost Monitoring

### Set Up Alerts

**Cloudflare:**
- Workers → Settings → Notifications
- Set alert for request count > threshold

**RunPod:**
- Settings → Spending Alerts
- Set monthly budget limit

### Expected Costs

| Component | 100 exports/mo | 1000 exports/mo |
|-----------|----------------|-----------------|
| Workers | $5 (flat) | $5 (flat) |
| D1 | $0 | $0 |
| R2 | ~$0.50 | ~$2 |
| RunPod | ~$0.50 | ~$5 |
| **Total** | **~$6** | **~$12** |

---

## Go-Live Checklist

- [ ] Workers deployed and health check passing
- [ ] D1 migrations applied
- [ ] R2 bucket CORS configured
- [ ] RunPod endpoint updated with new image
- [ ] R2 credentials set in RunPod environment
- [ ] Frontend deployed with production config
- [ ] End-to-end test passing
- [ ] Monitoring/alerts configured
- [ ] Rollback procedure documented and tested
- [ ] Old local export code disabled/removed

---

## Test Scripts

### test-job-flow.sh

```bash
#!/bin/bash
WORKERS_URL="http://localhost:8787"  # or production URL

# Create job
echo "Creating job..."
JOB_RESPONSE=$(curl -s -X POST "$WORKERS_URL/api/jobs" \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": 1,
    "type": "overlay",
    "input_video_key": "test/input.mp4",
    "params": {}
  }')

JOB_ID=$(echo $JOB_RESPONSE | jq -r '.job_id')
echo "Job ID: $JOB_ID"

# Poll status
for i in {1..30}; do
  echo "Polling status ($i)..."
  STATUS=$(curl -s "$WORKERS_URL/api/jobs/$JOB_ID" | jq -r '.status')
  echo "Status: $STATUS"

  if [ "$STATUS" == "complete" ] || [ "$STATUS" == "error" ]; then
    echo "Job finished with status: $STATUS"
    break
  fi

  sleep 2
done
```

### test-websocket.js

```javascript
const WebSocket = require('ws');

const jobId = process.argv[2] || 'test-job';
const ws = new WebSocket(`ws://localhost:8787/api/jobs/${jobId}/ws`);

ws.on('open', () => {
  console.log('Connected');
  ws.send(JSON.stringify({ type: 'subscribe', job_id: jobId }));
});

ws.on('message', (data) => {
  console.log('Received:', JSON.parse(data));
});

ws.on('close', () => console.log('Disconnected'));
ws.on('error', (err) => console.error('Error:', err));
```

---

## Post-Launch

### Week 1
- Monitor error rates daily
- Check cost tracking
- Gather user feedback

### Week 2-4
- Optimize based on metrics
- Adjust RunPod instance type if needed
- Consider adding more GPU regions

### Ongoing
- Review monthly costs
- Update dependencies
- Add new export types as needed

---

## Handoff Notes

This guide covers the operational aspects of deploying and maintaining the cloud export system. For implementation details, see:
- Task 11-13: Workers project setup and API routes
- Task 07: GPU Worker code
- Task 14-15: Backend and frontend integration
