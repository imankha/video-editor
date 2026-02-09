# Stage 1: Task Start

## Checklist

### 1. Create Feature Branch
```bash
git checkout -b feature/T{id}-{short-description}
```

### 2. Read Task File
- Read `docs/plans/tasks/T{id}-*.md`
- Understand the problem, solution, and acceptance criteria
- Note any referenced files or screenshots

### 3. Audit: Find Similar Code

**Search for existing patterns before writing new code:**

```
# Search for similar functionality
- Components with similar UI patterns
- Hooks with similar state management
- API endpoints with similar operations
- Utility functions that could be reused
```

**Questions to answer:**
- Does similar functionality already exist?
- Can existing utilities be reused or extended?
- What patterns do similar features follow?

### 4. Audit: Identify Interacting Systems

**Map the touch points:**

| Layer | What to Check |
|-------|---------------|
| Frontend | Which components render this? Which stores manage state? |
| Backend | Which endpoints are called? What database tables? |
| State | Where does data flow from/to? |
| Side Effects | What gets triggered (API calls, R2 uploads, WebSocket)? |

### 5. Document Findings

Update the task file's "Relevant Files" section:
```markdown
### Relevant Files
- `src/frontend/src/components/Foo.jsx` - Main component to modify
- `src/backend/app/routers/bar.py` - API endpoint
- `src/frontend/src/stores/bazStore.js` - State management
```

Add to Progress Log:
```markdown
**{date}**: Started implementation. Audit findings:
- Similar pattern exists in X, will follow that approach
- Interacts with Y component and Z endpoint
- Will reuse existing utility W
```

---

## After Completing This Stage

Proceed to [2-implementation.md](2-implementation.md) for coding guidelines.
