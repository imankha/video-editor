# query-parameterized

**Priority:** HIGH
**Category:** Query Patterns

## Rule
Always use parameterized queries. Never interpolate user input into SQL strings.

## Rationale
SQL injection is a critical security vulnerability:
1. Attackers can read/modify/delete data
2. Can bypass authentication
3. May gain server access
4. OWASP Top 10 vulnerability

## Incorrect Example

```python
@router.get("/clips/{clip_id}")
async def get_clip(clip_id: str, user_id: str):
    # BAD: String interpolation
    cursor.execute(f"SELECT * FROM clips WHERE id = '{clip_id}' AND user_id = '{user_id}'")
    return cursor.fetchone()

@router.get("/search")
async def search_clips(query: str, user_id: str):
    # BAD: f-string in query
    cursor.execute(f"SELECT * FROM clips WHERE name LIKE '%{query}%' AND user_id = '{user_id}'")
    return cursor.fetchall()
```

**Why this is wrong:**
- `clip_id` could be `'; DROP TABLE clips; --`
- `query` could escape the LIKE and run arbitrary SQL
- User input is directly in the SQL string

## Correct Example

```python
@router.get("/clips/{clip_id}")
async def get_clip(clip_id: str, user_id: str):
    # GOOD: Parameterized query
    cursor.execute(
        "SELECT * FROM clips WHERE id = ? AND user_id = ?",
        (clip_id, user_id)
    )
    return cursor.fetchone()

@router.get("/search")
async def search_clips(query: str, user_id: str):
    # GOOD: Parameter with LIKE pattern
    cursor.execute(
        "SELECT * FROM clips WHERE name LIKE ? AND user_id = ?",
        (f"%{query}%", user_id)
    )
    return cursor.fetchall()
```

## Additional Context

### Dynamic Column/Table Names
For dynamic identifiers (can't use parameters), validate against whitelist:

```python
VALID_COLUMNS = {"name", "created_at", "duration"}
VALID_ORDERS = {"ASC", "DESC"}

@router.get("/clips")
async def list_clips(sort_by: str, order: str, user_id: str):
    # Validate against whitelist
    if sort_by not in VALID_COLUMNS:
        raise HTTPException(400, f"Invalid column: {sort_by}")
    if order.upper() not in VALID_ORDERS:
        raise HTTPException(400, f"Invalid order: {order}")

    # Safe to interpolate after validation
    cursor.execute(
        f"SELECT * FROM clips WHERE user_id = ? ORDER BY {sort_by} {order}",
        (user_id,)
    )
    return cursor.fetchall()
```

### Using Query Helpers
```python
from app.queries import latest_working_clips_subquery

# Subquery helpers are pre-validated
cursor.execute(
    f"SELECT * FROM working_clips WHERE id IN ({latest_working_clips_subquery()}) AND project_id = ?",
    (project_id,)
)
```
