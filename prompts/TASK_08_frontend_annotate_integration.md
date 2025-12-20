# Task 08: Frontend Annotate Export Integration

## Context

**Project:** Browser-based video editor for soccer highlights with Annotate, Framing, and Overlay modes.

**Tech Stack:**
- Frontend: React 18 + Vite (port 5173)
- Backend: FastAPI + Python (port 8000)

**Annotate Hook (useAnnotate.js):**
```javascript
const { clipRegions, getExportData, resetAnnotate } = useAnnotate();

// getExportData() returns:
[{
  start_time: 150.5,
  end_time: 165.5,
  name: "Brilliant Goal",
  notes: "Amazing finish",
  rating: 5,
  tags: ["Goal", "1v1 Attack"]
}]
```

**Export Endpoint Response (from Task 07):**
```javascript
{
  success: true,
  downloads: {
    full_annotated: { filename: "...", data: "<base64>" },
    clips_compilation: { filename: "...", data: "<base64>" }
  },
  created: {
    raw_clips: [{ id, filename, rating, name, tags }],
    projects: [{ id, name, type: "game"|"clip", clip_count }]
  }
}
```

**Export Flow:**
1. Format clips for API (remove `position` field if present)
2. POST to `/api/annotate/export` with video + clips_json
3. Download both files using base64 decode
4. Refresh projects list
5. Return to Project Manager

---

## Objective
Update the frontend Annotate mode to:
1. Call the updated export endpoint
2. Handle the two download files
3. Refresh projects list after export
4. Navigate back to Project Manager

## Dependencies
- Task 07 (backend annotate export)
- Task 06 (app refactor with project hooks)

## Files to Modify

### `src/frontend/src/App.jsx`

Update the `handleAnnotateExport` function:

```javascript
/**
 * Handle exporting clips from Annotate mode
 * 1. Send clips to backend
 * 2. Backend saves good/brilliant clips and creates projects
 * 3. Download the two generated files
 * 4. Return to Project Manager
 */
const handleAnnotateExport = useCallback(async (clipData) => {
  console.log('[App] Annotate export requested with clips:', clipData);

  if (!annotateVideoFile || !clipData || clipData.length === 0) {
    console.error('[App] Cannot export: no video or clips');
    return;
  }

  setIsAnnotateExporting(true);
  try {
    console.log('[App] Starting annotate export...');

    // Prepare form data
    const formData = new FormData();
    formData.append('video', annotateVideoFile);

    // Format clips for API (remove position field if present)
    const clipsForApi = clipData.map(clip => ({
      start_time: clip.start_time,
      end_time: clip.end_time,
      name: clip.name,
      notes: clip.notes || '',
      rating: clip.rating || 3,
      tags: clip.tags || []
    }));

    formData.append('clips_json', JSON.stringify(clipsForApi));

    // Call backend export endpoint
    const response = await fetch('http://localhost:8000/api/annotate/export', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || `Export failed: ${response.status}`);
    }

    const result = await response.json();
    console.log('[App] Annotate export response:', {
      success: result.success,
      rawClipsCount: result.created?.raw_clips?.length,
      projectsCount: result.created?.projects?.length
    });

    // Download the two files
    if (result.downloads) {
      // 1. Full annotated video (for restoring session)
      if (result.downloads.full_annotated?.data) {
        const annotatedBlob = base64ToBlob(result.downloads.full_annotated.data, 'video/mp4');
        const downloadUrl = URL.createObjectURL(annotatedBlob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = result.downloads.full_annotated.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(downloadUrl);
        console.log('[App] Downloaded:', result.downloads.full_annotated.filename);
      }

      // 2. Clips compilation (for player review)
      if (result.downloads.clips_compilation?.data) {
        const compilationBlob = base64ToBlob(result.downloads.clips_compilation.data, 'video/mp4');
        const downloadUrl = URL.createObjectURL(compilationBlob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = result.downloads.clips_compilation.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(downloadUrl);
        console.log('[App] Downloaded:', result.downloads.clips_compilation.filename);
      }
    }

    // Clean up annotate state
    if (annotateVideoUrl) {
      URL.revokeObjectURL(annotateVideoUrl);
    }
    setAnnotateVideoFile(null);
    setAnnotateVideoUrl(null);
    setAnnotateVideoMetadata(null);
    resetAnnotate();

    // Refresh projects list
    await fetchProjects();

    // Show success message with what was created
    const projectsCreated = result.created?.projects?.length || 0;
    const clipsCreated = result.created?.raw_clips?.length || 0;

    if (clipsCreated > 0) {
      console.log(`[App] Created ${clipsCreated} clips and ${projectsCreated} projects`);
      // Optionally show a toast notification here
    }

    // Return to Project Manager
    setEditorMode('project-manager');

    console.log('[App] Annotate export complete');

  } catch (err) {
    console.error('[App] Annotate export failed:', err);
    alert(`Export failed: ${err.message}`);
  } finally {
    setIsAnnotateExporting(false);
  }
}, [
  annotateVideoFile,
  annotateVideoUrl,
  base64ToBlob,
  resetAnnotate,
  fetchProjects
]);
```

