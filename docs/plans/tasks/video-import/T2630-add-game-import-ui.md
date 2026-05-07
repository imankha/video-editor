# T2630: Add Game Import UI

## Summary

Modify the Add Game modal (GameDetailsModal) to offer "Paste Link" as an alternative to file upload. Includes URL validation for Veo and Trace, progress tracking during server-side download, and a help overlay explaining how to find the share link on each platform.

## Prerequisites

- T2620 (Import Backend Service) — TESTING or DONE

## Implementation Plan

### GameDetailsModal Changes

#### Video Source Toggle

Replace the current upload-only section with a toggle:

```
[ Upload File ]  [ Paste Link ]
```

- **Upload File** (default): existing drag-and-drop behavior, unchanged
- **Paste Link**: URL input field + platform detection + help

#### Paste Link Mode

- Text input with placeholder: `Paste a Veo or Trace game link`
- Auto-detect platform from URL pattern as user types:
  - `app.veo.co/matches/...` → show Veo icon + "Veo match detected"
  - `go.traceup.com/traceid/...` → show Trace icon + "Trace game detected"
  - No match → subtle hint: "Supports Veo and Trace links"
- Validation on submit (not on every keystroke)

#### Help Icon (?)

Small `?` icon next to the URL input. On click, opens a help overlay/tooltip with platform-specific instructions:

**Veo tab:**
1. Open your game on app.veo.co
2. Click the share icon (or three-dot menu → Share)
3. Copy the link
4. Paste it here

**Trace tab:**
1. Open your game on go.traceup.com
2. Copy the URL from your browser's address bar
3. Paste it here

Each tab should have a simple illustration or annotated screenshot showing where to click. Start with text-only instructions; screenshots can be added later.

#### Progress State

After submit with a link URL:
1. **Resolving** — "Checking video..." (brief)
2. **Credit check** — Show file size + credit cost, same confirmation as file upload
3. **Downloading** — Progress bar: "Downloading from Veo... 42% (1.3 GB / 3.2 GB)"
4. **Creating game** — "Setting up your game..."
5. **Complete** — Navigate to annotation view (same as file upload completion)

Poll `GET /api/games/imports/{import_id}/progress` every 2s during download.

#### Error States

- Invalid URL → inline validation error below input
- Private/deleted game → "This game may be private. Make sure it's set to Public on [Veo/Trace]."
- Insufficient credits → same credit gate as file upload
- Download failed (single attempt) → "Import failed. Please try again or upload the file directly."
- **Import exhausted (all retries failed)** → Backend returns `error_code: "INGEST_EXHAUSTED"`. Show a distinct error state:
  - Header: "Import unavailable right now"
  - Body: "We tried to import this video 3 times but the video server is responding too slowly. This usually resolves on its own."
  - Primary action: "Try Again Later" (dismisses modal)
  - Secondary action: "Upload File Instead" (switches to Upload File tab with the same game details pre-filled)
  - Do NOT auto-retry from the UI — the backend already exhausted 3 attempts with backoff
- **Import timeout (single attempt, retrying)** → Progress bar shows "Retrying... attempt 2/3" (already sent via progress callback from backend). Keep the modal open, don't show an error yet — only show error after all attempts are exhausted.

### gameDetails Object Extension

```javascript
{
  opponentName: string,
  gameDate: string,
  gameType: 'home' | 'away' | 'tournament',
  tournamentName: string | null,
  videoMode: 'per_game' | 'per_half',
  // Existing (upload mode):
  file?: File,
  files?: [File, File],
  // New (import mode):
  importUrl?: string,
  importPlatform?: 'veo' | 'trace',
}
```

When `importUrl` is present, the parent handler calls the import endpoint instead of the upload flow.

### Video Mode for Trace

Trace games are always per-half (two separate video files). When a Trace URL is detected:
- Auto-set `videoMode: 'per_half'`
- Hide the video format toggle (or gray it out with explanation)

Veo games are always a single file → `videoMode: 'per_game'`.

## Files Affected
- `src/frontend/src/components/GameDetailsModal.jsx` — toggle, URL input, help, progress
- `src/frontend/src/components/ProjectManager.jsx` — handle import vs upload in `handleCreateGame`

## UX Considerations
- Default to "Upload File" tab — don't assume users have links
- Remember last-used tab in localStorage for returning users
- The help content should be scannable in 5 seconds — not a wall of text
- Progress bar should feel responsive (2s poll interval)
