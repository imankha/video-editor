# T330: Scan for MVC Violations

**Status:** DONE (scan complete)
**Impact:** MEDIUM
**Complexity:** MEDIUM
**Created:** 2026-02-06
**Updated:** 2026-02-06

## Scan Results

### MVC Structure Found

```
src/frontend/src/
├── screens/           # Should own data, initialize hooks
│   ├── AnnotateScreen.jsx
│   ├── FramingScreen.jsx
│   ├── OverlayScreen.jsx
│   └── ProjectsScreen.jsx
├── containers/        # Should handle logic, event handlers
├── components/        # Should be presentational (props only)
└── modes/            # Mode-specific views
```

### Components Using Stores/Hooks Directly

These components use stores/context directly instead of receiving data via props:

| Component | Hook/Store Used | Violation? |
|-----------|-----------------|------------|
| **DownloadsPanel.jsx** | useGalleryStore, useDownloads | BORDERLINE |
| **ExportButton.jsx** | useAppState, useExportStore, useExportManager | YES - complex |
| **GalleryButton.jsx** | useGalleryStore | MINOR |
| **GlobalExportIndicator.jsx** | useExportStore | MINOR |
| **ProjectManager.jsx** | useAppState, useExportStore, useSettingsStore | YES - complex |
| **ModeSwitcher.jsx** | useAppState | MINOR |

### Analysis

#### HIGH Priority Violations

**1. ExportButton.jsx** (39 churn)
- Uses: useAppState, useExportStore, useExportManager
- **Issue:** Component is doing too much - managing exports, tracking state, handling WebSockets
- **Impact:** 5 (used on every export)
- **Churn:** 5
- **Priority:** 25
- **Fix:** Extract export logic to container, make ExportButton presentational

**2. ProjectManager.jsx** (23 churn)
- Uses: useAppState, useExportStore, useSettingsStore
- **Issue:** Component fetches own data and manages complex state
- **Impact:** 4 (main project view)
- **Churn:** 4
- **Priority:** 16
- **Fix:** Move to ProjectsScreen, pass data as props

#### MEDIUM Priority

**3. DownloadsPanel.jsx** (10 churn)
- Uses: useGalleryStore, useDownloads
- **Issue:** Panel managing its own data fetch
- **Priority:** 9
- **Note:** Could argue this is a self-contained widget, acceptable

#### LOW Priority (Acceptable)

- **GalleryButton, GlobalExportIndicator, ModeSwitcher**: These are small, single-purpose components. Using stores directly is acceptable for simplicity.

### Screens Analysis

| Screen | Data Fetching | Hook Init | Status |
|--------|---------------|-----------|--------|
| AnnotateScreen | Yes | Yes | GOOD |
| FramingScreen | Yes | Yes | GOOD |
| OverlayScreen | Yes | Yes | GOOD |
| ProjectsScreen | ? | ? | CHECK |

### Recommendations

1. **ExportButton** needs refactoring - too much logic for a "component"
2. **ProjectManager** should receive data from ProjectsScreen
3. Small utility components (GalleryButton, etc.) - OK to use stores

## Refactor Tasks to Create

| ID | Task | Priority |
|----|------|----------|
| T331 | Refactor ExportButton - extract logic to container | 25 |
| T332 | Refactor ProjectManager - receive data from screen | 16 |

## Progress Log

**2026-02-06**: Scan complete. Found 2 significant MVC violations: ExportButton.jsx (too much logic) and ProjectManager.jsx (fetches own data). Small utility components using stores directly is acceptable.
