# T5180: Rich text engine (TextSpec + font catalogue + one renderer, one preview)

**Status:** TODO
**Impact:** 7 | **Complexity:** 5
**Epic:** [Player Intro + Rich Text](EPIC.md) — foundation, runs in parallel with T5190

> Read [EPIC.md](EPIC.md) first (decisions 5 and 6 are this task's whole mandate). Knowledge doc:
> `.claude/knowledge/export-pipeline.md` (§ branded outro, § T5240 landmines).

## Problem

Two features need styled text drawn onto video: the intro card ([T5210](T5210-intro-card-generation.md))
and the Overlay text layer ([T5225](T5225-overlay-text-layer.md)). If each builds its own text
drawing, the app grows two font stacks, two escaping bugs, and two ways for the preview to disagree
with the export. **This task builds the text system once, with no user-visible feature attached.**

There is a vestigial `TextOverlay` model in `schemas.py:273` (absolute pixel `x`/`y`, pixel
`fontSize`, no font choice, no wrap). It is a placeholder from an earlier pass; **replace it**, do
not extend it — pixel coordinates cannot render the same spec at 1080x1920, 1920x1080 and in a
150px preview box.

## Scope

### 1. TextSpec — the shared model

All dimensions **normalised** (fractions of the frame), never pixels:

```json
{
  "text":      "MIDFIELDER  6 - 8 - 10",
  "font":      "anton",
  "size":      0.055,
  "color":     "#FFD66B",
  "align":     "left",
  "position":  { "x": 0.08, "y": 0.72 },
  "maxWidth":  0.84,
  "shadow":    { "blur": 0.004, "color": "#000000", "opacity": 0.55 },
  "stroke":    { "width": 0, "color": "#000000" },
  "animation": "fade-up"
}
```

- `size` and `shadow.blur` are fractions of frame **height**; `maxWidth` and `position.x` are
  fractions of frame **width**. Document this once and never mix it.
- `position` is the **anchor**, interpreted per `align` (left = left edge, center = centre, right =
  right edge); `y` is the text block's top edge.
- `animation` is card-only (`none | fade | fade-up | wipe`); the Overlay layer ignores it in v1.
- Pydantic model in `app/schemas.py` (replacing `TextOverlay`/`TextOverlaysData`) + a matching
  JSDoc typedef + `as const` font/align/animation maps on the frontend (project rule: no magic
  strings).

### 2. Font catalogue — 6 curated faces

- Ship the TTFs in `src/backend/app/assets/fonts/` (alongside the existing
  `DejaVuSans-Bold.ttf`) and serve the identical files to the browser.
- **Licence check is part of this task** — OFL / Apache / equivalent only, and record the licence
  file next to each face. A face whose licence cannot be verified does not ship.
- A single manifest (`fonts.json`: key, display name, file, weight/style, fallback stack) is the
  ONE source of truth, read by both the backend renderer and the frontend `@font-face` generation.
  Greppable string keys (`"anton"`), never computed names.
- Six roles to cover: broadcast bold, condensed jersey, clean sans, editorial serif, technical
  mono, italic sport. Exact faces are the implementer's pick within the licence rule.

### 3. `app/services/text_render.py` — the ONE backend renderer

- `render_text_layer(spec: TextSpec, frame_w: int, frame_h: int) -> PIL.Image` — RGBA, transparent
  background, the text composited at its normalised position with wrap, shadow and stroke applied.
- Pillow only (already a dependency: `pillow==11.3.0`). **No ffmpeg `drawtext`** — decision 5.
- Word wrap at `maxWidth`, multi-line alignment, and line height derived from the face's own
  metrics (never a hard-coded multiplier).
- Cache by content hash of `(spec, frame_w, frame_h)` — the same layer is re-requested every frame
  by T5225 and on every card build by T5210.
- Consumers get an **RGBA PNG / numpy array**; this module never touches ffmpeg, video, R2 or the DB.

### 4. `RichText.jsx` — the ONE frontend preview

- Renders a TextSpec into a DOM box sized in the parent's units, using `@font-face` rules generated
  from the same `fonts.json` and the same TTF files (served by the backend or bundled by Vite —
  pick one and document it).
- Pure presentational component (project MVC rule): props in, no store access, no fetching.

### 5. Parity test — the deliverable that makes this a system

- A test that renders the same TextSpec through `text_render.py` and through `RichText.jsx`
  (Playwright, measuring the rendered box) and asserts the text block's **width, height and
  baseline agree within a documented tolerance** for every font in the catalogue.
- Without this test the "one system" claim is unverified and the two paths will drift silently.

## Relevant files
- `src/backend/app/schemas.py:268-306` — the `TextOverlay` stub being replaced
- `src/backend/app/assets/fonts/` — existing `DejaVuSans-Bold.ttf` lives here
- `src/backend/app/services/branded_outro.py` — the T5240 `drawtext` landmines this task exists to avoid
- `src/frontend/src/components/` — new `RichText.jsx`
- `src/backend/requirements.txt` — `pillow==11.3.0`, `numpy==1.26.4` already present

## Classification hint
M/L-tier. Backend + frontend, no schema change, no migration, no new dependency. Architect gate on
the TextSpec shape (it is consumed by three later tasks and is expensive to change afterwards).
Reviewer required. Tester Phase 1 for the parity test.

## Acceptance criteria
- [ ] TextSpec exists as a Pydantic model + frontend typedef, with all dimensions normalised; the
      old pixel-based `TextOverlay` stub is gone (no dead code left behind).
- [ ] 6 fonts ship with verified licences and a single `fonts.json` manifest read by both sides.
- [ ] `render_text_layer` produces an RGBA layer with correct wrap, alignment, shadow and stroke,
      identical in relative terms at 1080x1920 and 1920x1080.
- [ ] `RichText.jsx` renders the same spec in the browser from the same TTFs.
- [ ] The parity test passes for every font in the catalogue, with the tolerance documented.
- [ ] No ffmpeg `drawtext` anywhere in the new code.
