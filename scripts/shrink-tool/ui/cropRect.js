/**
 * T8840 ui/cropRect.js -- the crop rect UI (design §5, Q4). DOM-only (canvas +
 * pointer events); never imported by pipeline/. The rect lives in normalized space
 * at all times (design: "canvas pixels are only ever a render-time multiplication"),
 * so a resized window or a different preview resolution cannot drift it.
 *
 * Free aspect, 8 handles (4 corners + 4 edges), pointer events only
 * (pointerdown/move/up with setPointerCapture, no mouse/touch split).
 */

const MIN_FRACTION = 0.1; // task file: crop clamps so width/height >= 10% of the source
const HIT_RADIUS = 10; // px, hit-test tolerance for a handle

// handle id -> [nx, ny] position on the rect, 0..1 in each axis (0.5 = midpoint = untouched by that axis)
const HANDLES = {
  nw: [0, 0], n: [0.5, 0], ne: [1, 0],
  w: [0, 0.5], e: [1, 0.5],
  sw: [0, 1], s: [0.5, 1], se: [1, 1],
};
const CURSOR_BY_HANDLE = {
  nw: 'nwse-resize', se: 'nwse-resize',
  ne: 'nesw-resize', sw: 'nesw-resize',
  n: 'ns-resize', s: 'ns-resize',
  w: 'ew-resize', e: 'ew-resize',
};

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ onChange?: (crop: {x:number,y:number,w:number,h:number}) => void }} [options]
 */
export function createCropRectController(canvas, { onChange = () => {} } = {}) {
  const ctx = canvas.getContext('2d');
  let crop = { x: 0, y: 0, w: 1, h: 1 };
  let frameWidth = 0;
  let frameHeight = 0;
  let source = null;
  let drawRect = { x: 0, y: 0, w: canvas.width, h: canvas.height };
  let drag = null; // { mode, startX, startY, crop0 } in normalized frame space

  function computeDrawRect() {
    if (!frameWidth || !frameHeight) return { x: 0, y: 0, w: canvas.width, h: canvas.height };
    const scale = Math.min(canvas.width / frameWidth, canvas.height / frameHeight);
    const w = frameWidth * scale;
    const h = frameHeight * scale;
    return { x: (canvas.width - w) / 2, y: (canvas.height - h) / 2, w, h };
  }

  function rectPx() {
    return {
      x: drawRect.x + crop.x * drawRect.w,
      y: drawRect.y + crop.y * drawRect.h,
      w: crop.w * drawRect.w,
      h: crop.h * drawRect.h,
    };
  }

  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (source) ctx.drawImage(source, drawRect.x, drawRect.y, drawRect.w, drawRect.h);

    const r = rectPx();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(drawRect.x, drawRect.y, drawRect.w, r.y - drawRect.y); // top
    ctx.fillRect(drawRect.x, r.y + r.h, drawRect.w, drawRect.y + drawRect.h - (r.y + r.h)); // bottom
    ctx.fillRect(drawRect.x, r.y, r.x - drawRect.x, r.h); // left
    ctx.fillRect(r.x + r.w, r.y, drawRect.x + drawRect.w - (r.x + r.w), r.h); // right

    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2;
    ctx.strokeRect(r.x, r.y, r.w, r.h);

    ctx.fillStyle = '#3b82f6';
    for (const [nx, ny] of Object.values(HANDLES)) {
      const hx = r.x + nx * r.w;
      const hy = r.y + ny * r.h;
      ctx.fillRect(hx - 4, hy - 4, 8, 8);
    }
  }

  function hitTest(px, py) {
    const r = rectPx();
    for (const [id, [nx, ny]] of Object.entries(HANDLES)) {
      const hx = r.x + nx * r.w;
      const hy = r.y + ny * r.h;
      if (Math.abs(px - hx) <= HIT_RADIUS && Math.abs(py - hy) <= HIT_RADIUS) return id;
    }
    if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return 'move';
    return null;
  }

  /** px/py in canvas pixel space -> normalized frame-space coordinates. */
  function toNormalized(px, py) {
    return {
      x: drawRect.w ? (px - drawRect.x) / drawRect.w : 0,
      y: drawRect.h ? (py - drawRect.y) / drawRect.h : 0,
    };
  }

  function applyDrag(mode, crop0, dx, dy) {
    if (mode === 'move') {
      return {
        x: clamp(crop0.x + dx, 0, 1 - crop0.w),
        y: clamp(crop0.y + dy, 0, 1 - crop0.h),
        w: crop0.w,
        h: crop0.h,
      };
    }
    const [nx, ny] = HANDLES[mode];
    let { x, y, w, h } = crop0;
    if (nx === 0) {
      const right = crop0.x + crop0.w;
      x = clamp(crop0.x + dx, 0, right - MIN_FRACTION);
      w = right - x;
    } else if (nx === 1) {
      w = clamp(crop0.w + dx, MIN_FRACTION, 1 - crop0.x);
    }
    if (ny === 0) {
      const bottom = crop0.y + crop0.h;
      y = clamp(crop0.y + dy, 0, bottom - MIN_FRACTION);
      h = bottom - y;
    } else if (ny === 1) {
      h = clamp(crop0.h + dy, MIN_FRACTION, 1 - crop0.y);
    }
    return { x, y, w, h };
  }

  function setCropInternal(next, { notify = true } = {}) {
    crop = next;
    render();
    if (notify) onChange({ ...crop });
  }

  function localPos(evt) {
    const bounds = canvas.getBoundingClientRect();
    return {
      px: ((evt.clientX - bounds.left) / bounds.width) * canvas.width,
      py: ((evt.clientY - bounds.top) / bounds.height) * canvas.height,
    };
  }

  canvas.addEventListener('pointerdown', (evt) => {
    const { px, py } = localPos(evt);
    const mode = hitTest(px, py);
    if (!mode) return;
    canvas.setPointerCapture(evt.pointerId);
    const start = toNormalized(px, py);
    drag = { mode, startX: start.x, startY: start.y, crop0: { ...crop } };
  });

  canvas.addEventListener('pointermove', (evt) => {
    const { px, py } = localPos(evt);
    if (!drag) {
      const mode = hitTest(px, py);
      canvas.style.cursor = mode === 'move' ? 'move' : mode ? CURSOR_BY_HANDLE[mode] : 'default';
      return;
    }
    const cur = toNormalized(px, py);
    const dx = cur.x - drag.startX;
    const dy = cur.y - drag.startY;
    setCropInternal(applyDrag(drag.mode, drag.crop0, dx, dy));
  });

  function endDrag(evt) {
    if (!drag) return;
    canvas.releasePointerCapture(evt.pointerId);
    drag = null;
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  canvas.addEventListener('dblclick', (evt) => {
    const { px, py } = localPos(evt);
    if (hitTest(px, py)) return; // only resets on a click outside the current rect
    setCropInternal({ x: 0, y: 0, w: 1, h: 1 });
  });

  return {
    /** Draws a new preview frame (video/canvas/ImageBitmap) without moving the rect (design §5 "switching segments"). */
    setFrame(newSource, sourceWidth, sourceHeight) {
      source = newSource;
      frameWidth = sourceWidth;
      frameHeight = sourceHeight;
      drawRect = computeDrawRect();
      render();
    },
    getCrop() {
      return { ...crop };
    },
    setCrop(next) {
      setCropInternal({ x: next.x, y: next.y, w: next.w, h: next.h }, { notify: false });
    },
    reset() {
      setCropInternal({ x: 0, y: 0, w: 1, h: 1 });
    },
  };
}
