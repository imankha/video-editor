import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * T7370: isPastSpotlight used to be `!!spotlightSpan && currentTime >
 * spotlightSpan.end + LOOP_EPS` with no check that the video had actually
 * loaded. A currentTime carried over from Framing (or any stale/default
 * value) could exceed a short spotlight span before Overlay's own video ever
 * loaded, showing the "Reset" pill floating over a stuck loading spinner.
 *
 * OverlayContainer has no existing test harness (it takes ~30 props injected
 * by App.jsx, per its own file docstring) — building one from scratch is out
 * of scope for a one-line boolean guard. This pins the fix at the source
 * level instead: a future edit to this line must keep the duration > 0 gate.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('OverlayContainer isPastSpotlight (T7370)', () => {
  it('gates on duration > 0 so the Reset pill cannot appear before the video has loaded', () => {
    const source = fs.readFileSync(path.join(__dirname, 'OverlayContainer.jsx'), 'utf-8');
    const match = source.match(/const isPastSpotlight = ([^;]+);/);
    expect(match).toBeTruthy();
    expect(match[1]).toContain('duration > 0');
  });
});
