# Stage 4: Implementation

## Agent

**Spawn the Implementor agent** to write code:
```
Task tool with subagent_type: general-purpose
See: .claude/agents/implementor.md
```

## Purpose

Execute the approved design. Focus on **implementation quality**: clean code, no state duplication, proper patterns.

## Core Pattern: MVC + Data Always Ready

All implementations must follow:

```
Screen (data fetching, guards data readiness)
  └── Container (state logic, event handlers)
        └── View (presentational only, assumes data exists)
```

**Data Always Ready**:
- Parent guards: `{data && <Child data={data} />}`
- Child assumes: `function Child({ data }) { /* data is never null */ }`
- Views never fetch, never check for null

**Reactive Updates**:
- State lives in Zustand stores or Screen-level hooks
- Views subscribe to state, re-render on changes
- No imperative "refresh" or "update" calls

## Primary Concerns

| Concern | What to Check |
|---------|---------------|
| **MVC Compliance** | Screen guards, Container handles logic, View renders |
| **Data Always Ready** | Parents guard, children assume data exists |
| **State Duplication** | One source of truth, derive everything else |
| **Type Safety** | No magic strings, use enums and constants |

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

## Implementation Checklist

Before writing code, verify:
- [ ] Design document approved (Stage 2)
- [ ] Failing tests created (Stage 3)
- [ ] Understand the pseudo code from design doc

While writing code:
- [ ] Follow the approved design exactly
- [ ] No state duplication - derive values
- [ ] Use existing utilities (identified by Architect)
- [ ] Follow MVC pattern (Screen → Container → View)

---

## Frontend Standards

### Data Guards
```jsx
{selectedClip && <ClipEditor clip={selectedClip} />}
```

### MVC Structure
```
Screen (data fetching, hook initialization)
  └── Container (state logic, event handlers)
        └── View (presentational, props only)
```

### State
- Zustand stores for global state
- Screen-owned hooks for local state
- No prop drilling from App.jsx

### Keyframes
```javascript
keyframe = {
  frame: number,  // Frame-based, not time
  origin: 'permanent' | 'user' | 'trim',
}
```

### Skills (load as needed)
| Skill | Path |
|-------|------|
| data-always-ready | `src/frontend/.claude/skills/data-always-ready/SKILL.md` |
| mvc-pattern | `src/frontend/.claude/skills/mvc-pattern/SKILL.md` |
| state-management | `src/frontend/.claude/skills/state-management/SKILL.md` |
| type-safety | `src/frontend/.claude/skills/type-safety/SKILL.md` |

### Don'ts
- Don't add console.logs in committed code
- Don't fetch data in View components
- Don't render without data guards
- Don't use localStorage
- Don't use time in seconds for keyframes

---

## Backend Standards

### Virtual Environment
```bash
cd src/backend && .venv/Scripts/python.exe <script.py>
```

### After Code Changes (REQUIRED)
```bash
cd src/backend && .venv/Scripts/python.exe -c "from app.main import app"
```

### Common Patterns
```python
# File paths
from app.database import RAW_CLIPS_PATH, WORKING_VIDEOS_PATH
file_path = RAW_CLIPS_PATH / filename

# R2 Storage
from app.services.r2_storage import upload_to_r2, generate_presigned_url

# Modal GPU (unified interface - routes internally)
from app.services.modal_client import call_modal_framing_ai

# Export helpers
from app.services.export_helpers import (
    create_export_job, complete_export_job, send_progress
)
```

### Skills (load as needed)
| Skill | Path |
|-------|------|
| api-guidelines | `src/backend/.claude/skills/api-guidelines/SKILL.md` |
| persistence-model | `src/backend/.claude/skills/persistence-model/SKILL.md` |
| type-safety | `src/backend/.claude/skills/type-safety/SKILL.md` |
| database-schema | `src/backend/.claude/skills/database-schema/SKILL.md` |

### Don'ts
- Don't use raw SQL without parameterization
- Don't store secrets in code
- Don't skip R2 upload for user files
- Don't send full state blobs (use gesture-based actions)

---

## Git Workflow

- **Never commit to master** - Only user commits after testing
- **Commit when you add value** - Don't wait for manual testing
- **Never commit broken code** - Run relevant tests first

---

## Database Reference

- Location: `user_data/{user_id}/database.sqlite`
- Dev default: `user_data/a/database.sqlite`
- R2 sync: Download on startup if newer, upload on mutations

---

## After Implementation Complete

Proceed to [5-automated-testing.md](5-automated-testing.md) to run tests.
