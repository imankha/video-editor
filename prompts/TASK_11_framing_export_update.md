# Task 11: Framing Export - Create Working Video

## Objective
Update the Framing export to:
1. Save the exported video to `user_data/a/working_videos/`
2. Create entry in `working_videos` table
3. Update `project.working_video_id`
4. Mark previous working_video as abandoned (if re-exporting)
5. Update working_clips progress to 1

## Dependencies
- Tasks 01-10 completed
- Project with clips exists

## Files to Modify

### 1. `src/backend/app/routers/export.py`

Add or update the framing export endpoint:

```python
# Add imports at top
from app.database import get_db_connection, WORKING_VIDEOS_PATH
import uuid

# Add new endpoint or modify existing
@router.post("/framing")
async def export_framing(
    project_id: int = Form(...),
    video: UploadFile = File(...),
    clips_data: str = Form(...)  # JSON string of clip configurations
):
    """
    Export framed video for a project.

    This endpoint:
    1. Receives the rendered video from the frontend
    2. Saves it to working_videos folder
    3. Creates working_videos DB entry
    4. Updates project.working_video_id
    5. Marks previous working_video as abandoned
    6. Sets all working_clips.progress = 1

    Request:
    - project_id: The project ID
    - video: The rendered video file
    - clips_data: JSON with clip configurations (for metadata)

    Response:
    - success: boolean
    - working_video_id: The new working video ID
    - filename: The saved filename
    """
    logger.info(f"Framing export for project {project_id}")

    try:
        clips_config = json.loads(clips_data)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid clips_data JSON")

    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Verify project exists
        cursor.execute("SELECT id, working_video_id FROM projects WHERE id = ?", (project_id,))
        project = cursor.fetchone()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        # Generate unique filename
        filename = f"working_{project_id}_{uuid.uuid4().hex[:8]}.mp4"
        file_path = WORKING_VIDEOS_PATH / filename

        # Save the video file
        content = await video.read()
        with open(file_path, 'wb') as f:
            f.write(content)

        logger.info(f"Saved working video: {filename} ({len(content)} bytes)")

        # Mark previous working video as abandoned
        if project['working_video_id']:
            cursor.execute("""
                UPDATE working_videos SET abandoned = TRUE WHERE id = ?
            """, (project['working_video_id'],))
            logger.info(f"Marked previous working video as abandoned: {project['working_video_id']}")

            # Also abandon the final video since framing changed
            cursor.execute("""
                SELECT final_video_id FROM projects WHERE id = ?
            """, (project_id,))
            proj = cursor.fetchone()
            if proj and proj['final_video_id']:
                cursor.execute("""
                    UPDATE final_videos SET abandoned = TRUE WHERE id = ?
                """, (proj['final_video_id'],))
                cursor.execute("""
                    UPDATE projects SET final_video_id = NULL WHERE id = ?
                """, (project_id,))
                logger.info(f"Abandoned final video due to framing change")

        # Create new working video entry
        cursor.execute("""
            INSERT INTO working_videos (project_id, filename)
            VALUES (?, ?)
        """, (project_id, filename))
        working_video_id = cursor.lastrowid

        # Update project with new working video ID
        cursor.execute("""
            UPDATE projects SET working_video_id = ? WHERE id = ?
        """, (working_video_id, project_id))

        # Update all working clips to progress = 1 (framed)
        cursor.execute("""
            UPDATE working_clips
            SET progress = 1
            WHERE project_id = ? AND abandoned = FALSE
        """, (project_id,))

        conn.commit()

        logger.info(f"Created working video {working_video_id} for project {project_id}")

        return JSONResponse({
            'success': True,
            'working_video_id': working_video_id,
            'filename': filename,
            'project_id': project_id
        })


@router.get("/projects/{project_id}/working-video")
async def get_working_video(project_id: int):
    """Stream the working video for a project."""
    with get_db_connection() as conn:
        cursor = conn.cursor()

        cursor.execute("""
            SELECT wv.filename
            FROM projects p
            JOIN working_videos wv ON p.working_video_id = wv.id
            WHERE p.id = ? AND wv.abandoned = FALSE
        """, (project_id,))
        result = cursor.fetchone()

        if not result:
            raise HTTPException(status_code=404, detail="Working video not found")

        file_path = WORKING_VIDEOS_PATH / result['filename']
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Video file not found")

        return FileResponse(
            path=str(file_path),
            media_type="video/mp4",
            filename=result['filename']
        )
```

