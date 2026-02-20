# T85b: Profile Switching — Multi-Athlete Support

**Status:** TODO
**Priority:** HIGH - Second subtask of T85, before deployment
**Impact:** 7
**Complexity:** 6
**Created:** 2026-02-19
**Parent:** T85 (Multi-Athlete Profiles)
**Depends On:** T85a (R2 Restructure)

## Problem

After T85a, the R2 structure supports profiles but every user only has one default profile. Users who coach a team or have multiple kids need to create separate athlete profiles with isolated data.

## Solution

Add profile CRUD endpoints and a frontend profile switcher. Each profile gets its own `database.sqlite`, clips, projects, and exports. Games remain shared (global via T80).

**Key Principle:** Hide complexity until needed. Single profile = no switcher visible.

---

## R2 Structure (from T85a)

```
{env}/users/{user_id}/
  profiles.json                    # {"default": "abc", "profiles": {"abc": {"name": null}, "def": {"name": "Jordan"}}}
  selected-profile.json            # {"profileId": "abc"}
  profiles/
    {profile_guid_1}/              # Default profile
      database.sqlite
      raw_clips/...
      working_videos/...
    {profile_guid_2}/              # Second profile
      database.sqlite
      raw_clips/...
```

---

## API Endpoints

### Profile CRUD

```
GET    /api/profiles                # List all profiles (from profiles.json)
POST   /api/profiles                # Create new profile → returns new GUID
GET    /api/profiles/current        # Get current profile info
PUT    /api/profiles/current        # Switch active profile (updates selected-profile.json)
PUT    /api/profiles/{id}           # Update profile (name)
DELETE /api/profiles/{id}           # Delete profile + all R2 data under its GUID
```

### Response Format

```json
// GET /api/profiles
{
  "profiles": [
    {"id": "a1b2c3d4", "name": null, "isDefault": true, "isCurrent": true},
    {"id": "e5f6g7h8", "name": "Jordan", "isDefault": false, "isCurrent": false}
  ]
}

// PUT /api/profiles/current
// Body: {"profileId": "e5f6g7h8"}
// Response: {"success": true}
// Effect: updates selected-profile.json, next request uses new profile's DB
```

### Profile Switch Flow

1. Frontend calls `PUT /api/profiles/current` with new profile ID
2. Backend updates `selected-profile.json` in R2 and in-memory cache
3. Frontend reloads all data (games, projects, clips refresh automatically)
4. No page reload needed — just re-fetch from API

---

## Frontend Implementation

### Profile Switcher Component

**Location:** Header, right side

**Single Profile (Default):**
- No switcher visible
- "Add Profile" option in a settings/menu area

**Multiple Profiles:**
```jsx
<ProfileDropdown>
  <CurrentProfile>
    <Avatar color={profile.color} />
    <Name>{profile.name || 'Default'}</Name>
    <ChevronDown />
  </CurrentProfile>

  <DropdownMenu>
    {profiles.map(p => (
      <ProfileOption onClick={() => switchProfile(p.id)}>
        <Avatar color={p.color} />
        <Name>{p.name || 'Default'}</Name>
        {p.isCurrent && <CheckIcon />}
      </ProfileOption>
    ))}
    <Divider />
    <AddProfile onClick={openAddModal} />
    <ManageProfiles onClick={openManageModal} />
  </DropdownMenu>
</ProfileDropdown>
```

### Add Second Profile Flow

When adding the first extra profile, prompt user to name their existing default too:

```
Step 1: "First, let's name your current profile"
         [Name input] [Color picker]

Step 2: "Now name the new profile"
         [Name input] [Color picker]

[Cancel] [Create]
```

### Manage Profiles Modal

```
┌─────────────────────────────┐
│  Manage Profiles            │
│                             │
│  🔵 Marcus          [Edit] [Delete] │
│  🟢 Jordan          [Edit] [Delete] │
│                             │
│  [+ Add Profile]            │
│                             │
│                    [Close]  │
└─────────────────────────────┘
```

### Delete Confirmation

```
⚠️ Delete "Jordan"?

All clips, projects, and exports for this profile will be
permanently deleted. Game videos shared with other profiles
will not be affected.

[Cancel] [Delete Profile]
```

