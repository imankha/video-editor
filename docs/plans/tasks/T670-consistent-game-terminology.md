# T670: Consistent Game Addition Terminology

## Pain Point

User feedback + NUF observation: "Upload" and "Add a Game" are used interchangeably in the UI. This confuses new users about what each action does and what the purpose is.

## Solution

Audit all UI text related to game addition and standardize on consistent terminology:

- **Primary action**: "Add a Game" (user's mental model — they're adding a game to the system)
- **Sub-action**: "Upload" only when referring specifically to the file transfer step within the Add Game flow
- Add brief contextual helper text where needed to explain the purpose of each action

### Audit Scope

- Button labels (ProjectManager, GameDetailsModal, NUF)
- Modal titles and headers
- Empty state messages
- Tooltip/helper text
- Quest system step descriptions (if referencing game addition)

## Scope

**Stack Layers:** Frontend
**Files Affected:** ~3-5 files
**LOC Estimate:** ~20-30 lines (text changes)
**Test Scope:** Frontend E2E (snapshot updates)

## Source

User feedback (2026-03-23): NUF tester confused by interchangeable use of "Upload" and "Add a Game."
