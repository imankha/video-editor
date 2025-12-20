# Task 12: Overlay Export - Create Final Video

## Objective
Update the Overlay export to:
1. Save the exported video to `user_data/a/final_videos/`
2. Create entry in `final_videos` table
3. Update `project.final_video_id`
4. Mark previous final_video as abandoned (if re-exporting)

## Dependencies
- Task 11 (framing export creates working_video)
- Working video exists for the project

## Files to Modify

### 1. `src/backend/app/routers/export.py`

Add the overlay export endpoint:

```python
# Add import
from app.database import FINAL_VIDEOS_PATH

@router.post("/overlay")
async def export_overlay(
    project_id: int = Form(...),
    video: UploadFile = File(...),
    overlay_data: str = Form(...)  # JSON with overlay/highlight configurations
):
    """
    Export final video with overlays for a project.

    This endpoint:
    1. Receives the rendered video with overlays from the frontend
    2. Saves it to final_videos folder
    3. Creates final_videos DB entry
    4. Updates project.final_video_id
    5. Marks previous final_video as abandoned

    Request:
    - project_id: The project ID
    - video: The rendered video file with overlays
    - overlay_data: JSON with overlay configurations (for metadata)

    Response:
    - success: boolean
    - final_video_id: The new final video ID
    - filename: The saved filename
    """
    logger.info(f"Overlay export for project {project_id}")

    try:
        overlay_config = json.loads(overlay_data)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid overlay_data JSON")

    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Verify project exists and has a working video
        cursor.execute("""
            SELECT id, working_video_id, final_video_id
            FROM projects WHERE id = ?
        """, (project_id,))
        project = cursor.fetchone()

        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        if not project['working_video_id']:
            raise HTTPException(
                status_code=400,
                detail="Project must have a working video before overlay export"
            )

        # Generate unique filename
        filename = f"final_{project_id}_{uuid.uuid4().hex[:8]}.mp4"
        file_path = FINAL_VIDEOS_PATH / filename

        # Save the video file
        content = await video.read()
        with open(file_path, 'wb') as f:
            f.write(content)

        logger.info(f"Saved final video: {filename} ({len(content)} bytes)")

        # Mark previous final video as abandoned
        if project['final_video_id']:
            cursor.execute("""
                UPDATE final_videos SET abandoned = TRUE WHERE id = ?
            """, (project['final_video_id'],))
            logger.info(f"Marked previous final video as abandoned: {project['final_video_id']}")

        # Create new final video entry
        cursor.execute("""
            INSERT INTO final_videos (project_id, filename)
            VALUES (?, ?)
        """, (project_id, filename))
        final_video_id = cursor.lastrowid

        # Update project with new final video ID
        cursor.execute("""
            UPDATE projects SET final_video_id = ? WHERE id = ?
        """, (final_video_id, project_id))

        conn.commit()

        logger.info(f"Created final video {final_video_id} for project {project_id}")

        return JSONResponse({
            'success': True,
            'final_video_id': final_video_id,
            'filename': filename,
            'project_id': project_id
        })


@router.get("/projects/{project_id}/final-video")
async def get_final_video(project_id: int):
    """Stream the final video for a project."""
    with get_db_connection() as conn:
        cursor = conn.cursor()

        cursor.execute("""
            SELECT fv.filename
            FROM projects p
            JOIN final_videos fv ON p.final_video_id = fv.id
            WHERE p.id = ? AND fv.abandoned = FALSE
        """, (project_id,))
        result = cursor.fetchone()

        if not result:
            raise HTTPException(status_code=404, detail="Final video not found")

        file_path = FINAL_VIDEOS_PATH / result['filename']
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Video file not found")

        return FileResponse(
            path=str(file_path),
            media_type="video/mp4",
            filename=result['filename']
        )
```

### 2. Update Frontend Export Handler

In App.jsx or the overlay export component:

