# T2630 Kickoff Prompt

> Copy everything below the line into a fresh Claude Code session.

---

## Implement T2630: Add Game Import UI

### Epic Context

This is task 7 of 7 in the **Video Link Import** epic.
Read: `docs/plans/tasks/video-import/EPIC.md`

### Prior Task Learnings

- **T2620** (Import Backend Service): Created `POST /api/games/import-url` (202) and `GET /api/games/imports/{import_id}/progress`. Backend detects platform from URL, spawns background import, returns `import_id` immediately. Progress dict has: `import_id`, `status` (resolving/checking_credits/downloading/uploading/creating_game/complete/error), `platform` (veo/trace), `progress_pct` (0-100), `downloaded_bytes`, `total_bytes`, `error`, `error_code`, `game_id`. One import per user enforced server-side.
- **T2625** (Modal Video Ingest): Moved ffmpeg/blake3/R2 upload to Modal. `call_modal_ingest()` handles both Veo (direct MP4) and Trace (HLS remux).
- **T2627** (Optimize Modal Ingest): Hash-during-download + parallel multipart upload. Veo ~2 min, Trace ~1.5-8 min depending on CDN warmth.
- **T2628** (Timeout & Retry): Modal timeout reduced to 600s, per-attempt 600s timeout + 180s stall detection. After 3 failed attempts, backend returns `{"status": "error", "error": "Import failed after multiple attempts...", "error_code": "INGEST_EXHAUSTED"}`. During retries, progress callback sends `"Retrying... attempt 2/3"` messages.

### Task Details

Read: `docs/plans/tasks/video-import/T2630-add-game-import-ui.md`

### What to Build

Add a "Paste Link" option to the existing `GameDetailsModal` so users can import games from Veo/Trace URLs instead of uploading files. Two files to modify:

1. **`src/frontend/src/components/GameDetailsModal.jsx`** — the main UI changes
2. **`src/frontend/src/components/ProjectManager.jsx`** — handle import flow in `handleCreateGame`

### Current Architecture (read these files)

**GameDetailsModal.jsx** (557 lines): Modal with form fields (opponent, date, game type, tournament, video format toggle, file upload with drag-drop). Submits via `onCreateGame(gameDetails)` where `gameDetails = { opponentName, gameDate, gameType, tournamentName, videoMode, file/files }`. Has credit check against `useCreditStore` balance — shows `BuyCreditsModal` if insufficient.

**ProjectManager.jsx** `handleCreateGame` (line 394): Simply calls `onAnnotateWithFile(gameDetails)`. That prop comes from `ProjectsScreen.jsx` line 227: `handleAnnotateWithFile` sets `pendingGameData` and navigates to annotate mode. The annotate screen then handles the actual upload to the backend.

**Backend endpoints** (in `src/backend/app/routers/games.py`):
- `POST /api/games/import-url` — accepts `{ url, opponent_name?, game_date?, game_type? }`, returns 202 with initial progress dict
- `GET /api/games/imports/{import_id}/progress` — returns progress dict (see schema above)

**Backend import orchestrator** (`src/backend/app/services/game_import.py`):
- `detect_platform(url)` uses regex: Veo = `app.veo.co/matches/{uuid}`, Trace = `go.traceup.com/traceid/athlete/{hash}/watch/{game_id}`
- `start_import()` validates URL, enforces one-import-per-user, spawns background `_run_import()`, returns immediately
- Progress updates in-memory dict through stages: resolving → checking_credits → downloading → creating_game → complete/error
- Veo: always `per_game` (single file). Trace: always `per_half` (two halves processed in parallel)
- Auto-fills metadata from platform: Veo `og:title` → team names, Trace GraphQL → home/away teams + date + score

**Game constants** (`src/frontend/src/constants/gameConstants.js`):
```javascript
export const GameType = { HOME: 'home', AWAY: 'away', TOURNAMENT: 'tournament' };
export const VideoMode = { PER_GAME: 'per_game', PER_HALF: 'per_half' };
```

