# Epic: User-Level Data Consolidation

**Goal:** Move profile metadata and quest completion tracking from per-profile storage (R2 JSON files, profile database.sqlite) into the user-level database (user.sqlite). This prevents cross-profile exploits (completing quests twice for double credits) and centralizes user identity data.

**Phase:** Pre-production — consolidate before live users create data in the old structure.

## Architecture Change

### Current

```
R2: {env}/users/{user_id}/
├── profiles.json              (all profiles: name, color, default)
├── selected-profile.json      (current profile ID)

Per-profile database.sqlite:
├── achievements table         (quest step completions like "played_annotations")
```

**Problems:**
- Profile data (name, color) lives in R2 JSON files — no transactional guarantees, no migration path, extra network round-trip on init
- Quest achievements are per-profile: user completes quests on Profile A, switches to Profile B, completes them again → double credits
- Credit balance is already user-level (user.sqlite) but quest progress checks per-profile achievements — inconsistent ownership

### Target

```
user.sqlite (per-user):
├── profiles table             (id, name, color, is_default, created_at)
├── selected_profile           (stored as row or setting)
├── achievements table         (quest completions, user-scoped)
├── credits table              (already here)
├── credit_transactions table  (already here)
```

R2 JSON files become read-only for migration, then deprecated.

## Tasks

| # | ID | Task | Status | Impact | Cmplx | Notes |
|---|-----|------|--------|--------|-------|-------|
| 1 | T960 | [Profiles to User DB](T960-profiles-to-user-db.md) | TODO | 6 | 5 | Move profile CRUD from R2 JSON to user.sqlite profiles table |
| 2 | T970 | [User-Scoped Quest Achievements](T970-user-scoped-quest-achievements.md) | TODO | 8 | 4 | Move achievements from per-profile DB to user.sqlite; prevents double quest completion |
