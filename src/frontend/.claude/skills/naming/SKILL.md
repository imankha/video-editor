# Naming Skill

Names of functions, classes, and components should describe **what they do**, not how they happen to be used.

## Rules

| Rule | Description |
|------|-------------|
| [name-by-behavior](rules/name-by-behavior.md) | Name based on behavior, not usage context |

## Quick Reference

### Good Names (describe behavior)
```javascript
// What it does: plays media with controls
MediaPlayer

// What it does: loads video and manages state
useVideoState

// What it does: shows loading indicator
VideoLoadingOverlay
```

### Bad Names (describe usage context)
```javascript
// How it's used, not what it does
GalleryVideoPlayer  // "Gallery" = where it's used
StandaloneVideoPlayer  // "Standalone" = how it's deployed
HomePageHeader  // "HomePage" = where it appears
```

## Why This Matters

- **Reusability**: Components named by behavior can be reused in new contexts
- **Clarity**: The name tells you what to expect from the component
- **Maintenance**: When usage changes, you don't need to rename
