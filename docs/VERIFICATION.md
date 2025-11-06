# Project Verification Guide

This guide provides multiple ways to verify that the video editor project is running correctly.

---

## 🎯 Quick Verification (30 seconds)

Run this automated test script:

```bash
./verify.sh
```

Or run the manual steps below.

---

## ✅ Manual Verification Steps

### Step 1: Verify Backend is Running

**Terminal Test:**
```bash
curl http://localhost:8000/
```

**Expected Output:**
```json
{
  "message": "Video Editor API is running! 🚀",
  "version": "0.1.0",
  "status": "healthy",
  "docs": "/docs"
}
```

✅ **Pass:** You see the JSON response
❌ **Fail:** Connection refused or no response → Backend not running

---

### Step 2: Verify Backend API Endpoint

**Terminal Test:**
```bash
curl http://localhost:8000/api/hello
```

**Expected Output:**
```json
{
  "message": "Hello from FastAPI + Python! 🐍",
  "timestamp": "2025-11-06T...",
  "tech_stack": {
    "backend": "FastAPI",
    "language": "Python 3.11+",
    "async": true,
    "validation": "Pydantic"
  },
  "fun_fact": "FastAPI is one of the fastest..."
}
```

✅ **Pass:** You see the full JSON with timestamp
❌ **Fail:** 404 or error → Check backend logs

---

### Step 3: Verify API Documentation

**Browser Test:**
Open: http://localhost:8000/docs

**Expected:**
- Interactive Swagger UI appears
- Shows endpoints: `/`, `/api/hello`, `/api/status`
- Can click "Try it out" buttons
- Green "Execute" buttons work

✅ **Pass:** Swagger UI loads and endpoints are visible
❌ **Fail:** Page doesn't load → Backend issue

---

### Step 4: Verify Frontend is Running

**Terminal Test:**
```bash
curl -I http://localhost:5173
```

**Expected Output:**
```
HTTP/1.1 200 OK
Content-Type: text/html
...
```

✅ **Pass:** You see HTTP 200 OK
❌ **Fail:** Connection refused → Frontend not running

---

### Step 5: Verify Frontend UI

**Browser Test:**
Open: http://localhost:5173

**Visual Checklist:**
- [ ] Purple/gray gradient background displays
- [ ] "🎬 Video Editor" title visible
- [ ] Two tech stack cards (Frontend & Backend)
- [ ] Green checkmark: "✅ Hello from FastAPI + Python! 🐍"
- [ ] Current timestamp displayed
- [ ] Tech stack details shown (backend, language, async, validation)
- [ ] Fun fact displayed
- [ ] Footer with URLs visible
- [ ] No errors in browser console (press F12)

✅ **Pass:** All items above are visible
❌ **Fail:** Red error message → Check integration

---

### Step 6: Verify Frontend-Backend Integration

**Browser Console Test:**
1. Open http://localhost:5173
2. Press **F12** (Developer Tools)
3. Go to **Console** tab
4. Refresh page (Ctrl+R or Cmd+R)

**Expected Console:**
- No red error messages
- May see Vite or React dev messages (these are OK)
- No CORS errors
- No "Network error" messages

**Expected Network:**
1. Go to **Network** tab
2. Refresh page
3. Look for request to `/api/hello`
4. Should show: Status 200, Type: xhr, Size: ~300 bytes

✅ **Pass:** Request succeeds with 200 status
❌ **Fail:** Status 4xx or 5xx → Integration issue

---

## 🔧 Verification Using Test Script

I've created an automated verification script:

```bash
chmod +x verify.sh
./verify.sh
```

The script tests:
1. ✓ Backend is responding
2. ✓ Backend API returns correct data
3. ✓ Frontend is serving content
4. ✓ All ports are accessible
5. ✓ CORS is configured correctly

---

## 🧪 Comprehensive Test Checklist

### Backend Tests

| Test | Command | Expected Result |
|------|---------|----------------|
| Root endpoint | `curl http://localhost:8000/` | JSON with "Video Editor API" |
| Hello endpoint | `curl http://localhost:8000/api/hello` | JSON with timestamp |
| Status endpoint | `curl http://localhost:8000/api/status` | JSON with "healthy" |
| API docs | Open http://localhost:8000/docs | Swagger UI loads |
| CORS headers | `curl -I http://localhost:8000/api/hello` | Headers include access-control-allow-origin |

### Frontend Tests

| Test | Command | Expected Result |
|------|---------|----------------|
| HTML loads | `curl http://localhost:5173` | HTML with "Video Editor - Hello World" |
| Assets load | Check browser Network tab | All JS/CSS load successfully |
| React mounts | Check page source | `<div id="root">` has content |
| API call works | Check Network tab | Request to /api/hello succeeds |

