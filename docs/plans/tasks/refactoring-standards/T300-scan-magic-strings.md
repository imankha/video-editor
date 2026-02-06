# T300: Scan for Magic Strings

**Status:** DONE (scan complete, refactor tasks needed)
**Impact:** HIGH
**Complexity:** MEDIUM
**Created:** 2026-02-06
**Updated:** 2026-02-06

## Scan Results

### Summary

| Location | Count | Priority |
|----------|-------|----------|
| Frontend (JS/JSX) | 242 string comparisons | HIGH |
| Backend (Python) | ~50 string comparisons | MEDIUM |

### HIGH Priority Violations (Impact × Churn)

#### 1. `editorMode` comparisons (App.jsx, ExportButton.jsx)
**Files:** App.jsx (73 churn), ExportButton.jsx (39 churn)
**Impact:** 5 (runs on every mode switch)
**Churn:** 5
**Priority:** 25

```javascript
// Found in App.jsx, ExportButton.jsx
if (editorMode === 'framing') ...
if (editorMode === 'overlay') ...
if (editorMode === 'annotate') ...
editorMode === 'project-manager'
```

**Fix:** Create `EDITOR_MODES` constant object

#### 2. `statusFilter` comparisons (ProjectManager.jsx)
**File:** ProjectManager.jsx (23 churn)
**Impact:** 4 (runs on filter change)
**Churn:** 4
**Priority:** 16

```javascript
// Found in ProjectManager.jsx:84-89
if (statusFilter === 'uncompleted') ...
if (statusFilter === 'complete') ...
if (statusFilter === 'overlay') ...
if (statusFilter === 'editing') ...
if (statusFilter === 'exported') ...
if (statusFilter === 'not_started') ...
```

**Fix:** Create `STATUS_FILTERS` constant object

#### 3. `segment.status` comparisons (ProjectManager.jsx)
**File:** ProjectManager.jsx
**Impact:** 4
**Churn:** 4
**Priority:** 16

```javascript
// Found in ProjectManager.jsx:1070-1075
segment.status === 'done'
segment.status === 'exporting'
segment.status === 'in_progress'
segment.status === 'ready'
segment.status === 'extracting'
segment.status === 'pending_extraction'
```

**Fix:** Create `SEGMENT_STATUS` constant object

#### 4. `effect_type` comparisons (Python - keyframe_interpolator.py, video_processing.py)
**Files:** keyframe_interpolator.py, video_processing.py
**Impact:** 4 (runs during export)
**Churn:** 3
**Priority:** 12

```python
# Found in multiple backend files
if effect_type == "brightness_boost":
elif effect_type == "dark_overlay":
# effect_type == "original"
```

**Fix:** Create `EffectType` enum

#### 5. `export_mode` comparisons (Python - video_encoder.py, frame_*.py)
**Files:** video_encoder.py, frame_enhancer.py, frame_processor.py
**Impact:** 3
**Churn:** 3
**Priority:** 9

```python
# Found in video_encoder.py
if export_mode == "fast":
if export_mode == "quality":
```

**Fix:** Create `ExportMode` enum

#### 6. `origin` comparisons (keyframe files)
**Files:** CropLayer.jsx, FramingContainer.jsx, keyframeController.js
**Impact:** 4
**Churn:** 4
**Priority:** 16

```javascript
keyframe.origin === 'permanent'
keyframe.origin === 'user'
keyframe.origin === 'trim'
```

**Fix:** Create `KEYFRAME_ORIGINS` constant object

#### 7. `source_type` comparisons (DownloadsPanel.jsx)
**File:** DownloadsPanel.jsx (10 churn)
**Impact:** 3
**Churn:** 3
**Priority:** 9

```javascript
download.source_type === 'annotated_game'
```

**Fix:** Create `SOURCE_TYPES` constant object

### MEDIUM Priority Violations

#### 8. `extractionStatus` comparisons (ClipSelectorSidebar.jsx)
```javascript
clip.extractionStatus === 'running'
clip.extractionStatus === 'pending'
```

#### 9. `aspectRatio` comparisons (AspectRatioSelector.jsx)
```javascript
aspectRatio === '9:16'
ratio.value === '9:16'
```

#### 10. Model variant comparisons (model_manager.py)
```python
if self.model_variant == 'SwinIR_4x_GAN':
if self.model_variant == 'HAT_4x':
```

### Already Using Constants (Good Examples)

```javascript
// ExportStatus is already a constant - GOOD
job.status === ExportStatus.COMPLETE
job.status === ExportStatus.ERROR
exp.status === ExportStatus.PENDING
```

## Refactor Tasks to Create

| ID | Task | Priority |
|----|------|----------|
| T301 | Refactor editorMode to use EDITOR_MODES constant | 25 |
| T302 | Refactor statusFilter/segment.status to constants | 16 |
| T303 | Refactor keyframe origin to KEYFRAME_ORIGINS | 16 |
| T304 | Create EffectType enum (Python) | 12 |
| T305 | Create ExportMode enum (Python) | 9 |

## Progress Log

**2026-02-06**: Scan complete. Found 242 JS string comparisons, ~50 Python. Identified 10 categories of magic strings. Top priorities are editorMode (25), statusFilter (16), and keyframe origin (16).
