import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import CropLayer from './CropLayer';
import { CropProvider } from '../contexts/CropContext';

/**
 * Regression test for the double-keyframe-at-start bug:
 * After a front trim, the controller keeps the permanent frame-0 keyframe
 * (model scaffolding — keyframes span the full source timeline) plus the
 * reconstituted boundary keyframe at the trim start. Both map to visual
 * position 0, so the timeline showed two stacked markers at the start.
 * Keyframes outside the visible trim range must not render.
 */

const FRAMERATE = 29.97002997002997;
const DURATION = 10.438660096879175;

// Mirrors prod data from the bug report: front trim at 1.4001s (frame 42)
const KEYFRAMES = [
  { frame: 0, x: 792.403, y: 0, width: 607.499, height: 1079.999, origin: 'permanent' },
  { frame: 42, x: 520.629, y: 0, width: 607.499, height: 1079.999, origin: 'permanent' },
  { frame: 129, x: 830.655, y: 0, width: 607.499, height: 1079.999, origin: 'user' },
  { frame: 313, x: 248.238, y: 0, width: 607.499, height: 1079.999, origin: 'permanent' },
];

const TRIM_RANGE = { start: 1.4001073392641956, end: DURATION };

function renderCropLayer(props = {}) {
  return render(
    <CropProvider value={{ isEndKeyframeExplicit: true }}>
      <CropLayer
        keyframes={KEYFRAMES}
        duration={DURATION}
        visualDuration={DURATION - TRIM_RANGE.start}
        currentTime={TRIM_RANGE.start}
        framerate={FRAMERATE}
        isActive
        onKeyframeClick={vi.fn()}
        onKeyframeDelete={vi.fn()}
        trimRange={TRIM_RANGE}
        {...props}
      />
    </CropProvider>
  );
}

function getMarkerTooltips() {
  return Array.from(document.querySelectorAll('[title^="Keyframe at frame"]'))
    .map(el => el.getAttribute('title'));
}

describe('CropLayer trim range rendering', () => {
  it('hides keyframes before the trim start (no double marker at visible start)', () => {
    renderCropLayer();

    const tooltips = getMarkerTooltips();
    expect(tooltips).toHaveLength(3);
    expect(tooltips.some(t => t.startsWith('Keyframe at frame 0 '))).toBe(false);
    expect(tooltips.some(t => t.startsWith('Keyframe at frame 42 '))).toBe(true);
  });

  it('renders all keyframes when there is no trim', () => {
    renderCropLayer({ trimRange: null, visualDuration: DURATION, currentTime: 0 });

    expect(getMarkerTooltips()).toHaveLength(4);
  });

  it('makes every visible keyframe deletable (flat-list model, no protected boundaries)', () => {
    renderCropLayer();

    // Flat-list model: there are no protected boundary keyframes. Frame 0 is
    // hidden (before the trim), and all 3 visible keyframes (42, 129, 313) expose
    // a delete button. The only floor is "can't delete the last remaining one".
    const deleteButtons = screen.queryAllByTitle('Delete keyframe');
    expect(deleteButtons).toHaveLength(3);
  });
});

// T3780: the empty-timeline placeholder used jargon ("Set Crop Keyframes to animate
// crop window"). Replaced with outcome-first copy a soccer parent understands.
// T11710: the hint now shows at ZERO focus points (the flat-list start state) and
// names the drag gesture — the old rule keyed on `length === 2` so nothing rendered
// with no keyframes.
describe('CropLayer placeholder copy (T3780, T11710)', () => {
  function renderWith(keyframes) {
    return render(
      <CropProvider value={{ isEndKeyframeExplicit: false }}>
        <CropLayer
          keyframes={keyframes}
          duration={3}
          visualDuration={3}
          currentTime={0}
          framerate={30}
          onKeyframeClick={vi.fn()}
          onKeyframeDelete={vi.fn()}
        />
      </CropProvider>
    );
  }

  it('shows the drag-naming hint at zero focus points', () => {
    const { container } = renderWith([]);
    expect(container.textContent).toContain('No focus points yet. Drag the box on the video to add one.');
  });

  it('shows nothing once a focus point exists', () => {
    const { container } = renderWith([{ frame: 30, origin: 'user' }]);
    expect(container.textContent).not.toMatch(/No focus points yet/i);
  });

  it('drops the "Set Crop Keyframes" jargon', () => {
    const { container } = renderWith([]);
    expect(container.textContent).not.toMatch(/Set Crop Keyframes/i);
  });
});
