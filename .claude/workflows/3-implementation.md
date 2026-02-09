# Stage 3: Implementation

## Core Principles

| Principle | Summary |
|-----------|---------|
| **Data Always Ready** | Frontend assumes data loaded before render |
| **MVC Pattern** | Screens own data, Containers logic, Views presentation |
| **Single Source of Truth** | All persistence via SQLite → R2, never localStorage |
| **No Band-Aid Fixes** | Understand root cause, don't mask symptoms |
| **Type Safety** | No magic strings, use `as const` objects and enums |
| **Derive, Don't Duplicate** | One authoritative variable, derive the rest |
| **Minimize Code Paths** | Search first, extract shared logic, unified interfaces |

---

## Derive, Don't Duplicate

When multiple variables represent the same underlying state, bugs happen when they get out of sync.

**Bad** - Multiple independent variables:
```python
def send_progress(phase, done, status, progress):  # 4 ways to say "complete"
    if done or phase == 'complete' or status == 'complete' or progress >= 100:
        ...  # Which one is right? They can disagree!
```

**Good** - One source of truth, derive the rest:
```python
def send_progress(phase):  # phase is the ONLY input
    status = phase_to_status(phase)  # Derived - can't be wrong
    done = phase in (Phase.COMPLETE, Phase.ERROR)  # Derived
```

**Rules:**
1. Pick ONE authoritative variable (usually the most granular)
2. Derive everything else via functions
3. Never pass derived values as parameters
4. Use enums, not strings

---

## Git Workflow

- **Never commit to master** - Only user commits to master after testing
- **Commit when you add value** - Don't wait for manual testing
- **Never commit broken code** - Run relevant tests first
- **Run minimal tests** - Tests that activate changed code paths

---

## Database

- Location: `user_data/{user_id}/database.sqlite`
- Dev default: `user_data/a/database.sqlite`
- R2 sync: Download on startup if newer, upload on mutations

---

## Frontend Guidelines

### Skills (load as needed)

| Skill | Priority | Path |
|-------|----------|------|
| data-always-ready | CRITICAL | `src/frontend/.claude/skills/data-always-ready/SKILL.md` |
| mvc-pattern | CRITICAL | `src/frontend/.claude/skills/mvc-pattern/SKILL.md` |
| state-management | CRITICAL | `src/frontend/.claude/skills/state-management/SKILL.md` |
| type-safety | HIGH | `src/frontend/.claude/skills/type-safety/SKILL.md` |
| keyframe-data-model | HIGH | `src/frontend/.claude/skills/keyframe-data-model/SKILL.md` |
| ui-style-guide | MEDIUM | `src/frontend/.claude/skills/ui-style-guide/SKILL.md` |

### Quick Patterns

**Data Guards:**
```jsx
{selectedClip && <ClipEditor clip={selectedClip} />}
```

**MVC Structure:**
```
Screen (data fetching, hook initialization)
  └── Container (state logic, event handlers)
        └── View (presentational, props only)
```

**Keyframes:**
```javascript
keyframe = {
  frame: number,                    // Frame-based, not time
  origin: 'permanent' | 'user' | 'trim',
  // + mode-specific data
}
```

**State:**
- Zustand stores for global state
- Screen-owned hooks for local state
- No prop drilling from App.jsx

### Frontend Don'ts
- Don't add console.logs in committed code
- Don't fetch data in View components
- Don't render without data guards
- Don't use localStorage
- Don't use time in seconds for keyframes

---

## Backend Guidelines

### Virtual Environment
```bash
# Run commands directly
cd src/backend && .venv/Scripts/python.exe <script.py>
```

### After Code Changes (REQUIRED)
```bash
cd src/backend && .venv/Scripts/python.exe -c "from app.main import app"
```

### Skills (load as needed)

| Skill | Priority | Path |
|-------|----------|------|
| api-guidelines | CRITICAL | `src/backend/.claude/skills/api-guidelines/SKILL.md` |
| persistence-model | CRITICAL | `src/backend/.claude/skills/persistence-model/SKILL.md` |
| bug-reproduction | CRITICAL | `src/backend/.claude/skills/bug-reproduction/SKILL.md` |
| type-safety | HIGH | `src/backend/.claude/skills/type-safety/SKILL.md` |
| database-schema | HIGH | `src/backend/.claude/skills/database-schema/SKILL.md` |
| gesture-based-sync | HIGH | `src/backend/.claude/skills/gesture-based-sync/SKILL.md` |

### Quick Patterns

**File Paths:**
```python
from app.database import RAW_CLIPS_PATH, WORKING_VIDEOS_PATH
file_path = RAW_CLIPS_PATH / filename
```

**R2 Storage:**
```python
from app.services.r2_storage import upload_to_r2, generate_presigned_url
await upload_to_r2(user_id, r2_key, local_path)
```

**Modal GPU (Unified Interface):**
```python
from app.services.modal_client import call_modal_framing_ai
# Always call unified interface - routes internally
result = await call_modal_framing_ai(job_id, user_id, ...)
```

**Export Helpers:**
```python
from app.services.export_helpers import (
    create_export_job, complete_export_job, fail_export_job,
    send_progress, create_progress_callback
)
```

### Backend Don'ts
- Don't use raw SQL without parameterization
- Don't store secrets in code
- Don't skip R2 upload for user files
- Don't send full state blobs (use gesture-based actions)

---

## After Implementation Complete

Proceed to [4-automated-testing.md](4-automated-testing.md) to run tests.
