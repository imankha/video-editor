# T415: Smart Guest Merge on Login

**Status:** TESTING
**Impact:** 7
**Complexity:** 3
**Created:** 2026-03-27
**Updated:** 2026-03-27

## Problem

T410 implemented guest profile migration, but it's too aggressive — it **always** creates a new "Guest N" profile on the recovered account. This is never necessary because guest data can always be merged into the existing default profile.

### 1. Unnecessary profile branching

User reported: logged in as guest, uploaded a game, clicked "Add Clip" (which triggered auth gate), logged in with Google. After login:
- The game they uploaded ended up in a new "Guest 1" profile
- Their original default profile (selected after reload) showed "No games yet"
- They now have two profiles when they expected one

### 2. Auth return loses annotation context

When cross-device recovery triggers, the app reloads (`window.location.reload()`). Before reload, `authStore.js:65-68` saves `editorMode` and `selectedProjectId` to sessionStorage. But:

- When annotating a game (before any project exists), `selectedProjectId` is null — nothing useful is saved
- The game ID (`selectedGame` from `gamesDataStore`) is not saved
- After reload, the user lands on the project manager with no context of what they were doing

## Why Merge Is Always Safe

Auth gates (`requireAuth`) block guests from creating clips, exporting, or comparing. A guest can only:

- Upload games → `games` table rows + `game_videos` rows
- Earn quest achievements → `achievements` table rows
- Game video files are **global** in R2 (`games/{hash}.mp4`) — no user-scoped files

**No `raw_clips`, no `projects`, no `working_clips`, no exports, no user-scoped R2 files.** The merge is purely a DB row operation. There is no scenario where guest data conflicts with the recovered account's data.

Auth gate locations (verified):
- Add Clip: `AnnotateContainer.jsx:484` — `requireAuth(() => startCreating())`
- Export: `ExportButtonContainer.jsx:1047` — `requireAuth(() => handleExport())`
- Compare: `CompareModelsButton.jsx:257` — `requireAuth(() => handleCompare())`

## Solution

### Part 1: Always merge guest data into default profile

Replace `_migrate_guest_profile()` with a merge function. No new profile is ever created.

**Logic:**

```
Guest has games?
  No  → skip (current behavior, correct)
  Yes → Merge guest games + achievements into recovered account's default profile
```

**Merge implementation:**

```python
def _merge_guest_into_profile(guest_db_path: Path, target_db_path: Path) -> None:
    """Merge guest's games and achievements into target profile database.

    Guest data is limited to games + achievements (auth gates block everything else).
    No user-scoped R2 files to copy — game videos are global.
    """
```