### Integration Tests

| Test | How to Verify | Expected Result |
|------|--------------|----------------|
| Frontend calls backend | Browser Network tab | GET /api/hello returns 200 |
| Data displays | Visual check | Green success message visible |
| CORS working | Browser Console | No CORS errors |
| Hot reload (backend) | Edit main.py, save | Server restarts automatically |
| Hot reload (frontend) | Edit App.jsx, save | Browser updates without refresh |

---

## 🐛 Common Issues and Solutions

### Issue: Backend not responding

**Symptoms:**
- `curl: (7) Failed to connect to localhost port 8000`
- Connection refused errors

**Verify:**
```bash
# Check if backend process is running
ps aux | grep uvicorn

# Check if port 8000 is in use
lsof -i :8000
```

**Solution:**
```bash
cd src/backend
source venv/bin/activate
./run.sh
```

---

### Issue: Frontend not responding

**Symptoms:**
- `curl: (7) Failed to connect to localhost port 5173`
- Blank browser page

**Verify:**
```bash
# Check if frontend process is running
ps aux | grep vite

# Check if port 5173 is in use
lsof -i :5173
```

**Solution:**
```bash
cd src/frontend
npm run dev
```

---

### Issue: CORS errors

**Symptoms:**
- Browser console: "CORS policy: No 'Access-Control-Allow-Origin' header"
- Red error in UI: "Connection Error"

**Verify:**
```bash
curl -I http://localhost:8000/api/hello
```

Look for header: `access-control-allow-origin: http://localhost:5173`

**Solution:**
1. Check `backend/app/main.py` - CORS middleware should include `http://localhost:5173`
2. Restart backend server

---

### Issue: "Hello World" not showing

**Symptoms:**
- UI loads but shows loading spinner
- Red error message instead of green success

**Verify:**
```bash
# Test backend directly
curl http://localhost:8000/api/hello

# Check browser console (F12)
# Look for network errors
```

**Solution:**
1. Ensure backend is running on port 8000
2. Check browser console for specific error
3. Verify CORS configuration

---

## 📊 Success Indicators

### Backend Success
```bash
$ curl http://localhost:8000/api/hello
{
  "message": "Hello from FastAPI + Python! 🐍",
  "timestamp": "2025-11-06T01:15:58.853750",
  ...
}
```

### Frontend Success
- Browser shows beautiful gradient UI
- Green checkmark visible
- No console errors
- Timestamp updates

### Integration Success
- Network tab shows successful API call
- Status: 200 OK
- Response time: < 100ms
- No CORS errors

---

## 🎯 Final Verification Checklist

Use this checklist to confirm everything is working:

**Backend:**
- [ ] Backend terminal shows: `INFO: Application startup complete`
- [ ] `curl http://localhost:8000/` returns JSON
- [ ] `curl http://localhost:8000/api/hello` returns data
- [ ] http://localhost:8000/docs shows Swagger UI

**Frontend:**
- [ ] Frontend terminal shows: `VITE v5.x.x ready in XXXms`
- [ ] http://localhost:5173 loads the page
- [ ] Purple gradient background visible
- [ ] Tech stack cards display correctly

**Integration:**
- [ ] Green success message: "Hello from FastAPI + Python! 🐍"
- [ ] Current timestamp displayed
- [ ] Tech stack details shown
- [ ] Browser console (F12) has no red errors
- [ ] Network tab shows successful /api/hello call

**All Green?** ✅ Your project is running correctly!

---

## 🚀 Performance Verification

### Response Time Tests

```bash
# Test backend response time
time curl -s http://localhost:8000/api/hello > /dev/null

# Should complete in < 0.1 seconds
```

### Browser Performance

1. Open http://localhost:5173
2. Open DevTools (F12)
3. Go to **Lighthouse** tab
4. Click "Generate report"

**Expected:**
- Performance: > 90
- Accessibility: > 90
- Best Practices: > 80

---

## 📝 Automated Testing Script

See `verify.sh` for automated testing. It checks:

1. Backend health
2. API endpoints
3. Frontend serving
4. CORS configuration
5. Response times

Run with: `./verify.sh`

---

## ✅ Quick Verification Command

Run all verifications in one command:

```bash
# Test backend
curl -s http://localhost:8000/api/hello | grep -q "Hello from FastAPI" && echo "✅ Backend OK" || echo "❌ Backend FAIL"

# Test frontend
curl -s http://localhost:5173 | grep -q "Video Editor" && echo "✅ Frontend OK" || echo "❌ Frontend FAIL"
```

If both show ✅, you're good to go!
