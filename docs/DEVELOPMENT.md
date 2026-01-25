# Development Guide

Quick guide for running the Video Editor application locally.

## Quick Start (Windows)

### Option 1: One-Click Startup (Recommended)

From the project root directory, double-click or run:

```batch
start-dev.bat
```

This will automatically:
-  Open two terminal windows (Backend + Frontend)
-  Create virtual environments if needed
-  Install all dependencies
-  Start both servers

**That's it!** Once both servers are running, open: **http://localhost:5173**

---

### Option 2: Manual Startup (Individual Servers)

If you prefer to start servers individually or need more control:

#### Backend Only

Open PowerShell/CMD in `src\backend\` and run:

```batch
start.bat
```

**What it does:**
1. Creates Python virtual environment (if needed)
2. Activates virtual environment
3. Installs/updates Python dependencies
4. Starts FastAPI server on http://localhost:8000

#### Frontend Only

Open PowerShell/CMD in `src\frontend\` and run:

```batch
start.bat
```

**What it does:**
1. Installs npm dependencies (if needed)
2. Starts Vite dev server on http://localhost:5173

---

## Prerequisites

Make sure you have these installed:

- **Python 3.11+** - [Download](https://www.python.org/downloads/)
- **Node.js 18+** - [Download](https://nodejs.org/)
- **FFmpeg** - [Installation Guide](README.md#install-ffmpeg)

Verify installations:

```batch
python --version
node --version
ffmpeg -version
```

---

## What Runs Where

| Service | URL | Description |
|---------|-----|-------------|
| **Frontend** | http://localhost:5173 | React + Vite dev server (main UI) |
| **Backend** | http://localhost:8000 | FastAPI server (REST API) |
| **API Docs** | http://localhost:8000/docs | Interactive API documentation |

---

## Troubleshooting

### Backend Issues

**Problem:** `python: command not found`
**Solution:** Make sure Python is installed and added to PATH

**Problem:** Port 8000 already in use
**Solution:** Kill the process or change the port in `src/backend/start.bat`

**Problem:** Virtual environment activation fails
**Solution:** Run PowerShell as Administrator or check execution policy:
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Frontend Issues

**Problem:** `npm: command not found`
**Solution:** Install Node.js and restart your terminal

**Problem:** Port 5173 already in use
**Solution:** Kill the process or Vite will automatically try the next available port

**Problem:** CORS errors in browser
**Solution:** Make sure backend is running on port 8000

---

## Clean Start

If you encounter issues, try a clean restart:

### Backend Clean

```batch
cd src\backend
rmdir /s /q venv
start.bat
```

### Frontend Clean

```batch
cd src\frontend
rmdir /s /q node_modules
del package-lock.json
start.bat
```

---

## Manual Dependency Management

### Update Backend Dependencies

```batch
cd src\backend
venv\Scripts\activate
pip install -r requirements.txt --upgrade
```

### Update Frontend Dependencies

```batch
cd src\frontend
npm update
```

---

## Development Workflow

1. **First Time Setup:**
   - Run `start-dev.bat` from project root
   - Wait for both servers to start
   - Open http://localhost:5173 in your browser

2. **Daily Development:**
   - Just run `start-dev.bat` again
   - Dependencies are only installed when needed
   - Both servers have hot-reload enabled

3. **Making Changes:**
   - **Frontend:** Edit files in `src/frontend/src/` - browser auto-refreshes
   - **Backend:** Edit files in `src/backend/app/` - server auto-reloads

4. **Stopping Servers:**
   - Press `Ctrl+C` in each terminal window
   - Or simply close the terminal windows

---

## Common Error Messages

### `ModuleNotFoundError: No module named 'fastapi'`

Your virtual environment isn't activated or dependencies aren't installed.

**Fix:** Just run `start.bat` again - it will handle this automatically.

### `Error: Cannot find module 'vite'`

Node modules aren't installed.

**Fix:** Run `start.bat` again - it will install dependencies.

### `EADDRINUSE: address already in use`

Port is already taken by another process.

**Fix (Windows):**
```batch
netstat -ano | findstr :8000
taskkill /PID <PID> /F
```

---

## Additional Resources

- [Main README](README.md) - Project overview
- [API Documentation](http://localhost:8000/docs) - Interactive API docs (when server is running)
- [Project Documentation](docs/) - Complete specifications

---

## Success Checklist

When everything is working correctly:

- [ ] Backend terminal shows: `Application startup complete`
- [ ] Frontend terminal shows: `VITE v5.x.x ready`
- [ ] Browser shows app at http://localhost:5173
- [ ] No errors in browser console (F12)
- [ ] API docs accessible at http://localhost:8000/docs

---

**Need help?** Check the [README](README.md) or open an issue.
