# Lint Skill

Run static code analysis after making code changes to catch errors before running servers.

## Usage
Invoke with `/lint` after making code changes, or proactively after editing Python/JS files.

## Instructions

### Quick Check (Always Run)
After editing Python files, verify they import correctly:

```bash
cd src/backend && .venv/Scripts/python.exe -c "from app.routers import clips, games, projects, health, export, detection, annotate, downloads, auth, storage" 2>&1
```

This catches:
- Import errors
- Undefined names (like missing `BackgroundTasks`)
- Missing dependencies

### Backend: mypy (Type Checking)
For deeper type checking on specific files:

```bash
cd src/backend && .venv/Scripts/python.exe -m mypy app/routers/projects.py --ignore-missing-imports 2>&1
```

Or check all routers:
```bash
cd src/backend && .venv/Scripts/python.exe -m mypy app/routers/ --ignore-missing-imports 2>&1
```

mypy catches:
- Type mismatches
- Missing return statements
- Invalid attribute access

### Frontend: Build Check
No eslint configured. Use a build check to catch JS/JSX errors:

```bash
cd src/frontend && npm run build 2>&1 | head -50
```

This catches:
- Syntax errors
- Import errors
- Undefined components

## When to Use

1. **After editing Python files**: Run quick import check
2. **After adding new function parameters**: Run mypy on that file
3. **Before committing**: Run full checks on changed files
4. **After seeing runtime errors**: Add checks to prevent recurrence

## Common Errors This Catches

| Error Type | Example | Tool |
|------------|---------|------|
| Missing import | `BackgroundTasks` not imported | Import check |
| Undefined name | `clip.get()` on sqlite3.Row | Import check |
| Wrong parameter count | SQL with 2 `?` but 1 param | mypy (partial) |
| Type mismatch | Passing `str` where `int` expected | mypy |

## Proactive Usage
After making code changes to Python files, ALWAYS run:
```bash
cd src/backend && .venv/Scripts/python.exe -c "from app.main import app" 2>&1
```

This imports the entire app and catches most issues before the user tries to start the server.
