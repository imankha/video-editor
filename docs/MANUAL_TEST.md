# Manual Test Script — Video Editor

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

Open: **http://localhost:5173**

---

## Smoke Test

*Critical path only. Should complete in ~30 minutes.*

### 1. Profile Setup
- [ ] App loads, profile selector visible
- [ ] Create a new profile (e.g. "QA Tester")
- [ ] Confirm profile is selected and persists on refresh

---

### 2. Upload a Game
- [ ] Go to **Games** tab → click **Add Game**
- [ ] Fill in: opponent name, date, type (Home/Away/Tournament)
- [ ] Upload a video file — watch upload progress indicator
- [ ] Confirm game appears in list with clip count = 0

---

### 3. Annotate the Game
- [ ] Click game → opens **Annotate mode**
- [ ] Video plays; seek with arrow keys (±4s), Space to play/pause
- [ ] Drag on timeline to mark a clip region
- [ ] Assign a **5-star** rating — confirm auto-project is created in Projects tab
- [ ] Assign a **3-star** rating with tags + notes
- [ ] Edit an existing clip (change start/end time)
- [ ] Delete a clip

---

### 4. Export an Annotated Video
- [ ] Select multiple clips in Annotate mode
- [ ] Click **Export** with a transition (e.g. Fade or Dissolve)
- [ ] Watch export progress toast
- [ ] Confirm output video appears in **Gallery**
- [ ] Play and download the video from Gallery

---

### 5. Framing Mode (Auto-Created Project)
- [ ] Go to **Projects** tab — auto-created project visible
- [ ] Open it → lands in **Framing mode**, confirm clip extraction completes
- [ ] Play/Pause, seek, check FPS/resolution shown
- [ ] **Crop tool**: Enable crop, drag to set region, add a second keyframe at a different time, confirm animation between them
- [ ] **Segments**: Add a segment boundary, set one segment to 0.5x speed
- [ ] **Trim**: Set start/end trim points
- [ ] Click **Export** — watch progress toast (real-time %)
- [ ] Confirm export completes and auto-navigates to Overlay

---

### 6. Overlay Mode (Auto-Created Project)
- [ ] Working video loads and plays
- [ ] Draw a highlight region on the video
- [ ] Add a second keyframe, move the highlight
- [ ] Delete a keyframe
- [ ] Click **Export** — watch progress toast
- [ ] Confirm export completes

---

### 7. Gallery / Downloads
- [ ] Final video appears in list
- [ ] **Play** the video inline
- [ ] **Download** the video — file downloads
- [ ] **Restore project** from the gallery entry → opens Framing for re-editing
- [ ] Delete the gallery entry

---

### 8. Manual Project
- [ ] Go to **Projects** tab → **New Project**
- [ ] Set name, choose aspect ratio
- [ ] Add clips from library (select 2–3 annotated clips)
- [ ] Confirm clips show extraction status (Extracting → Extracted)
- [ ] Reorder clips in sidebar via drag
- [ ] Remove a clip from project
- [ ] Run through Framing and Overlay with this project (repeat steps 5–6)

---

### 9. Cleanup / Destructive Actions
- [ ] Delete a project → confirmation shown, removed from list
- [ ] Delete a game that has clips → confirmation warning shown, cascades correctly

---

## Deep Test

*Run after smoke test passes. Covers edge cases and secondary features.*

### D1. Filters
- [ ] Filter projects by status — list updates correctly
- [ ] Filter projects by aspect ratio — list updates correctly
- [ ] Filters persist on page refresh

---

### D2. Multiple Profiles
- [ ] Create a second profile
- [ ] Switch to it — no data from first profile visible
- [ ] Create a game/project in second profile, switch back — isolation confirmed
- [ ] Rename a profile
- [ ] Delete a profile with active projects → confirmation shown, removed

---

### D3. Settings
- [ ] Change a setting (e.g. filter preference) → refresh → persists
- [ ] Reset settings → defaults restored

---

### D4. Error & Edge Cases
- [ ] Mode switch (Framing ↔ Overlay) with unsaved changes → confirmation dialog appears
- [ ] Retry a failed clip extraction
- [ ] Restore a project from Gallery and re-export
