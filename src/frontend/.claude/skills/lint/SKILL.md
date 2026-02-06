---
name: lint
description: "Run static analysis on frontend code. Use build check to catch JS/JSX errors before running the dev server."
license: MIT
author: video-editor
version: 1.0.0
user_invocable: true
---

# Frontend Lint

Run static analysis after making JavaScript/React code changes to catch errors early.

## Usage

Invoke with `/lint` after editing JS/JSX files.

## Quick Check

No eslint configured. Use a build check to catch errors:

```bash
cd src/frontend && npm run build 2>&1 | head -50
```

This catches:
- Syntax errors
- Import errors
- Undefined components
- JSX errors

## When to Use

1. **After editing JS/JSX files**: Run build check
2. **Before committing**: Verify no build errors
3. **After adding new imports**: Check they resolve
4. **After runtime errors**: Add checks to prevent recurrence

## Common Errors This Catches

| Error Type | Example |
|------------|---------|
| Missing import | `useState` not imported from React |
| Undefined component | `<ClipEditor />` but ClipEditor not imported |
| Syntax error | Missing closing bracket |
| JSX error | Invalid attribute |

## Type Checking (if using TypeScript)

For TypeScript files, run:

```bash
cd src/frontend && npx tsc --noEmit 2>&1 | head -50
```