### 2. Update Frontend Export Handler

In App.jsx, update the framing export to call the new endpoint:

```javascript
/**
 * Handle framing export completion
 * Called when the video blob is ready from the export process
 */
const handleFramingExportComplete = useCallback(async (videoBlob, clipsData) => {
  if (!selectedProjectId) {
    console.error('[App] No project selected for framing export');
    return;
  }

  console.log('[App] Framing export complete, saving to server...');

  try {
    // Create form data with video and metadata
    const formData = new FormData();
    formData.append('project_id', selectedProjectId.toString());
    formData.append('video', videoBlob, 'framed_video.mp4');
    formData.append('clips_data', JSON.stringify(clipsData));

    const response = await fetch('http://localhost:8000/api/export/framing', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || 'Failed to save framing export');
    }

    const result = await response.json();
    console.log('[App] Framing export saved:', result);

    // Refresh project to get updated working_video_id
    await refreshSelectedProject();

    // Optionally switch to Overlay mode
    // setEditorMode('overlay');

    // Show success (could use a toast notification)
    console.log('[App] Working video created, Overlay mode now available');

  } catch (err) {
    console.error('[App] Failed to save framing export:', err);
    alert(`Failed to save export: ${err.message}`);
  }
}, [selectedProjectId, refreshSelectedProject]);
```

### 3. Integrate with Existing Export Button

The existing ExportButton component needs to:
1. Pass the project_id to the export
2. Call handleFramingExportComplete with the result

**Note:** The exact integration depends on how the current export works. The key is:
- After FFmpeg processing returns a video blob
- Call the new `/api/export/framing` endpoint
- Pass project_id, video blob, and clips metadata

## Testing Steps

### 1. Prepare Test Data

```bash
# Ensure a project exists with clips
curl -X POST http://localhost:8000/api/projects \
  -H "Content-Type: application/json" \
  -d '{"name": "Test Framing", "aspect_ratio": "16:9"}'

# Note the project ID (e.g., 1)

# Upload a clip to the project
curl -X POST http://localhost:8000/api/clips/projects/1/clips \
  -F "file=@/path/to/test-video.mp4"
```

### 2. Test Export API Directly

```bash
# Test the export endpoint
curl -X POST http://localhost:8000/api/export/framing \
  -F "project_id=1" \
  -F "video=@/path/to/test-video.mp4" \
  -F 'clips_data=[]'
```

Expected response:
```json
{
  "success": true,
  "working_video_id": 1,
  "filename": "working_1_abc123.mp4",
  "project_id": 1
}
```

### 3. Verify Database

```bash
sqlite3 user_data/a/database.sqlite << 'EOF'
.headers on
SELECT id, project_id, filename, abandoned FROM working_videos;
SELECT id, name, working_video_id, final_video_id FROM projects;
SELECT id, project_id, progress FROM working_clips WHERE abandoned = FALSE;
EOF
```

Expected:
- 1 working_video entry (abandoned = FALSE)
- Project has working_video_id set
- Working clips have progress = 1

### 4. Verify File Saved

```bash
ls -la user_data/a/working_videos/
```

### 5. Test Re-export

```bash
# Export again
curl -X POST http://localhost:8000/api/export/framing \
  -F "project_id=1" \
  -F "video=@/path/to/test-video.mp4" \
  -F 'clips_data=[]'

# Check database
sqlite3 user_data/a/database.sqlite << 'EOF'
SELECT id, filename, abandoned FROM working_videos;
SELECT working_video_id FROM projects WHERE id = 1;
EOF
```

Expected:
- 2 working_video entries (first has abandoned = TRUE)
- Project points to new working_video_id

### 6. Test via UI

1. Open the app
2. Select project with clips
3. Make some framing edits
4. Click Export
5. Wait for export to complete
6. Check:
   - Overlay tab becomes enabled
   - Database shows working_video entry
   - File exists in working_videos folder

### 7. Verify Overlay Mode Access

1. After export, click Overlay tab
2. Should be able to switch to Overlay mode
3. Should load the working video

## Success Criteria

- [ ] POST /api/export/framing accepts project_id, video, clips_data
- [ ] Video file saved to user_data/a/working_videos/
- [ ] working_videos DB entry created
- [ ] project.working_video_id updated
- [ ] Previous working_video marked abandoned on re-export
- [ ] Previous final_video abandoned when framing changes
- [ ] working_clips.progress set to 1
- [ ] GET endpoint streams the working video
- [ ] Overlay mode becomes accessible after export
