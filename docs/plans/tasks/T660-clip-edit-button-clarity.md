# T660: Clip Edit Button Clarity

## Pain Point

User feedback: "I added a clip and did it wrong — how do I correct the clip? Wasn't clear how to edit it." The current behavior already opens the clip in edit mode when selected, but the "Add Clip" button doesn't change to indicate this.

## Solution

When a clip is selected in the sidebar, change the "Add Clip" button to communicate edit mode:

- **Text**: "Add Clip" → "Edit Clip"
- **Color**: Green (add) → Yellow/Amber (edit)
- When no clip is selected, revert to green "Add Clip"

This is a visual-only change — the underlying behavior (opening the clip details for editing) already works.

## Scope

**Stack Layers:** Frontend
**Files Affected:** ~1-2 files
**LOC Estimate:** ~15 lines
**Test Scope:** Frontend Unit

## Implementation Notes

- Check if a clip is currently selected in the sidebar state
- Conditionally render button text and color classes
- Green: existing Tailwind classes (likely `bg-green-*`)
- Amber: `bg-amber-500 hover:bg-amber-600` (or similar from UI style guide)
- When in edit mode with T650's scrub region, pre-populate with existing clip start/end

## Dependency

- T650 (Clip Scrub Region UI): The edit mode should use the new scrub region UI to adjust clip times

## Source

User feedback (2026-03-23): NUF tester couldn't figure out how to edit a clip after creating it incorrectly.
