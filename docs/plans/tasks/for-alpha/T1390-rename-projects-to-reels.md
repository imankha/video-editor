# T1390: Rename "Projects" to "Reels"

**Status:** TODO
**Priority:** 3.0 (Alpha feedback — users understood "Games" but not "Projects")
**Reported:** 2026-04-11
**Source:** Alpha user feedback

## Problem

Users understand the "Games" tab but find "Projects" unclear. The word "Projects" is generic and doesn't convey what the entity represents (a collection of clips from a game, edited into highlights).

"Reels" better describes the output: a highlight reel of game clips.

## Scope

This is a **UI label rename only** — no database columns, API fields, or internal variable names change. The word "Projects" appears in two user-facing locations:

1. **ProjectManager tab label** — `src/frontend/src/components/ProjectManager.jsx` line 577
   ```jsx
   <FolderOpen size={16} />
   Projects
   ```

2. **Breadcrumb type** — `src/frontend/src/App.jsx` line 523
   ```jsx
   <Breadcrumb type="Projects" ... />
   ```

## Fix

Replace both user-facing strings with "Reels". Internal names (`ProjectManager`, `selectedProject`, `projects` store, API `/projects` endpoint) stay as-is — renaming internals is high-risk churn for zero user benefit.

## Files

- `src/frontend/src/components/ProjectManager.jsx` — tab button text (line 577)
- `src/frontend/src/App.jsx` — Breadcrumb `type` prop (line 523)
- Grep for any other user-facing "Projects" strings (tooltips, empty states, etc.)