Tables to merge (in FK dependency order):
1. `games` — if same `blake3_hash` exists in target, skip (same video already uploaded). Otherwise insert and get new ID.
2. `game_videos` — for newly inserted games, insert with remapped `game_id`. For skipped (duplicate) games, skip.
3. `achievements` — `INSERT OR IGNORE` (keep target's if both have same key)

Tables that will be empty for guests (auth-gated) — no merge needed:
- `raw_clips`, `projects`, `working_clips`, `working_videos`, `final_videos`, `export_jobs`, `modal_tasks`, `before_after_tracks`

Tables to skip:
- `user_settings` — keep target's
- `pending_uploads` — ephemeral
- `db_version` — keep target's

**Game dedup:**

```python
game_id_map = {}  # guest game ID → target game ID
for game_row in guest_games:
    existing = target_cursor.execute(
        "SELECT id FROM games WHERE blake3_hash = ?", (game_row['blake3_hash'],)
    ).fetchone()

    if existing:
        # Same video already in target — skip
        game_id_map[game_row['id']] = existing['id']
    else:
        target_cursor.execute(
            "INSERT INTO games (name, blake3_hash, clip_count, brilliant_count, ...) VALUES (?, ?, ...)",
            ...
        )
        game_id_map[game_row['id']] = target_cursor.lastrowid

# game_videos: only for newly inserted games
for gv_row in guest_game_videos:
    new_game_id = game_id_map[gv_row['game_id']]
    # Skip if game was deduped (game_videos already exist in target for that game)
    existing_gv = target_cursor.execute(
        "SELECT id FROM game_videos WHERE game_id = ? AND sequence = ?",
        (new_game_id, gv_row['sequence'])
    ).fetchone()
    if not existing_gv:
        target_cursor.execute(
            "INSERT INTO game_videos (game_id, blake3_hash, sequence, ...) VALUES (?, ?, ?, ...)",
            new_game_id, gv_row['blake3_hash'], gv_row['sequence'], ...
        )

# Achievements: merge, keep earliest
for ach_row in guest_achievements:
    target_cursor.execute(
        "INSERT OR IGNORE INTO achievements (key, achieved_at) VALUES (?, ?)",
        (ach_row['key'], ach_row['achieved_at'])
    )
```

**R2 sync after merge:**

```python
upload_to_r2(recovered_user_id, "database.sqlite", target_db_path)
```

**Removals:**
- Delete the "Guest N" profile creation path entirely
- Remove `shutil.copy2` of the guest DB as a new profile
- Remove profile addition to `profiles.json`

### Part 2: Save annotation context for auth return

In `authStore.js`, save game context alongside editor mode before reload:

```javascript
// In onAuthSuccess, before reload:
const editorMode = useEditorStore.getState().editorMode;
sessionStorage.setItem('authReturnMode', editorMode);

const projectId = useProjectsStore.getState().selectedProjectId;
if (projectId) {
  sessionStorage.setItem('authReturnProjectId', projectId.toString());
}

// NEW: Save game context for annotation mode
const selectedGame = useGamesDataStore.getState().selectedGame;
if (selectedGame) {
  // Use blake3_hash — stable across merge (game ID may differ in target DB)
  sessionStorage.setItem('authReturnGameHash', selectedGame.blake3_hash);
}
```

In `App.jsx`, restore game context after reload:

```javascript
const authReturnGameHash = sessionStorage.getItem('authReturnGameHash');
sessionStorage.removeItem('authReturnGameHash');

if (authReturnMode) {
  if (authReturnMode === 'annotate' && authReturnGameHash) {
    // Restore annotation mode — wait for games to load, then select + navigate
    const waitForGames = setInterval(() => {
      const games = useGamesDataStore.getState().games;
      const game = games.find(g => g.blake3_hash === authReturnGameHash);
      if (game) {
        clearInterval(waitForGames);
        useGamesDataStore.getState().selectGame(game);
        useEditorStore.getState().setEditorMode('annotate');
      }
    }, 100);
    setTimeout(() => clearInterval(waitForGames), 5000); // give up after 5s
  } else if (authReturnProjectId) {
    useProjectsStore.getState().selectProject(authReturnProjectId);
    useEditorStore.getState().setEditorMode(authReturnMode);
  }
}
```

## Context

### Relevant Files

**Backend (merge logic):**
- `src/backend/app/routers/auth.py` — `_migrate_guest_profile()` (lines 181-258) — replace entirely
- `src/backend/app/database.py` — schema reference (games, game_videos, achievements)
- `src/backend/app/storage.py` — `read_selected_profile_from_r2`, `upload_to_r2`
- `src/backend/tests/test_guest_migration.py` — existing tests to update

**Frontend (auth return):**
- `src/frontend/src/stores/authStore.js` — `onAuthSuccess()` (lines 49-92)
- `src/frontend/src/App.jsx` — auth return restoration (lines 112-123)
- `src/frontend/src/stores/gamesDataStore.js` — `selectGame()`, `selectedGame`
- `src/frontend/src/stores/editorStore.js` — `setEditorMode()`

### Related Tasks
- **Supersedes:** T410 (Guest Progress Migration — DONE, but strategy is wrong)
- **Depends on:** T405 (Central Auth DB — DONE)
- **Related:** T85b (Profile switching — DONE)

## Acceptance Criteria

- [ ] Guest with games + empty default profile → logs in → games appear in default profile, no extra profile created
- [ ] Guest with games that don't exist in recovered account → logs in → all games merged into default profile
- [ ] Guest with same game as recovered account (same blake3_hash) → logs in → no duplicate game row, existing game preserved
- [ ] Guest without games → logs in → no migration (current behavior preserved)
- [ ] No "Guest N" profiles are ever created
- [ ] After auth reload from annotation mode: user returns to annotation screen with correct game selected
- [ ] After auth reload from project manager: user returns to project manager (current behavior preserved)
- [ ] Existing T410 tests updated to reflect always-merge strategy