```javascript
/**
 * Handle overlay export completion
 * Called when the overlay video blob is ready
 */
const handleOverlayExportComplete = useCallback(async (videoBlob, overlayData) => {
  if (!selectedProjectId) {
    console.error('[App] No project selected for overlay export');
    return;
  }

  console.log('[App] Overlay export complete, saving to server...');

  try {
    // Create form data with video and metadata
    const formData = new FormData();
    formData.append('project_id', selectedProjectId.toString());
    formData.append('video', videoBlob, 'final_video.mp4');
    formData.append('overlay_data', JSON.stringify(overlayData));

    const response = await fetch('http://localhost:8000/api/export/overlay', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || 'Failed to save overlay export');
    }

    const result = await response.json();
    console.log('[App] Overlay export saved:', result);

    // Refresh project to get updated final_video_id
    await refreshSelectedProject();

    // Also refresh projects list to update progress
    await fetchProjects();

    // Show success
    console.log('[App] Final video created, project complete!');
    alert('Export complete! Your final video has been saved.');

  } catch (err) {
    console.error('[App] Failed to save overlay export:', err);
    alert(`Failed to save export: ${err.message}`);
  }
}, [selectedProjectId, refreshSelectedProject, fetchProjects]);
```

## Testing Steps

### 1. Prepare - Ensure Working Video Exists

First, complete a framing export for a project:

```bash
# Create project and add clip
curl -X POST http://localhost:8000/api/projects \
  -H "Content-Type: application/json" \
  -d '{"name": "Test Overlay", "aspect_ratio": "16:9"}'

curl -X POST http://localhost:8000/api/clips/projects/1/clips \
  -F "file=@/path/to/test-video.mp4"

# Create working video
curl -X POST http://localhost:8000/api/export/framing \
  -F "project_id=1" \
  -F "video=@/path/to/test-video.mp4" \
  -F 'clips_data=[]'

# Verify
sqlite3 user_data/a/database.sqlite "SELECT working_video_id FROM projects WHERE id = 1;"
```

### 2. Test Overlay Export API

```bash
curl -X POST http://localhost:8000/api/export/overlay \
  -F "project_id=1" \
  -F "video=@/path/to/test-video.mp4" \
  -F 'overlay_data={"highlights": []}'
```

Expected response:
```json
{
  "success": true,
  "final_video_id": 1,
  "filename": "final_1_abc123.mp4",
  "project_id": 1
}
```

### 3. Verify Database

```bash
sqlite3 user_data/a/database.sqlite << 'EOF'
.headers on
SELECT id, project_id, filename, abandoned FROM final_videos;
SELECT id, name, working_video_id, final_video_id FROM projects;
EOF
```

Expected:
- 1 final_video entry (abandoned = FALSE)
- Project has final_video_id set

### 4. Verify File Saved

```bash
ls -la user_data/a/final_videos/
```

### 5. Test Project Progress

```bash
curl http://localhost:8000/api/projects
```

Expected:
- Project should show 100% progress (all clips framed + final video exists)

### 6. Test Re-export

```bash
# Export again
curl -X POST http://localhost:8000/api/export/overlay \
  -F "project_id=1" \
  -F "video=@/path/to/test-video.mp4" \
  -F 'overlay_data={}'

# Check database
sqlite3 user_data/a/database.sqlite << 'EOF'
SELECT id, filename, abandoned FROM final_videos;
SELECT final_video_id FROM projects WHERE id = 1;
EOF
```

Expected:
- 2 final_video entries (first has abandoned = TRUE)
- Project points to new final_video_id

### 7. Test Without Working Video (Should Fail)

```bash
# Create new project without framing export
curl -X POST http://localhost:8000/api/projects \
  -H "Content-Type: application/json" \
  -d '{"name": "No Working", "aspect_ratio": "16:9"}'

# Try overlay export (should fail)
curl -X POST http://localhost:8000/api/export/overlay \
  -F "project_id=2" \
  -F "video=@/path/to/test-video.mp4" \
  -F 'overlay_data={}'
```

Expected: 400 error "Project must have a working video before overlay export"

### 8. Test via UI

1. Open the app
2. Select project with working video
3. Switch to Overlay mode
4. Make some overlay edits (add highlights)
5. Click Export
6. Wait for export to complete
7. Check:
   - Success message appears
   - Project shows 100% progress
   - Database has final_video entry
   - File exists in final_videos folder

### 9. Verify Final Video Streaming

```bash
curl http://localhost:8000/api/export/projects/1/final-video -o downloaded_final.mp4
ffplay downloaded_final.mp4
```

## Success Criteria

- [ ] POST /api/export/overlay accepts project_id, video, overlay_data
- [ ] Rejects if no working_video exists
- [ ] Video file saved to user_data/a/final_videos/
- [ ] final_videos DB entry created
- [ ] project.final_video_id updated
- [ ] Previous final_video marked abandoned on re-export
- [ ] GET endpoint streams the final video
- [ ] Project progress shows 100% after overlay export
- [ ] UI shows success after export
