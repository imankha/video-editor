# Task: Fix Gallery Download Buttons

## Overview
Neither of the two download buttons in the Gallery/Downloads panel are working:
1. **Download icon** (gray down arrow) in the video list
2. **Download button** in the video player modal

## Status
**TODO** - Ready for investigation and fix

## Priority
**HIGH** - Core feature not working

---

## Current Architecture

### Components Involved

| Component | File | Purpose |
|-----------|------|---------|
| DownloadsPanel | `src/frontend/src/components/DownloadsPanel.jsx` | Main gallery UI |
| useDownloads hook | `src/frontend/src/hooks/useDownloads.js` | API interactions |
| downloads router | `src/backend/app/routers/downloads.py` | Backend API |

### Download Flow (Current)

```
User clicks download button
    ↓
handleDownload() → downloadFile(downloadId)
    ↓
getDownloadUrl(downloadId, download)
    ↓
Returns either:
  - download.file_url (presigned R2 URL) ← PREFERRED
  - OR /api/downloads/{id}/file (fallback)
    ↓
Create <a> element, set href, trigger click()
    ↓
Browser should download file
```

### Key Code Locations

**List download icon** (DownloadsPanel.jsx:269-275):
```javascript
<button
  onClick={(e) => handleDownload(e, download)}
  className="p-2 hover:bg-gray-600 rounded transition-colors"
  title="Download file"
>
  <Download size={16} className="text-gray-400 hover:text-white" />
</button>
```

**Player download button** (DownloadsPanel.jsx:501-511):
```javascript
<Button
  variant="primary"
  size="sm"
  icon={Download}
  onClick={() => {
    downloadFile(playingVideo.id);
  }}
>
  Download
</Button>
```

**downloadFile function** (useDownloads.js:150-175):
```javascript
const downloadFile = useCallback(async (downloadId) => {
  try {
    const download = downloads.find(d => d.id === downloadId);
    const url = getDownloadUrl(downloadId, download);

    // Create link and trigger download
    const link = document.createElement('a');
    link.href = url;
    link.download = download?.project_name
      ? `${download.project_name.replace(/[^a-z0-9]/gi, '_')}_final.mp4`
      : 'video.mp4';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (error) {
    console.error('Download failed:', error);
  }
}, [downloads, getDownloadUrl]);
```

---

## Potential Issues to Investigate

### 1. Presigned URL Problems

**Check if `file_url` is populated:**
```javascript
// In browser console while Gallery is open:
// Check if downloads have file_url
```

**Possible causes:**
- R2 file doesn't exist (upload failed during export)
- `verify_exists=True` returns None when file missing
- Presigned URL expired (1-hour lifetime)

### 2. Cross-Origin Download Issues

When downloading from R2 presigned URL:
- Browser may block cross-origin downloads
- `link.download` attribute doesn't work for cross-origin URLs
- Need to use different approach for R2 files

**This is likely the main issue** - the `download` attribute on `<a>` tags only works for same-origin URLs. For cross-origin (R2) URLs, we need to:
- Fetch the blob first, then create object URL
- OR use backend as proxy with Content-Disposition header

### 3. Backend Redirect Issue

The `/api/downloads/{id}/file` endpoint returns HTTP 302 redirect to R2:
```python
return RedirectResponse(
    url=r2_presigned_url,
    status_code=302
)
```

Browser `<a>` click may not follow redirects properly for downloads.

### 4. File Not Found

**Database has record but file doesn't exist:**
- Export failed partway through
- Manual file deletion
- R2 sync issue

---

## Proposed Solutions

### Solution A: Fetch Blob, Then Download (Recommended)

For cross-origin URLs, fetch the file as blob first:

```javascript
const downloadFile = useCallback(async (downloadId) => {
  const download = downloads.find(d => d.id === downloadId);
  const url = getDownloadUrl(downloadId, download);
  const filename = download?.project_name
    ? `${download.project_name.replace(/[^a-z0-9]/gi, '_')}_final.mp4`
    : 'video.mp4';

  try {
    // Fetch as blob (works for cross-origin)
    const response = await fetch(url);
    if (!response.ok) throw new Error('Download failed');

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Cleanup
    URL.revokeObjectURL(objectUrl);
  } catch (error) {
    console.error('Download failed:', error);
    // Show user-facing error
  }
}, [downloads, getDownloadUrl]);
```

**Pros:**
- Works for both same-origin and cross-origin URLs
- Filename is controlled by frontend
- Progress can be tracked

**Cons:**
- Entire file loaded into memory before download starts
- No progress feedback during fetch (can add with streaming)

### Solution B: Backend Proxy with Content-Disposition

Always use backend as download proxy:

```python
@router.get("/{download_id}/download")
async def download_file_direct(download_id: int):
    """Stream file with proper Content-Disposition header."""
    # Get presigned URL or local path
    # Stream file through backend with proper headers
    return StreamingResponse(
        content=stream_from_r2_or_local(),
        media_type="video/mp4",
        headers={
            "Content-Disposition": f'attachment; filename="{safe_filename}"'
        }
    )
```

**Pros:**
- Works reliably across all browsers
- Backend controls filename
- Can add download tracking/logging

**Cons:**
- Backend bandwidth usage
- Slower for large files
- Additional server load

### Solution C: Hybrid Approach

1. Try direct R2 download with blob fetch
2. On failure, fallback to backend proxy
3. Show progress indicator

---

## Implementation Plan

### Task 1: Debug Current Implementation

Add logging to understand where it fails:

```javascript
const downloadFile = useCallback(async (downloadId) => {
  console.log('[Download] Starting download for ID:', downloadId);

  const download = downloads.find(d => d.id === downloadId);
  console.log('[Download] Found download:', download);
  console.log('[Download] file_url:', download?.file_url);

  const url = getDownloadUrl(downloadId, download);
  console.log('[Download] Using URL:', url);

  // ... rest of function
}, [downloads, getDownloadUrl]);
```

### Task 2: Implement Blob Fetch Download

Replace link-click approach with fetch-blob approach for reliability.

### Task 3: Add Progress Indicator

Show download progress in UI:
- Loading spinner on download button
- Progress bar for large files

### Task 4: Error Handling

- Show toast/notification if download fails
- Provide retry option
- Handle 404 (file not found) gracefully

### Task 5: Test All Scenarios

- [ ] Download via list icon (presigned URL)
- [ ] Download via player button (presigned URL)
- [ ] Download when file_url is null (fallback to backend)
- [ ] Download after presigned URL expired (should refresh)
- [ ] Download large file (>100MB)
- [ ] Download with special characters in filename

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/frontend/src/hooks/useDownloads.js` | Fix downloadFile() to use blob fetch |
| `src/frontend/src/components/DownloadsPanel.jsx` | Add loading state, error handling |
| `src/backend/app/routers/downloads.py` | Optional: Add streaming proxy endpoint |

---

## Verification

1. Open Gallery panel
2. Select a video with final export
3. Click download icon in list - file should download
4. Open video in player
5. Click Download button - file should download
6. Check downloaded filename matches project name
7. Verify downloaded video plays correctly
