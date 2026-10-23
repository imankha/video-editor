import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SourceBar from './SourceBar';

// T13280: the Videos control under the player. The sequential fixture is the measured
// user game (19s video then an 85 minute video appended at 0:18) that defeated every
// time-proportional marker before it. Neither video covers the other's span, so there
// is never a conflict at rest: this is the common case (T13280 follow-up, user
// 2026-10-22: "only show this when the playhead is on a frame with overlapping
// videos"), tested as the COMPACT-at-rest, expand-on-demand bar.
const sequential = [
  { sequence: 1, name: 'IMG_4412', kind: 'main', virtualStart: 0, virtualEnd: 18.84, placedAtEnd: false, coversPlayhead: false },
  { sequence: 2, name: 'oct-5-2…-10-05', kind: 'main', virtualStart: 18.84, virtualEnd: 5135.7, placedAtEnd: true, coversPlayhead: false },
];
// A genuine conflict exists at the playhead regardless of which is active (video 2
// always covers it): forces the bar open automatically, no trigger tap needed.
const overlap = [
  { sequence: 1, name: 'Main camera', kind: 'main', virtualStart: 0, virtualEnd: 3600, placedAtEnd: false, coversPlayhead: true },
  { sequence: 2, name: 'Sideline', kind: 'angle', virtualStart: 1200, virtualEnd: 3000, placedAtEnd: false, coversPlayhead: true },
];

