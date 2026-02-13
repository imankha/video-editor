# T85: Multi-Athlete Profiles

**Status:** TODO
**Priority:** HIGH - After T80, before deployment
**Impact:** 7
**Complexity:** 6
**Created:** 2026-02-13
**Depends On:** T80 (Global Game Deduplication)

## Problem

Users may create highlights for multiple athletes (coaching a team, parent with multiple kids). Currently everything is in one database with no separation.

## Solution

Add per-athlete data isolation with a simple profile switcher. Each athlete has their own database with clips, projects, and settings. Games remain shared (global via T80).

**Key Principle:** Hide complexity until needed. Single athlete = no switcher visible.

---

## Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Terminology | **Athlete** | Clear for sports highlight context |
| Default experience | **Single unnamed athlete** | Show complexity only when needed |
| Athlete identity | **Avatar + color** | Visual distinction like Netflix |
| Switching mid-work | **Non-issue** | All changes auto-save |
| Cross-athlete visibility | **Completely isolated** | Only see loaded athlete's data |
| Athlete ID format | **UUID** | `ath_abc123` |
| Delete behavior | **Hard delete** | With confirmation modal |

---

## Storage Structure

```
R2: reel-ballers-users/
├── games/                                  # Global (from T80)
│   └── {blake3_hash}.mp4
│
└── {user_id}/
    ├── user.sqlite                         # NEW: User-level config
    │   └── athletes: id, name, color, avatar_url, created_at
    │   └── user_settings: current_athlete_id
    │
    └── athletes/
        ├── {athlete_id}/
        │   ├── database.sqlite             # Per-athlete (moved from root)
        │   │   └── user_games, clips, projects, exports, settings
        │   ├── raw_clips/...
        │   └── working_videos/...
        └── {athlete_id_2}/
            └── ...
```

---

## Database Schema

### user.sqlite (NEW - Per User)

```sql
CREATE TABLE athletes (
    id TEXT PRIMARY KEY,                    -- 'ath_abc123'
    name TEXT,                              -- NULL for default unnamed
    color TEXT NOT NULL DEFAULT '#3B82F6',  -- Tailwind blue-500
    avatar_url TEXT,                        -- Optional custom avatar
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE user_settings (
    key TEXT PRIMARY KEY,
    value TEXT
);
-- Keys: 'current_athlete_id'
```

### Per-Athlete database.sqlite

Same schema as current `database.sqlite`:
- `user_games` (from T80)
- `clips`
- `projects`
- `working_clips`
- `export_jobs`
- `settings`
- `pending_uploads`

---

## API Changes

### New Endpoints

```
GET  /api/athletes              # List all athletes
POST /api/athletes              # Create new athlete
GET  /api/athletes/current      # Get current athlete
PUT  /api/athletes/current      # Switch current athlete
GET  /api/athletes/{id}         # Get athlete details
PUT  /api/athletes/{id}         # Update athlete (name, color)
DELETE /api/athletes/{id}       # Delete athlete + all data
```

### Request Context

```python
# Option A: Header-based
X-User-ID: user_123
X-Athlete-ID: ath_abc123  # Optional, defaults to current

# Option B: Derived from user.sqlite
# Always use current_athlete_id from user_settings
# Only override via explicit switch endpoint
```

**Recommendation:** Option B (derive from user.sqlite) is simpler. No extra header needed.

---

## Sync Middleware Changes

```python
class DatabaseSyncMiddleware:
    async def dispatch(self, request, call_next):
        user_id = get_user_id(request)

        # 1. Always sync user.sqlite first (small, has athlete list)
        user_db = sync_user_database(user_id)

        # 2. Get current athlete from user.sqlite
        athlete_id = get_current_athlete_id(user_db)

        # 3. If no athletes exist, create default
        if not athlete_id:
            athlete_id = create_default_athlete(user_db)

        # 4. Sync current athlete's database
        athlete_db = sync_athlete_database(user_id, athlete_id)

        # 5. Set both in request context
        set_request_databases(user_db, athlete_db)

        response = await call_next(request)

        # 6. Sync both back if modified
        sync_all_databases_to_r2()

        return response
```

---

## Frontend Implementation

### Athlete Switcher Component

**Location:** Header, right side (near user menu if we have one)

**Single Athlete (Default):**
- Don't show switcher
- "Manage Athletes" option in settings/menu

**Multiple Athletes:**
```jsx
<AthleteDropdown>
  <CurrentAthlete>
    <Avatar color={athlete.color} />
    <Name>{athlete.name || 'Athlete'}</Name>
    <ChevronDown />
  </CurrentAthlete>

  <DropdownMenu>
    {athletes.map(a => (
      <AthleteOption onClick={() => switchAthlete(a.id)}>
        <Avatar color={a.color} />
        <Name>{a.name}</Name>
        {a.id === current && <CheckIcon />}
      </AthleteOption>
    ))}
    <Divider />
    <ManageAthletes onClick={openManageModal} />
  </DropdownMenu>
</AthleteDropdown>
```

### Add Second Athlete Flow

When clicking "Add Athlete" for the first time:

```jsx
<Modal>
  <Step1>
    <Title>Add Another Athlete</Title>
    <Subtitle>First, let's name your current athlete</Subtitle>
    <Input
      placeholder="e.g., Marcus, Team Eagles"
      value={currentName}
    />
    <ColorPicker selected={currentColor} />
  </Step1>

  <Step2>
    <Title>Now name the new athlete</Title>
    <Input placeholder="Athlete name" value={newName} />
    <ColorPicker selected={newColor} />
  </Step2>

  <Actions>
    <Cancel />
    <Create onClick={createBothAthletes} />
  </Actions>
</Modal>
```

### Manage Athletes Screen

