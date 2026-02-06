---
name: lint
description: "Run static analysis on backend code. Import check catches most errors, mypy for deeper type checking."
license: MIT
author: video-editor
version: 1.0.0
user_invocable: true
---

# Backend Lint

Run static analysis after making Python code changes to catch errors before running the server.

## Usage

Invoke with `/lint` after editing Python files.

## Quick Check (ALWAYS Run After Edits)

After editing Python files, verify they import correctly:

```bash
cd src/backend && .venv/Scripts/python.exe -c "from app.main import app"
```

This catches:
- Import errors
- Undefined names (like missing `BackgroundTasks`)
- Syntax errors
- Missing dependencies

## Deep Check: mypy (Type Checking)

For deeper type checking on specific files:

```bash
cd src/backend && .venv/Scripts/python.exe -m mypy app/routers/projects.py --ignore-missing-imports
```

Or check all routers:

```bash
cd src/backend && .venv/Scripts/python.exe -m mypy app/routers/ --ignore-missing-imports
```

mypy catches:
- Type mismatches
- Missing return statements
- Invalid attribute access
- Wrong parameter types

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
| Wrong parameter count | SQL with 2 `?` but 1 param | mypy |
| Type mismatch | Passing `str` where `int` expected | mypy |

## Proactive Usage

After making code changes to Python files, ALWAYS run:

```bash
cd src/backend && .venv/Scripts/python.exe -c "from app.main import app"
```

This imports the entire app and catches most issues before the user tries to start the server.
