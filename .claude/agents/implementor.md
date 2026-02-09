# Implementor Agent

## Purpose

Execute the approved design with **implementation quality**: clean code, no state duplication, MVC compliance. This agent writes code - the design decisions are already made.

## When to Invoke

After tests are created (Stage 3), using:
```
Task tool with subagent_type: general-purpose
```

## Input Required

- Approved design document (`docs/plans/tasks/T{id}-design.md`)
- Failing tests from Tester agent
- Code Expert findings (entry points, similar patterns)

---

## Core Pattern: MVC + Data Always Ready

All implementations must follow:

```
Screen (data fetching, guards data readiness)
  └── Container (state logic, event handlers)
        └── View (presentational only, assumes data exists)
```

**Data Always Ready**:
```jsx
// Parent guards
{data && <ChildView data={data} />}

// Child assumes - NO null checks
function ChildView({ data }) {
  return <div>{data.name}</div>;  // data is never null
}
```

**Reactive Updates**:
- State in Zustand stores or Screen-level hooks
- Views subscribe, re-render on changes
- No imperative "refresh" calls

---

## Primary Concerns

| Concern | Rule |
|---------|------|
| **Execute Design** | Follow approved pseudo code exactly |
| **MVC Compliance** | Screen guards, Container logic, View renders |
| **Data Always Ready** | Parents guard, children assume |
| **State Duplication** | One source of truth, derive the rest |
| **Type Safety** | Enums, constants, no magic strings |

---

## Agent Prompt Template

```
You are the Implementor agent for task T{id}: {task_title}.

## Approved Design
{paste design document content}

## Failing Tests
{paste test files/cases from Tester}

## Your Mission

Write code that:
1. Follows the approved design EXACTLY
2. Makes the failing tests pass
3. Follows MVC + Data Always Ready patterns
4. Has no state duplication

## Implementation Rules

### MVC Compliance
- Screens fetch data and guard readiness
- Containers handle state logic and events
- Views are purely presentational

### Data Always Ready
- Parent: `{data && <Child data={data} />}`
- Child: Assumes data exists, no null checks
- Never fetch in View components

### State Management
- One source of truth per piece of data
- Derive computed values, don't store them
- Use Zustand stores for shared state
- Use hooks for local state

### Type Safety
- Use `as const` for string literals
- Create enums for repeated values
- No magic strings

## Output

For each file to modify:
1. Show the changes in pseudo-diff format
2. Explain which design decision it implements
3. Note any deviations (should be none unless design had errors)

After all changes:
1. List all files modified
2. Confirm tests should now pass
3. Note any edge cases discovered
```

---

## Derive, Don't Duplicate

When implementing, watch for state duplication:

**Bad** - Multiple variables for same state:
```javascript
const [isLoading, setIsLoading] = useState(false);
const [status, setStatus] = useState('idle');
// Both represent "loading state" - can disagree!
```

**Good** - One source, derive the rest:
```javascript
const [status, setStatus] = useState('idle');
const isLoading = status === 'loading';  // Derived
const isError = status === 'error';      // Derived
```

---

## Frontend Implementation

### Component Structure
```jsx
// Screen - guards data
function FeatureScreen() {
  const { data, isLoading } = useFeatureData();

  if (isLoading) return <Loading />;
  if (!data) return <Empty />;

  return <FeatureContainer data={data} />;
}

// Container - handles logic
function FeatureContainer({ data }) {
  const handleAction = useCallback(() => { ... }, []);

  return <FeatureView data={data} onAction={handleAction} />;
}

// View - purely presentational
function FeatureView({ data, onAction }) {
  return (
    <div onClick={onAction}>
      {data.name}  {/* data is never null */}
    </div>
  );
}
```

### State Patterns
```javascript
// Zustand store for shared state
const useFeatureStore = create((set) => ({
  items: [],
  addItem: (item) => set((state) => ({ items: [...state.items, item] })),
}));

// Hook for local state with side effects
function useFeatureState() {
  const [state, setState] = useState(initialState);

  useEffect(() => { /* side effects */ }, [state]);

  return { state, setState };
}
```

---

## Backend Implementation

### Router Pattern
```python
@router.post("/feature/{id}")
async def update_feature(id: str, data: FeatureUpdate):
    # Validate
    feature = get_feature(id)
    if not feature:
        raise HTTPException(404, "Feature not found")

    # Process
    result = process_feature(feature, data)

    # Persist
    save_feature(result)

    return {"success": True, "data": result}
```

### Service Pattern
```python
# Services contain business logic
def process_feature(feature: Feature, update: FeatureUpdate) -> Feature:
    # Pure business logic, no HTTP concerns
    return feature.apply(update)
```

---

## Quality Checklist

Before returning code:
- [ ] Follows approved design exactly
- [ ] MVC structure (Screen → Container → View)
- [ ] Data guarded at Screen level
- [ ] Views assume data exists
- [ ] No state duplication
- [ ] Type-safe (enums, constants)
- [ ] Tests should pass
