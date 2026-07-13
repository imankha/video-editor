# T5120: Add Spotlight export fails with KeyError 'strokeOpacity' on transform-restored keyframes

**Status:** TODO
**Impact:** 8
**Complexity:** 2
**Created:** 2026-07-13
**Updated:** 2026-07-13
**Bug:** prod 32p (reporter sarkarati@gmail.com, build d5dfbea8). Strongly related to 31p / T4900.

## Problem

Prod bug 32p: clicking **Add Spotlight** (overlay export) fails with a red toast:

> Export failed: Overlay processing failed: 'strokeOpacity'

The single-quoted `'strokeOpacity'` is a Python `KeyError` repr. The export never
produces a video.

### Relationship to 31p (T4900) — the "fix we thought we shipped"

T4900 (deployed prod 2026-07-13) diagnosed bug 31p ("network error" on overlay
export) as (a) CORS middleware ordering hiding 5xx errors as opaque
`TypeError: Failed to fetch`, plus (b) the Modal renderer reading region-level
`region["start_time"]` with bare bracket access, KeyErroring on camelCase blobs.
It added `_normalize_region_keys()` at the single DB-read boundary in
`render_overlay` to canonicalize `startTime`/`endTime` -> `start_time`/`end_time`.

**T4900 fixed the REGION-level keys but missed the KEYFRAME-level opacity keys.**
The underlying export-blocking `KeyError` was never removed — T4900's CORS fix only
made it *visible*. Bug 31's opaque "network error" and bug 32's now-visible
`'strokeOpacity'` are very likely the same export failure surfaced before vs after
the CORS fix. This task removes the actual blocker.

## Root Cause (fully traced)

The "Add Spotlight" render path is the Modal endpoint `render_overlay`
(`src/backend/app/routers/export/overlay.py` ~line 1921). It builds the render
payload from the DB, NOT from the request body:

```python
highlight_regions = [
    _normalize_region_keys(r)
    for r in (decode_data(project['highlights_data']) or [])
]
```

`highlight_regions` flows unchanged into `call_modal_overlay_auto(...)` (overlay.py:1740).
The Modal function `_spline_interpolate_highlight` (video_processing.py:659-672)
interpolates each keyframe property with a bare-key spline read:

```python
def sp(prop):
    return _catmull_rom(sorted_kf[p0_idx][prop], sorted_kf[p1_idx][prop], ...)
...
'strokeOpacity': max(0.0, min(1.0, sp('strokeOpacity'))),   # KeyError here
'fillOpacity':   max(0.0, min(1.0, sp('fillOpacity'))),
```

Keyframes that went through the **framing->overlay transform / restore**
(`src/backend/app/highlight_transform.py`) store only a single `opacity` field and
DROP `strokeOpacity`/`fillOpacity` (see `raw_from_working` / `working_from_raw`:
they emit `{time, x, y, radiusX, radiusY, opacity, color}`). So a restored keyframe
has `opacity` but no `strokeOpacity` -> `sp('strokeOpacity')` raises
`KeyError('strokeOpacity')` -> caught in the Modal processor -> `result["error"] =
"strokeOpacity"` -> overlay.py:1755 `raise RuntimeError(f"Overlay processing failed:
{error}")` -> the exact toast.

`_normalize_region_keys` normalizes region-level keys only; it does not touch
keyframe dicts, so the opacity-only keyframes pass straight through.

### Why the request-body parse (overlay.py:964-981) is NOT the failing path

That block bare-accesses `kf['strokeOpacity']` too, but on failure raises HTTP 400
`"Invalid highlight regions JSON: 'strokeOpacity'"` — a different message. The
reported toast is the Modal-path message, confirming the DB-read path (line 1921)
is the one that fires for Add Spotlight.

### The sanctioned fallback already exists

The legacy flat-keyframe parse already handles opacity-only keyframes:

```python
# overlay.py:998-999 (legacy format branch)
'strokeOpacity': kf.get('strokeOpacity', kf.get('opacity', 0.85)),
'fillOpacity':   kf.get('fillOpacity',   kf.get('opacity', 0.05)),
```

This is the established contract for opacity-only keyframes. The fix propagates the
same normalization to the DB-read boundary so every consumer (Modal spline, local
`KeyframeInterpolator._interpolate` spline, request-body parse) receives keyframes
that always carry `strokeOpacity`/`fillOpacity`.

## Solution

**Single-source fix at the DB-read boundary** (mirrors exactly how T4900 fixed the
region keys). Extend `_normalize_region_keys(region)` in
`src/backend/app/routers/export/overlay.py` to ALSO normalize every keyframe in
`region['keyframes']`: ensure `strokeOpacity` and `fillOpacity` exist, deriving from
the legacy `opacity` fallback identical to overlay.py:998-999:

```python
for kf in region.get('keyframes', []):
    if 'strokeOpacity' not in kf:
        kf['strokeOpacity'] = kf.get('opacity', 0.85)
    if 'fillOpacity' not in kf:
        kf['fillOpacity'] = kf.get('opacity', 0.05)
```