Accessible from dropdown or settings:

```jsx
<ManageAthletesModal>
  <Title>Manage Athletes</Title>

  <AthleteList>
    {athletes.map(a => (
      <AthleteRow>
        <Avatar color={a.color} editable onClick={pickColor} />
        <NameInput value={a.name} onChange={updateName} />
        <DeleteButton onClick={() => confirmDelete(a)} />
      </AthleteRow>
    ))}
  </AthleteList>

  <AddAthleteButton />
</ManageAthletesModal>
```

### Delete Confirmation

```jsx
<ConfirmModal>
  <WarningIcon />
  <Title>Delete {athlete.name}?</Title>
  <Message>
    All clips, projects, and exports for this athlete will be
    permanently deleted. Game videos shared with other athletes
    will not be affected.
  </Message>
  <Actions>
    <Cancel />
    <DeleteButton variant="danger">Delete Athlete</DeleteButton>
  </Actions>
</ConfirmModal>
```

---

## Color Palette

Pre-defined colors for athlete avatars:

```javascript
const ATHLETE_COLORS = [
  '#3B82F6', // blue-500 (default)
  '#10B981', // emerald-500
  '#F59E0B', // amber-500
  '#EF4444', // red-500
  '#8B5CF6', // violet-500
  '#EC4899', // pink-500
  '#06B6D4', // cyan-500
  '#84CC16', // lime-500
];
```

---

## Migration Plan

**From (after T80):**
```
{user_id}/
  database.sqlite    # Has user_games, clips, projects, etc.
```

**To:**
```
{user_id}/
  user.sqlite        # NEW
  athletes/
    ath_default/
      database.sqlite  # Moved from root
      raw_clips/...    # Moved from root
```

**Migration Script:**
```python
def migrate_to_athletes(user_id):
    # 1. Create user.sqlite with default athlete
    user_db = create_user_database(user_id)
    default_athlete_id = f"ath_{generate_short_id()}"

    user_db.execute("""
        INSERT INTO athletes (id, name, color)
        VALUES (?, NULL, '#3B82F6')
    """, (default_athlete_id,))

    user_db.execute("""
        INSERT INTO user_settings (key, value)
        VALUES ('current_athlete_id', ?)
    """, (default_athlete_id,))

    # 2. Move database.sqlite to athletes/{id}/
    old_path = f"{user_id}/database.sqlite"
    new_path = f"{user_id}/athletes/{default_athlete_id}/database.sqlite"
    r2_copy(old_path, new_path)
    r2_delete(old_path)

    # 3. Move raw_clips, working_videos, etc.
    for folder in ['raw_clips', 'working_videos', 'final_videos', 'highlights']:
        old = f"{user_id}/{folder}"
        new = f"{user_id}/athletes/{default_athlete_id}/{folder}"
        r2_move_prefix(old, new)

    # 4. Upload user.sqlite
    upload_user_database(user_id, user_db)
```

---

## Implementation Plan

### Phase 1: Backend Foundation
1. Create `user.sqlite` schema and service
2. Update sync middleware for two-database model
3. Create `/api/athletes` endpoints
4. Add athlete context to all existing endpoints
5. Update path helpers for athlete-scoped storage

### Phase 2: Migration
1. Migration script for user "a"
2. Test that existing data works under new structure

### Phase 3: Frontend - Athlete Switcher
1. Create `useAthletes` hook
2. Create `AthleteDropdown` component
3. Add to header (only show if 2+ athletes)
4. Wire up athlete switching

### Phase 4: Frontend - Athlete Management
1. Create `ManageAthletesModal`
2. Add first-time "name both athletes" flow
3. Add color picker
4. Add delete with confirmation

### Phase 5: Polish
1. Loading states during athlete switch
2. Error handling
3. Test all flows end-to-end

---

## Files to Create/Modify

### New Files
- `src/backend/app/services/user_db.py` - User database service
- `src/backend/app/routers/athletes.py` - Athlete endpoints
- `src/frontend/src/hooks/useAthletes.js` - Athlete state
- `src/frontend/src/components/AthleteDropdown.jsx` - Switcher
- `src/frontend/src/components/ManageAthletesModal.jsx` - Management UI
- `src/frontend/src/components/ColorPicker.jsx` - Color selection
- `scripts/migrate_to_athletes.py` - Migration script

### Modified Files
- `src/backend/app/middleware.py` - Two-database sync
- `src/backend/app/storage.py` - Athlete-scoped paths
- `src/backend/app/database.py` - Athlete context
- `src/backend/app/routers/*.py` - Use athlete-scoped DB
- `src/frontend/src/components/Header.jsx` - Add switcher

---

## Acceptance Criteria

- [ ] New user starts with single unnamed athlete (no switcher visible)
- [ ] Can add second athlete (prompts to name both)
- [ ] Athlete switcher appears when 2+ athletes exist
- [ ] Switching athlete loads their data instantly
- [ ] Each athlete has isolated clips, projects, exports
- [ ] Games are shared across athletes (via T80)
- [ ] Can rename athletes
- [ ] Can change athlete color
- [ ] Can delete athlete (with confirmation, hard delete)
- [ ] User "a" data migrated correctly
- [ ] All existing functionality works under new structure

---

## Testing Plan

### Manual Tests
1. Fresh user - verify no switcher, default athlete created
2. Add second athlete - verify naming flow
3. Switch athletes - verify data isolation
4. Same game in two athletes - verify game shared, clips separate
5. Delete athlete - verify hard delete, data gone
6. Delete last athlete - should not be allowed (or create new default)

### Edge Cases
- Delete current athlete → switch to another
- Very long athlete name → truncate in UI
- Many athletes (10+) → dropdown scrolls
