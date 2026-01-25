# Manual Test Script - Project-Based Video Editor

## Prerequisites

Start both servers in separate terminals:

```bash
# Terminal 1 - Backend (port 8000)
cd src/backend
.venv/Scripts/python.exe -m uvicorn app.main:app --port 8000 --reload

# Terminal 2 - Frontend (port 5173)
cd src/frontend
npm run dev
```

---

## Part 1: Backend API Tests (curl)

### 1.1 Health Check
```bash
curl http://localhost:8000/api/health
```
**Expected:** `{"status":"healthy","db_initialized":true,...}`

### 1.2 List Projects (initially empty or has test data)
```bash
curl http://localhost:8000/api/projects
```
**Expected:** Array of projects (may be empty `[]`)

### 1.3 Create a Project
```bash
curl -X POST http://localhost:8000/api/projects \
  -H "Content-Type: application/json" \
  -d '{"name": "Manual Test Project", "aspect_ratio": "16:9"}'
```
**Expected:** `{"id":X,"name":"Manual Test Project","aspect_ratio":"16:9",...}`

### 1.4 Get Project Details
```bash
curl http://localhost:8000/api/projects/1
```
**Expected:** Project with `clips: []` array

### 1.5 List Raw Clips (library)
```bash
curl http://localhost:8000/api/clips/raw
```
**Expected:** Array (empty if no Annotate exports yet)

---

## Part 2: Frontend UI Tests (Browser)

Open: **http://localhost:5173**

### 2.1 Initial Load - Project Manager
- [ ] Page shows "Project Manager" header with folder icon
- [ ] "New Project" button (purple) is visible
- [ ] "Annotate Game" button (green) is visible
- [ ] If projects exist, they appear in a list below

### 2.2 Create New Project
1. Click **"New Project"** button
2. Modal should appear with:
   - [ ] "New Project" title
   - [ ] Text input for project name
   - [ ] Three aspect ratio buttons: 16:9, 9:16, 1:1
   - [ ] Cancel and Create buttons

3. Test validation:
   - [ ] With empty name, Create button should be disabled
   - [ ] Click Cancel - modal closes, no project created

4. Create a project:
   - Enter name: "Test Highlights"
   - Select 9:16 (Portrait)
   - Click Create
   - [ ] Modal closes
   - [ ] New project appears in the list

### 2.3 Project Card Display
For each project in the list, verify:
- [ ] Project name is shown
- [ ] Aspect ratio badge (e.g., "16:9")
- [ ] Clip count shown (e.g., "0 clips")
- [ ] Status shown ("Not Started" for new projects)
- [ ] Progress bar at 0%
- [ ] Hover reveals delete button (trash icon)

### 2.4 Delete Project (Two-Click Confirm)
1. Hover over a project card
2. Click the trash icon once
   - [ ] Button turns red (confirm state)
3. Wait 3 seconds
   - [ ] Button returns to normal
4. Click trash icon twice quickly
   - [ ] Project is deleted from list

### 2.5 Select Project
1. Click on a project card (not the delete button)
2. **Expected behavior:**
   - [ ] ProjectManager view disappears
   - [ ] Editor UI appears (Framing mode)
   - [ ] Check browser console for any errors

**Note:** If clicking a project doesn't work yet, that's expected - we haven't fully wired up the editor modes to projects yet.

### 2.6 Annotate Mode Entry
1. From Project Manager, click **"Annotate Game"**
2. **Expected:**
   - [ ] ProjectManager disappears
   - [ ] Annotate mode UI appears
   - [ ] Can upload a game video file

---

## Part 3: Run Automated API Tests

```bash
cd src/backend/tests
bash test_api.sh
```

**Expected:** All 31 tests pass with green checkmarks

---

## Current Status Summary

| Feature | Status | Notes |
|---------|--------|-------|
| Backend: Health API | Working | `/api/health` |
| Backend: Projects CRUD | Working | Create, Read, Update, Delete |
| Backend: Clips API | Working | Upload, list, reorder, delete |
| Backend: Games API | Working | Game footage, annotations |
| Backend: Export API | Working | Framing, overlay, multi-clip exports |
| Backend: Downloads API | Working | Gallery with R2 presigned URLs |
| Frontend: ProjectManager | Working | Shows project list, create/delete |
| Frontend: AnnotateScreen | Working | Video annotation, TSV import/export |
| Frontend: FramingScreen | Working | Crop, trim, segments, AI upscale |
| Frontend: OverlayScreen | Working | Highlight regions, effects |
| Frontend: DownloadsPanel | Working | Gallery with download links |
| App.jsx: Mode routing | Working | Projects → Framing → Overlay flow |

---

## Features Implemented

1. **Project selection → Editor**: Clicking a project switches to Framing mode with that project's clips loaded.

2. **Annotate → Raw Clips**: Exporting from Annotate mode creates raw_clips entries and auto-creates projects for 5-star clips.

3. **Framing Export**: Creates working_videos and updates project, with WebSocket progress reporting.

4. **Overlay Export**: Creates final_videos shown in the Gallery/Downloads panel.

---

## Cleanup Test Data

To reset and start fresh:

```bash
# Delete the database and user data
rm -rf user_data/

# Restart the backend (will recreate empty database)
```