Because `render_overlay` runs every DB region through `_normalize_region_keys`, the
normalized `highlight_regions` then feed both the Modal path and the local path, so
neither spline helper KeyErrors. Update the docstring to note it now normalizes
keyframe opacity keys too (not just region time keys).

Do this at the ONE boundary — do NOT sprinkle `.get()` defensive reads into the two
spline helpers (video_processing.py `sp`, keyframe_interpolator.py `_spline_prop`).
Per CLAUDE.md (single write path / no scattered defensive fixes), normalize once
where T4900 already normalizes. The spline helpers can keep asserting the key exists;
the boundary guarantees it.

### Bare-key access sites (for reference — all fed by the normalized payload)
- `src/backend/app/modal_functions/video_processing.py:668-669` — Modal spline (reported failure)
- `src/backend/app/ai_upscaler/keyframe_interpolator.py:176-177` — local spline (same latent bug)
- `src/backend/app/routers/export/overlay.py:975-976` — request-body region parse (already 400s, but normalize-in-place at 969-978 is optional belt; the DB-boundary fix is the required one)

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/export/overlay.py` — `_normalize_region_keys` (~364), `render_overlay` DB read (~1921), legacy fallback precedent (~998), error surface (~1755). **Primary fix here.**
- `src/backend/app/modal_functions/video_processing.py` — `_spline_interpolate_highlight` (~659) bare `sp('strokeOpacity')`; render consumption already tolerant (`result.get('strokeOpacity', 0.85)` ~738). No edit needed if boundary fix lands.
- `src/backend/app/ai_upscaler/keyframe_interpolator.py` — local `_interpolate` spline (~176). No edit needed if boundary fix lands.
- `src/backend/app/highlight_transform.py` — source of opacity-only keyframes (~666, ~734). Do NOT change the raw-storage schema here; the render boundary already treats opacity-only as first-class.

### Related Tasks
- **T4900 / 31p** (DONE, deployed 2026-07-13): fixed region-key normalization + CORS visibility + persistence gap at the same helper/boundary. This task completes the missed keyframe-key half. Read `docs/plans/tasks/T4900-add-spotlight-ignores-user-keyframes.md`.

### Technical Notes
- Knowledge docs: `.claude/knowledge/keyframes-framing.md`, `.claude/knowledge/export-pipeline.md` — load before exploring.
- Semantic nuance for review: legacy derives strokeOpacity from `opacity` (fill-ish, ~0.15) which yields a faint stroke; that is the EXISTING legacy behavior, so mirroring it is the safe, consistent choice. If review prefers a fixed `0.85` stroke default over deriving from `opacity`, that is a defensible alternative — but keep stroke/fill behavior identical to overlay.py:998-999 unless there is evidence the legacy default renders wrong.
- No schema change, no migration. Backend-only. Existing DB blobs stay as-is; the read boundary heals them for rendering.

## Implementation

### Steps
1. [ ] Write a failing backend test: a region whose keyframes carry only `opacity` (no strokeOpacity/fillOpacity), run through `_normalize_region_keys` + the Modal spline `_spline_interpolate_highlight`, asserting no KeyError and that strokeOpacity/fillOpacity are present/derived. (bug-reproduction skill: red first.)
2. [ ] Extend `_normalize_region_keys` to normalize keyframe opacity keys (mirror overlay.py:998-999).
3. [ ] Confirm test goes green; run existing overlay/keyframe tests (`test_t4900_overlay_keyframe_persistence.py`, `test_overlay_bounds.py`) still pass.
4. [ ] Verify end-to-end: drive an overlay export on a clip whose highlight keyframes came from a restore/transform (opacity-only) and confirm the render completes (per workers-QA: exercise the real flow, don't stop at "tests pass").

### Progress Log
**2026-07-13**: Task created from prod bug 32p. Root cause fully traced by supervisor: `_normalize_region_keys` (T4900's DB-read boundary) normalizes region time keys but not keyframe opacity keys; transform-restored keyframes are opacity-only; Modal spline `sp('strokeOpacity')` KeyErrors. Fix = extend the boundary normalizer, mirroring the sanctioned legacy fallback.

## Acceptance Criteria
- [ ] Add Spotlight export completes on a project whose highlight keyframes lack `strokeOpacity`/`fillOpacity` (opacity-only, transform-restored) — no `KeyError: 'strokeOpacity'`.
- [ ] Regression test pins the opacity-only keyframe -> normalized -> spline-interpolated path (red before fix, green after).
- [ ] Fix lives solely at the `_normalize_region_keys` DB-read boundary; spline helpers unchanged (no scattered defensive `.get()`).
- [ ] Stroke/fill opacity behavior for opacity-only keyframes matches the existing legacy fallback (overlay.py:998-999).
- [ ] Existing overlay/keyframe backend tests still pass.