### Implementation Plan

#### 1. GameDetailsModal: Video Source Toggle

Replace the current video upload section with a toggle between two modes:

```
[ Upload File ]  [ Paste Link ]
```

- **Upload File** (default): existing drag-and-drop behavior, completely unchanged
- **Paste Link**: new URL input + platform detection + help

Style the toggle like the existing Video Format buttons (green when active, gray-700 when inactive).

#### 2. Paste Link Mode UI

When "Paste Link" is selected, show:

- **URL input field** with placeholder `"Paste a Veo or Trace game link"`
- **Platform detection** (as user types, debounced or on blur):
  - Match `app.veo.co/matches/` → show "Veo match detected" with green accent
  - Match `go.traceup.com/traceid/` → show "Trace game detected" with green accent
  - No match → subtle hint: "Supports Veo and Trace links"
- **Help icon** `(?)` next to the input — on click, show a small overlay/popover with tabbed instructions:
  - **Veo tab**: 1) Open game on app.veo.co → 2) Click share icon → 3) Copy the link → 4) Paste here
  - **Trace tab**: 1) Open game on go.traceup.com → 2) Copy URL from address bar → 3) Paste here
  - Text-only for now (screenshots can be added later)

When Trace URL is detected:
- Auto-set `videoMode: VideoMode.PER_HALF`
- Hide or disable the Video Format toggle (Trace is always per-half)

When Veo URL is detected:
- Auto-set `videoMode: VideoMode.PER_GAME`
- Hide or disable the Video Format toggle (Veo is always per-game)

#### 3. Form Validation

- `isValid` should account for import mode: `opponentName.trim() && gameDate && (hasVideo || importUrl.trim())`
- URL validation happens on submit (not every keystroke) — the backend's `detect_platform()` does the real validation
- Frontend regex for instant feedback only (non-blocking):
  ```javascript
  const VEO_PATTERN = /https?:\/\/app\.veo\.co\/matches\/[^/?#]+/;
  const TRACE_PATTERN = /https?:\/\/go\.traceup\.com\/traceid\/athlete\/[^/]+\/watch\/\d+/;
  ```

#### 4. Submit Flow (Import Mode)

When the form has `importUrl` instead of a file:

**In GameDetailsModal `submitGame`:**
- Build `gameDetails` with `importUrl` and `importPlatform` instead of `file`/`files`
- No client-side credit check needed (backend handles it during import)
- Call `onCreateGame(gameDetails)` as usual

**In ProjectManager `handleCreateGame`:**
- Detect import mode: `if (gameDetails.importUrl) { /* import flow */ } else { /* existing upload flow */ }`
- Import flow:
  1. `POST /api/games/import-url` with `{ url: gameDetails.importUrl, opponent_name, game_date, game_type }`
  2. Get `import_id` from response
  3. Start polling `GET /api/games/imports/{import_id}/progress` every 2 seconds
  4. Update modal UI with progress (keep modal open during import)
  5. On `status === "complete"` → navigate to the new game (use `game_id` from response)
  6. On `status === "error"` → show error in modal