Rules:
- Cannot delete the last remaining profile
- Deleting the current profile switches to another one first

---

## Color Palette

Pre-defined colors for profile avatars:

```javascript
const PROFILE_COLORS = [
  '#3B82F6', // blue-500 (default for first profile)
  '#10B981', // emerald-500
  '#F59E0B', // amber-500
  '#EF4444', // red-500
  '#8B5CF6', // violet-500
  '#EC4899', // pink-500
  '#06B6D4', // cyan-500
  '#84CC16', // lime-500
];
```

New profiles auto-assigned next unused color.

---

## State Management

### New Store: `profileStore.js`

```javascript
const useProfileStore = create((set) => ({
  profiles: [],           // All profiles
  currentProfileId: null, // Active profile GUID
  loading: false,

  fetchProfiles: async () => { ... },
  switchProfile: async (id) => { ... },
  createProfile: async (name, color) => { ... },
  updateProfile: async (id, updates) => { ... },
  deleteProfile: async (id) => { ... },
}));
```

### Profile Switch Side Effects

When `switchProfile` succeeds:
1. Set `currentProfileId` in store
2. Clear all data stores (editorStore, clipStore, etc.)
3. Re-fetch projects, games — they'll come from the new profile's DB
4. Navigate to home/project list

---

## profiles.json Schema Extension

T85a creates `profiles.json` with just `name`. T85b extends it with `color`:

```json
{
  "default": "a1b2c3d4",
  "profiles": {
    "a1b2c3d4": {"name": "Marcus", "color": "#3B82F6"},
    "e5f6g7h8": {"name": "Jordan", "color": "#10B981"}
  }
}
```

---

## Implementation Plan

### Phase 1: Backend Profile CRUD
1. Create `/api/profiles` router
2. Implement list, create, update, delete endpoints
3. Implement switch endpoint (update `selected-profile.json`)
4. Delete endpoint removes all R2 objects under `profiles/{guid}/`

### Phase 2: Frontend Profile Store
1. Create `profileStore.js`
2. Fetch profiles on app load
3. Wire up profile switch (clear stores + re-fetch)

### Phase 3: Frontend UI
1. Create `ProfileDropdown` component
2. Create `ManageProfilesModal`
3. Create "Add Profile" flow (with first-time naming)
4. Add color picker
5. Add delete with confirmation
6. Add to header (only show if 2+ profiles)

### Phase 4: Polish
1. Loading states during profile switch
2. Error handling for failed switches
3. Keyboard navigation in dropdown
4. Test all flows end-to-end

---

## Key Files

### New Files
- `src/backend/app/routers/profiles.py` — Profile CRUD endpoints
- `src/frontend/src/stores/profileStore.js` — Profile state
- `src/frontend/src/components/ProfileDropdown.jsx` — Switcher
- `src/frontend/src/components/ManageProfilesModal.jsx` — Management UI
- `src/frontend/src/components/ColorPicker.jsx` — Color selection

### Modified Files
- `src/backend/app/main.py` — Register profiles router
- `src/frontend/src/App.jsx` — Add ProfileDropdown to header
- `src/frontend/src/stores/` — Clear stores on profile switch

---

## Acceptance Criteria

- [ ] Single profile user sees no switcher
- [ ] Can create a second profile (prompts to name both)
- [ ] Profile switcher appears when 2+ profiles exist
- [ ] Switching profile loads that profile's data (different projects, clips)
- [ ] Games are shared across profiles
- [ ] Can rename profiles
- [ ] Can change profile color
- [ ] Can delete profile (with confirmation, except last one)
- [ ] All existing functionality works under each profile

---

## Testing Plan

### Manual Tests
1. Fresh user — verify no switcher, default profile auto-created
2. Add second profile — verify naming flow
3. Switch profiles — verify data isolation
4. Same game in two profiles — verify game shared, clips separate
5. Delete profile — verify hard delete from R2
6. Delete current profile — verify switch to another
7. Try to delete last profile — verify it's blocked

### Edge Cases
- Very long profile name → truncate in UI
- Many profiles (10+) → dropdown scrolls
- Network failure during switch → error toast, stay on current
- Create profile while offline → block with error