### Also update the export data format in `useAnnotate.js`

The `getExportData` function should NOT include `position`:

```javascript
/**
 * Get export data for all clip regions
 * @returns {Array} - Array of clip data for export
 */
const getExportData = useCallback(() => {
  return clipRegions.map(region => ({
    start_time: region.startTime,
    end_time: region.endTime,
    name: region.name,
    // NOTE: position removed - not used by backend
    tags: region.tags || [],
    notes: region.notes || '',
    rating: region.rating || 3
  }));
}, [clipRegions]);
```

## Testing Steps

### 1. Start Both Servers

```bash
# Terminal 1 - Backend
cd src/backend
python -m uvicorn app.main:app --reload --port 8000

# Terminal 2 - Frontend
cd src/frontend
npm run dev
```

### 2. Clear Previous Data

```bash
rm -rf user_data/a/raw_clips/*
sqlite3 user_data/a/database.sqlite "DELETE FROM raw_clips; DELETE FROM working_clips; DELETE FROM projects;"
```

### 3. Load App and Enter Annotate Mode

1. Open http://localhost:5173
2. Should see Project Manager (no projects)
3. Click "Annotate Game"
4. Select a test video file

### 4. Create Test Clips

1. Pause the video at different points
2. Create clips with various ratings:
   - One 5-star "Brilliant" clip
   - One 4-star "Good" clip
   - One 3-star "Interesting" clip (won't be saved)
3. Add tags and notes to each

### 5. Export

1. Click the Export button
2. Wait for export to complete (may take a moment)
3. **Verify:**
   - Two files download (full_annotated.mp4 and clips_review.mp4)
   - Console shows success logs
   - Automatically returns to Project Manager

### 6. Verify Projects Created

1. Should see new projects in Project Manager:
   - "{videoname}_game" project (16:9)
   - "{clipname}_clip" project for the 5-star clip (9:16)
2. Each project should show correct clip count

### 7. Verify Downloaded Files

1. **Full Annotated Video:**
   - Play the downloaded file
   - Check metadata: `ffprobe -v quiet -print_format json -show_format downloaded_annotated.mp4`
   - Should have clip info in description metadata

2. **Clips Compilation:**
   - Play the downloaded file
   - Should see burned-in text with clip names, ratings, tags, notes

### 8. Verify Database

```bash
sqlite3 user_data/a/database.sqlite << 'EOF'
.headers on
SELECT id, filename, rating FROM raw_clips;
SELECT id, name, aspect_ratio FROM projects;
SELECT id, project_id, raw_clip_id FROM working_clips WHERE abandoned = FALSE;
EOF
```

Should show:
- 2 raw_clips (4-star and 5-star only)
- 2 projects
- 3 working_clips (2 in game project, 1 in individual project)

### 9. Select and View a Project

1. Click on the game project
2. Should switch to Framing mode
3. Should see the clips in the sidebar (may need additional work to load them)

## Success Criteria

- [ ] Export button triggers the new backend endpoint
- [ ] Two files download automatically
- [ ] Full annotated video has metadata
- [ ] Clips compilation has burned-in text
- [ ] Only 4+ star clips saved to database
- [ ] Projects created correctly
- [ ] Projects list refreshes after export
- [ ] App returns to Project Manager after export
- [ ] No console errors during export flow
- [ ] 3-star clips appear in downloads but NOT saved to DB
