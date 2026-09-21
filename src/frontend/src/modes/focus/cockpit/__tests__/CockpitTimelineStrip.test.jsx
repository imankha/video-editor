import { render, screen, fireEvent } from '@testing-library/react';
import CockpitTimelineStrip from '../CockpitTimelineStrip';

function renderStrip(overrides = {}) {
  const props = {
    keyframes: [{ frame: 30, origin: 'user', x: 0.1, y: 0.1, width: 0.3, height: 0.5 }],
    currentTime: 0.5,
    duration: 2,
    framerate: 30,
    onSeek: vi.fn(),
    onAddFocusPoint: vi.fn(),
    onOpenTrim: vi.fn(),
    onKeyframeTimeMove: vi.fn(),
    onKeyframeDelete: vi.fn(),
    onCopyCrop: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<CockpitTimelineStrip {...props} />) };
}

describe('CockpitTimelineStrip (T10840 Zone C, D10)', () => {
  it('positions markers with the shared calc(EDGE_PADDING...) formula, never a bare %', () => {
    renderStrip();
    const diamond = screen.getByTestId('cockpit-keyframe-diamond');
    const left = diamond.getAttribute('style');
    // frame 30 / 30fps = 1s of 2s = 0.5. The EDGE_PADDING(20) usable-area formula
    // (jsdom normalizes calc operand order, so assert the pieces, not the string).
    expect(left).toContain('calc(20px +');
    expect(left).toContain('(100% - 40px)');
    expect(left).toContain('0.5');
    // Playhead uses the same formula (never a raw percentage).
    const playhead = screen.getByTestId('cockpit-playhead').getAttribute('style');
    expect(playhead).toContain('calc(20px +');
    expect(playhead).toContain('(100% - 40px)');
    expect(playhead).not.toMatch(/left:\s*\d+(\.\d+)?%/);
  });

  it('gives each 13px diamond a 44px transparent hit box (an -inset-4 child)', () => {
    renderStrip();
    const diamond = screen.getByTestId('cockpit-keyframe-diamond');
    expect(diamond.className).toContain('h-[13px]');
    expect(diamond.className).toContain('w-[13px]');
    const hit = diamond.querySelector('span[aria-hidden]');
    expect(hit).not.toBeNull();
    expect(hit.className).toContain('-inset-4'); // 13 + 2*16 = 45 >= 44
  });

  it('tapping a diamond seeks to it and opens the Copy/Delete popover (D10)', () => {
    const { props } = renderStrip();
    const diamond = screen.getByTestId('cockpit-keyframe-diamond');
    expect(screen.queryByTestId('cockpit-keyframe-popover')).toBeNull();
    fireEvent.pointerDown(diamond, { pointerId: 1, clientX: 100 });
    fireEvent.pointerUp(diamond, { pointerId: 1, clientX: 100 });
    expect(props.onSeek).toHaveBeenCalledWith(1); // 1s
    const popover = screen.getByTestId('cockpit-keyframe-popover');
    expect(popover).toBeTruthy();
    fireEvent.click(screen.getByTestId('cockpit-keyframe-delete'));
    expect(props.onKeyframeDelete).toHaveBeenCalledWith(1);
  });

  it('the Copy action in the popover copies that keyframe', () => {
    const { props } = renderStrip();
    const diamond = screen.getByTestId('cockpit-keyframe-diamond');
    fireEvent.pointerDown(diamond, { pointerId: 1, clientX: 100 });
    fireEvent.pointerUp(diamond, { pointerId: 1, clientX: 100 });
    fireEvent.click(screen.getByTestId('cockpit-keyframe-copy'));
    expect(props.onCopyCrop).toHaveBeenCalledWith(1);
  });

  it('the caps add a focus point and open the Trim sheet', () => {
    const { props } = renderStrip();
    fireEvent.click(screen.getByTestId('cockpit-add-focus-point'));
    expect(props.onAddFocusPoint).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('cockpit-open-trim'));
    expect(props.onOpenTrim).toHaveBeenCalled();
  });

  it('the scrub track is touch-none (pointer-events scrubbing, not native scroll)', () => {
    renderStrip();
    expect(screen.getByTestId('cockpit-scrub-track').className).toContain('touch-none');
  });
});
