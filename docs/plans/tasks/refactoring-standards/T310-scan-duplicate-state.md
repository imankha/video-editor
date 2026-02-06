# T310: Scan for Duplicate State

**Status:** DONE (scan complete, refactor tasks needed)
**Impact:** HIGH
**Complexity:** MEDIUM
**Created:** 2026-02-06
**Updated:** 2026-02-06

## Scan Results

### Stores Found

```
src/frontend/src/stores/
├── clipStore.js
├── editorStore.js
├── exportStore.js
├── framingStore.js
├── galleryStore.js
├── gamesStore.js
├── navigationStore.js
├── overlayStore.js
├── projectDataStore.js
├── settingsStore.js
└── videoStore.js
```

### CRITICAL: Duplicate State Found

#### `workingVideo` - DUPLICATED

| Store | Line | Usage |
|-------|------|-------|
| **overlayStore.js** | 32 | `workingVideo: null` |
| **projectDataStore.js** | 18 | `workingVideo: null` |

**Impact:** 5 (causes bugs when one is updated but other is read)
**Churn:** 5 (both files modified frequently)
**Priority:** 25

**Evidence:**
```javascript
// overlayStore.js:32
workingVideo: null, // { file, url, metadata }

// projectDataStore.js:18
workingVideo: null,
```

**Fix:** Remove from overlayStore, use projectDataStore as canonical owner

#### `clipMetadata` - DUPLICATED

| Store | Line | Usage |
|-------|------|-------|
| **overlayStore.js** | 35 | `clipMetadata: null` |
| **projectDataStore.js** | 27 | `clipMetadata: null` |

**Impact:** 5
**Churn:** 5
**Priority:** 25

**Evidence:**
```javascript
// overlayStore.js:35
clipMetadata: null,

// projectDataStore.js:27
clipMetadata: null,
```

**Fix:** Remove from overlayStore, use projectDataStore as canonical owner

### MEDIUM: Related State (Not Duplicate but Confusing)

#### `clips` vs `selectedClipId` vs `selectedClipIndex`

| Store | Field | Purpose |
|-------|-------|---------|
| clipStore.js | `clips: []` | Clips list |
| clipStore.js | `selectedClipId: null` | Selected by ID |
| projectDataStore.js | `clips: []` | Also clips list? |
| projectDataStore.js | `selectedClipIndex: 0` | Selected by index |

**Issue:** Two stores managing clips with different selection mechanisms.

**Needs Investigation:** Are these the same clips or different contexts?

### Canonical Ownership Recommendation

| Field | Canonical Owner | Remove From |
|-------|-----------------|-------------|
| `workingVideo` | projectDataStore | overlayStore |
| `clipMetadata` | projectDataStore | overlayStore |
| `clips` | TBD - needs investigation | - |

## Refactor Tasks to Create

| ID | Task | Priority |
|----|------|----------|
| T311 | Remove workingVideo from overlayStore | 25 |
| T312 | Remove clipMetadata from overlayStore | 25 |
| T313 | Investigate clips duplication in clipStore vs projectDataStore | 15 |

## Progress Log

**2026-02-06**: Scan complete. Found critical duplicate state: `workingVideo` and `clipMetadata` exist in BOTH overlayStore and projectDataStore. This is a known source of bugs. Recommended fix: consolidate to projectDataStore.