**Important architecture decision:** The import progress UI should stay inside `GameDetailsModal` (don't close the modal and show progress elsewhere). The modal transitions from form → progress view once the import starts.

#### 5. Progress State UI

After submitting a link, the modal form transforms into a progress view:

- **Resolving**: "Checking video..." with a spinner
- **Checking credits**: "Checking storage credits..." (brief, auto-advances)
- **Downloading**: Progress bar with percentage + bytes: `"Downloading from Veo... 42% (1.3 GB / 3.2 GB)"`
  - Use `progress_pct`, `downloaded_bytes`, `total_bytes` from the progress response
  - Format bytes with `(n / (1024*1024*1024)).toFixed(1) + " GB"` for sizes > 1GB
- **Creating game**: "Setting up your game..." with spinner
- **Complete**: Brief success message → auto-navigate to annotate view

During retry (backend sends progress updates like "Retrying... attempt 2/3"):
- Show the retry message in the progress area
- Keep progress bar visible but reset percentage
- Do NOT show an error — the backend is still trying

#### 6. Error States

- **400 from POST /import-url** (invalid URL): Show inline validation error below the URL input: `"This URL isn't recognized. Paste a link from app.veo.co or go.traceup.com"`
- **400 "Import already in progress"**: `"You already have an import running. Wait for it to finish."`
- **Progress shows `error` without `error_code`**: Generic error: `"Import failed. Please try again or upload the file directly."`
- **Progress shows `error_code: "INGEST_EXHAUSTED"`**: Special exhaustion state:
  - Header: "Import unavailable right now"
  - Body: "We tried 3 times but the video server is responding too slowly. This usually resolves on its own."
  - Primary button: "Try Again Later" (closes modal)
  - Secondary button: "Upload File Instead" (switches to Upload File tab, keeps form data)
  - Do NOT auto-retry from the UI

#### 7. State Management Rules

- **Do NOT use localStorage** for tab preference (CLAUDE.md rule: "Don't use localStorage — all persistence via SQLite + R2"). Default to "Upload File" tab every time.
- **Import progress is ephemeral** — use `useState` in the modal, not Zustand. The progress data is temporary and dies with the modal.
- **Platform detection regex** should be defined as constants, not inline.
- **No reactive useEffect for persistence** — the POST to start the import happens in the submit handler (gesture-based).
- **Polling useEffect is fine** — it's read-only (GET requests only), not persisting state.

### Files to Read Before Starting

1. `CLAUDE.md` — project rules (especially persistence, coding standards, no localStorage)
2. `src/frontend/CLAUDE.md` — frontend patterns (MVC, state management, no localStorage, WebSocket preference)
3. `.claude/references/ui-style-guide.md` — colors, buttons, spacing
4. `.claude/references/coding-standards.md` — MVC, state rules
5. `src/frontend/src/components/GameDetailsModal.jsx` — the file you're modifying
6. `src/frontend/src/components/ProjectManager.jsx` — handleCreateGame at line 394
7. `src/frontend/src/screens/ProjectsScreen.jsx` — handleAnnotateWithFile at line 227
8. `src/frontend/src/constants/gameConstants.js` — GameType, VideoMode constants
9. `src/backend/app/routers/games.py` lines 643-681 — import endpoints (request/response shapes)
10. `src/backend/app/services/game_import.py` lines 31-44 — ImportStatus and Platform enums (match these in frontend)
11. `docs/plans/tasks/video-import/T2630-add-game-import-ui.md` — full task spec

### What NOT to Change

- Do NOT modify any backend files — the backend is complete and deployed
- Do NOT change the existing upload flow — it must continue working exactly as-is
- Do NOT add new Zustand stores — import progress is local to the modal
- Do NOT use WebSockets for import progress (no WS endpoint exists) — use polling
- Do NOT use localStorage (project rule)

### Testing

After implementing:
1. Run frontend build check: `cd src/frontend && npx vite build 2>&1 > /tmp/build-output.log; echo "exit: $?"`
2. Start dev server and test in browser using the auth bypass pattern from `src/frontend/CLAUDE.md`
3. Test the golden path: paste a Veo URL → see platform detection → submit → see progress → game created
4. Test error paths: invalid URL, empty URL
5. Test that the existing upload flow still works (regression check)
6. Test toggle between Upload File and Paste Link tabs

### After Implementation

- Commit on branch `feature/T2625-modal-video-ingest` (the epic branch — no new branch needed)
- Update `docs/plans/PLAN.md`: set T2630 status to TESTING
- Update `docs/plans/tasks/video-import/T2630-add-game-import-ui.md`: set status to TESTING
