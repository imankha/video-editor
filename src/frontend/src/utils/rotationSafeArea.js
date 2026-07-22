/**
 * Rotation safe-area geometry (T5640 — Framing horizon straighten).
 *
 * SINGLE SOURCE OF TRUTH for the inscribed "no-black-corners" crop clamp and
 * the rotated-frame quad used by the out-of-bounds dim mask. Mirrored in Python
 * at `src/backend/app/services/rotation_safe_area.py` (kept in sync; the backend
 * copy exists only for the characterization test / defense — the export TRUSTS
 * the stored clamped crop and never re-clamps at render time).
 *
 * Coordinate / sign convention (design §2.1, pinned):
 *   theta = content-correction angle in DEGREES, positive = rotate content
 *   counter-clockwise (standard math orientation, y-up). Stored in
 *   working_clips.rotation. The RENDER is always:
 *       render(frame) = crop_{x,y,w,h}( rotate_theta_aboutCenter_sameWH(frame) )
 *   so crop coords live in the ROTATED frame space and theta=0 is byte-identical
 *   to today. Rotation is about the frame center with output size == source W*H,
 *   which preserves the coordinate box.
 *
 *   - CSS preview:  transform: rotate(-theta deg) about the display-rect center.
 *   - cv2 export:   getRotationMatrix2D(center, angle=theta)  (cv2 CCW positive).
 *   - ffmpeg:       rotate=a=-theta*PI/180 : ow=iw : oh=ih : c=black.
 */

// Hard rotation cap in degrees (design decision #3: user chose 20 over 15).
// The straighten tool and the fine dial both clamp to +/- this.
export const MAX_ROT = 20;

/**
 * Largest axis-aligned rectangle (unconstrained aspect) that fits, centered,
 * inside a W*H frame rotated by theta degrees. Classic rotatedRectWithMaxArea.
 * Returns { width, height } in frame pixels.
 */
export function maxAxisAlignedInRotated(W, H, thetaDeg) {
  const a = Math.abs(thetaDeg) * Math.PI / 180;
  if (a === 0) return { width: W, height: H };

  const sinA = Math.abs(Math.sin(a));
  const cosA = Math.abs(Math.cos(a));
  const longer = Math.max(W, H);
  const shorter = Math.min(W, H);
  const widthIsLonger = W >= H;

  let wr;
  let hr;
  if (shorter <= 2 * sinA * cosA * longer || Math.abs(sinA - cosA) < 1e-10) {
    // Half-constrained case: the rectangle touches the midpoint of the shorter side.
    const halfShort = 0.5 * shorter;
    if (widthIsLonger) {
      wr = halfShort / sinA;
      hr = halfShort / cosA;
    } else {
      wr = halfShort / cosA;
      hr = halfShort / sinA;
    }
  } else {
    const cos2a = cosA * cosA - sinA * sinA;
    wr = (W * cosA - H * sinA) / cos2a;
    hr = (H * cosA - W * sinA) / cos2a;
  }
  return { width: wr, height: hr };
}

/**
 * The largest centered box of target aspect r (= ratioW/ratioH) that fits inside
 * the inscribed rectangle for (W, H, theta). Returns the allowed crop region:
 * { x0, y0, wSafe, hSafe } in frame pixels.
 */
export function safeAreaForAspect(W, H, thetaDeg, r) {
  const { width: wr, height: hr } = maxAxisAlignedInRotated(W, H, thetaDeg);

  let wSafe;
  let hSafe;
  if (wr / hr >= r) {
    // Height-constrained.
    wSafe = hr * r;
    hSafe = hr;
  } else {
    // Width-constrained.
    wSafe = wr;
    hSafe = wr / r;
  }

  const x0 = (W - wSafe) / 2;
  const y0 = (H - hSafe) / 2;
  return { x0, y0, wSafe, hSafe };
}

/**
 * Clamp a crop box to the inscribed safe area for (W, H, theta), preserving the
 * target aspect r exactly. Shrinks (aspect-locked) then re-centers within the
 * allowed region. Deterministic — the guarantee that the export has no black
 * corners. Returns { x, y, width, height }.
 *
 * theta === 0 is an explicit identity fast path (no clamp) so the theta=0
 * behavior is byte-identical to today.
 */
export function clampCropToSafeArea(crop, W, H, thetaDeg, r) {
  if (!thetaDeg) return { x: crop.x, y: crop.y, width: crop.width, height: crop.height };

  const S = safeAreaForAspect(W, H, thetaDeg, r);

  let w = Math.min(crop.width, S.wSafe);
  let h = Math.min(crop.height, S.hSafe);
  // Keep aspect exactly r after the shrink.
  if (w / h > r) w = h * r;
  else h = w / r;

  const maxX = S.x0 + S.wSafe - w;
  const maxY = S.y0 + S.hSafe - h;
  const x = Math.min(Math.max(crop.x, S.x0), maxX);
  const y = Math.min(Math.max(crop.y, S.y0), maxY);

  return { x, y, width: w, height: h };
}

/**
 * The 4 corners of a W*H frame after the CSS content rotation, in FRAME-space
 * pixels (map each through videoToScreen to draw the dim-mask hole). Order:
 * top-left, top-right, bottom-right, bottom-left.
 *
 * The video element is CSS-rotated by rotate(-theta) about the display-rect
 * center; frame space and screen space share the y-down orientation and
 * videoToScreen is a uniform scale + offset, so rotating the corners about the
 * frame center by the same CSS angle here and then mapping is equivalent to the
 * on-screen rotated video. Uses the CSS rotate(a) matrix with a = -theta:
 *   x' = x cos a - y sin a ; y' = x sin a + y cos a   (about the center).
 */
export function rotatedFrameCorners(W, H, thetaDeg) {
  const a = -thetaDeg * Math.PI / 180;
  const cosA = Math.cos(a);
  const sinA = Math.sin(a);
  const cx = W / 2;
  const cy = H / 2;
  const rot = (px, py) => {
    const dx = px - cx;
    const dy = py - cy;
    return {
      x: cx + dx * cosA - dy * sinA,
      y: cy + dx * sinA + dy * cosA,
    };
  };
  return [rot(0, 0), rot(W, 0), rot(W, H), rot(0, H)];
}