describe('SourceBar (T13280)', () => {
  it('renders nothing for fewer than two videos', () => {
    const { container } = render(<SourceBar videos={[sequential[0]]} activeSequence={1} />);
    expect(container.innerHTML).toBe('');
  });

  it('at rest (no conflict), a 2-3 video game shows a compact trigger, not segments', () => {
    render(<SourceBar videos={sequential} activeSequence={2} index={2} count={2} />);
    expect(screen.getByTestId('source-bar')).toBeTruthy();
    expect(screen.getByTestId('source-trigger')).toBeTruthy();
    expect(screen.getByTestId('source-trigger').getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTestId('source-readout').textContent).toBe('Video 2 of 2');
    expect(screen.queryByTestId('source-seg-1')).toBeNull();
    expect(screen.queryByTestId('source-seg-2')).toBeNull();
  });

  it('tapping the trigger expands into one equal segment per video, marking the active one', () => {
    render(<SourceBar videos={sequential} activeSequence={2} index={2} count={2} />);
    fireEvent.click(screen.getByTestId('source-trigger'));
    expect(screen.getByTestId('source-seg-1').textContent).toContain('IMG_4412');
    expect(screen.getByTestId('source-seg-2').textContent).toContain('oct-5-2…-10-05');
    expect(screen.getByTestId('source-seg-2').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('source-seg-1').getAttribute('aria-pressed')).toBe('false');
    // Both segments share the grid equally: the 19s video is not a sliver.
    const grid = screen.getByTestId('source-seg-1').parentElement;
    expect(grid.style.gridTemplateColumns).toBe('repeat(2, minmax(0, 1fr))');
  });

  it('every video stays reachable collapsed or expanded: tapping a segment, including the active one, calls onPick', () => {
    const onPick = vi.fn();
    render(<SourceBar videos={sequential} activeSequence={2} index={2} count={2} onPick={onPick} />);
    fireEvent.click(screen.getByTestId('source-trigger'));
    fireEvent.click(screen.getByTestId('source-seg-1'));
    fireEvent.click(screen.getByTestId('source-trigger')); // picking re-collapses; expand again
    fireEvent.click(screen.getByTestId('source-seg-2'));
    expect(onPick.mock.calls.map((c) => c[0])).toEqual([1, 2]);
  });

  it('picking a segment collapses the bar back to compact', () => {
    render(<SourceBar videos={sequential} activeSequence={2} index={2} count={2} />);
    fireEvent.click(screen.getByTestId('source-trigger'));
    expect(screen.getByTestId('source-seg-1')).toBeTruthy();
    fireEvent.click(screen.getByTestId('source-seg-1'));
    expect(screen.queryByTestId('source-seg-1')).toBeNull();
    expect(screen.getByTestId('source-trigger')).toBeTruthy();
  });

  it('the collapse (Film icon) button re-collapses an expanded, conflict-free bar', () => {
    render(<SourceBar videos={sequential} activeSequence={2} index={2} count={2} />);
    fireEvent.click(screen.getByTestId('source-trigger'));
    expect(screen.getByTestId('source-seg-1')).toBeTruthy();
    fireEvent.click(screen.getByTestId('source-collapse'));
    expect(screen.queryByTestId('source-seg-1')).toBeNull();
    expect(screen.getByTestId('source-trigger')).toBeTruthy();
  });

  it('a genuine conflict at the playhead forces the bar open automatically, no tap needed', () => {
    render(<SourceBar videos={overlap} activeSequence={1} index={1} count={2} />);
    expect(screen.queryByTestId('source-trigger')).toBeNull();
    expect(screen.getByTestId('source-seg-1')).toBeTruthy();
    expect(screen.getByTestId('source-seg-2')).toBeTruthy();
    // The collapse button is disabled while a real conflict exists (collapsing would
    // just force back open on the next render, so don't offer a no-op control).
    expect(screen.getByTestId('source-collapse').hasAttribute('disabled')).toBe(true);
  });

  it('shows the transient notice on every width (inline from sm, floating on phone) and the pulse on the tapped segment', () => {
    render(<SourceBar videos={overlap} activeSequence={1} index={1} count={2} notice="Now watching Main camera" pulseSequence={1} pulseNonce={3} />);
    const readout = screen.getByTestId('source-readout');
    expect(readout.textContent).toBe('Now watching Main camera');
    expect(readout.getAttribute('data-notice')).toBe('true');
    expect(readout.className).toContain('sm:inline');
    // Phone: the same text floats over the bar so the segments keep their width.
    const float = screen.getByTestId('source-notice-float');
    expect(float.textContent).toBe('Now watching Main camera');
    expect(float.className).toContain('sm:hidden');
    expect(float.className).toContain('absolute');
    expect(screen.getByTestId('source-seg-1').className).toContain('angle-pulse');
  });

  it('at rest (compact) the readout is desktop-only and nothing floats', () => {
    render(<SourceBar videos={sequential} activeSequence={1} index={1} count={2} />);
    expect(screen.getByTestId('source-trigger')).toBeTruthy();
    expect(screen.queryByTestId('source-notice-float')).toBeNull();
  });

  it('on an overlap only a covering, non-active source carries the swap glyph', () => {
    render(<SourceBar videos={overlap} activeSequence={1} index={1} count={2} onFixTiming={() => {}} />);
    expect(screen.getByTestId('source-swap-2')).toBeTruthy();
    expect(screen.queryByTestId('source-swap-1')).toBeNull();
    expect(screen.getByTestId('source-seg-2').getAttribute('title')).toMatch(/switch to sideline at this moment/i);
    expect(screen.getByTestId('source-seg-2').getAttribute('data-kind')).toBe('angle');
    // Fix timing is offered only while an angle is the active source.
    expect(screen.queryByTestId('source-bar-fix-timing')).toBeNull();
  });

  it('offers Fix timing when an angle is active', () => {
    const onFixTiming = vi.fn();
    render(<SourceBar videos={overlap} activeSequence={2} index={2} count={2} onFixTiming={onFixTiming} />);
    fireEvent.click(screen.getByTestId('source-bar-fix-timing'));
    expect(onFixTiming).toHaveBeenCalledWith(2);
  });

  // T13280 follow-up (2026-10-22, user ask): Fix Timing -- drag/reposition -- is
  // reachable for any ADDED video, not only angles, so an appended (sequential)
  // video can be manually placed too. Only the game's own original video
  // (virtualStart 0) never offers it, since there's nothing to align it against.
  // The fix button lives on the bar's own row in both collapsed and expanded state.
  it('offers Fix timing for a sequential (non-angle) added video, but never for the original', () => {
    const onFixTiming = vi.fn();
    // Active = the added clip (video 2): button shows even collapsed.
    const a = render(<SourceBar videos={sequential} activeSequence={2} index={2} count={2} onFixTiming={onFixTiming} />);
    fireEvent.click(screen.getByTestId('source-bar-fix-timing'));
    expect(onFixTiming).toHaveBeenCalledWith(2);
    a.unmount();
    // Active = the original video (video 1, virtualStart 0): no button at all.
    render(<SourceBar videos={sequential} activeSequence={1} index={1} count={2} onFixTiming={() => {}} />);
    expect(screen.queryByTestId('source-bar-fix-timing')).toBeNull();
  });

  it('segments and the fix button carry 44px coarse-pointer targets', () => {
    render(<SourceBar videos={overlap} activeSequence={2} index={2} count={2} onFixTiming={() => {}} />);
    expect(screen.getByTestId('source-seg-1').className).toContain('coarse-pointer:min-h-[44px]');
    expect(screen.getByTestId('source-bar-fix-timing').className).toContain('coarse-pointer:h-11');
  });

  it('4+ videos: trigger, prev/next and a list with Fix timing rows for every non-original video', () => {
    const onPick = vi.fn();
    const onFixTiming = vi.fn();
    const four = [
      ...sequential,
      { sequence: 3, name: 'Second half', kind: 'main', virtualStart: 5135.7, virtualEnd: 8000, placedAtEnd: false, coversPlayhead: true },
      { sequence: 4, name: 'Sideline', kind: 'angle', virtualStart: 6000, virtualEnd: 7000, placedAtEnd: false, coversPlayhead: true },
    ];
    render(<SourceBar videos={four} activeSequence={3} index={3} count={4} onPick={onPick} onFixTiming={onFixTiming} />);
    expect(screen.queryByTestId('source-seg-1')).toBeNull();
    expect(screen.getByTestId('source-readout').textContent).toBe('Watching Second half');
    fireEvent.click(screen.getByTestId('source-prev'));
    expect(onPick).toHaveBeenLastCalledWith(2);
    fireEvent.click(screen.getByTestId('source-next'));
    expect(onPick).toHaveBeenLastCalledWith(4);
    fireEvent.click(screen.getByTestId('source-trigger'));
    expect(screen.getByTestId('source-list')).toBeTruthy();
    expect(screen.getByTestId('source-swap-4')).toBeTruthy();
    fireEvent.click(screen.getByTestId('source-fix-timing-4'));
    expect(onFixTiming).toHaveBeenCalledWith(4);
    expect(screen.queryByTestId('source-list')).toBeNull();
  });

  it('4+ videos: the list offers Fix timing for sequential add-ons too, never for the original', () => {
    const onFixTiming = vi.fn();
    const four = [
      ...sequential,
      { sequence: 3, name: 'Second half', kind: 'main', virtualStart: 5135.7, virtualEnd: 8000, placedAtEnd: false, coversPlayhead: true },
      { sequence: 4, name: 'Sideline', kind: 'angle', virtualStart: 6000, virtualEnd: 7000, placedAtEnd: false, coversPlayhead: true },
    ];
    render(<SourceBar videos={four} activeSequence={3} index={3} count={4} onFixTiming={onFixTiming} />);
    fireEvent.click(screen.getByTestId('source-trigger'));
    expect(screen.getByTestId('source-fix-timing-2')).toBeTruthy();
    expect(screen.getByTestId('source-fix-timing-3')).toBeTruthy();
    expect(screen.queryByTestId('source-fix-timing-1')).toBeNull();
    fireEvent.click(screen.getByTestId('source-fix-timing-3'));
    expect(onFixTiming).toHaveBeenCalledWith(3);
  });
});
