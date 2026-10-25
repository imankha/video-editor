import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AnnotateTimeline } from './AnnotateTimeline';

beforeEach(() => {
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.matchMedia = (query) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
});

// T13220: suggestion ticks are extra pixels only when there are suggestions; a tap seeks via the
// handler and never reaches the timeline's own click-to-seek.
const base = { currentTime: 0, duration: 100, onSeek: vi.fn(), regions: [] };

describe('AnnotateTimeline suggestion ticks', () => {
  it('renders nothing without ticks', () => {
    render(<AnnotateTimeline {...base} />);
    expect(screen.queryAllByTestId('suggestion-tick')).toHaveLength(0);
  });

  it('renders one tick per suggestion and taps call the handler, not onSeek', () => {
    const onSeek = vi.fn();
    const onTick = vi.fn();
    render(<AnnotateTimeline {...base} onSeek={onSeek} suggestionTicks={[{ id: 'a', time: 10, label: 'Goal' }, { id: 'b', time: 50, label: 'Attack' }]} onSuggestionTickClick={onTick} />);
    const ticks = screen.getAllByTestId('suggestion-tick');
    expect(ticks).toHaveLength(2);
    fireEvent.click(ticks[1]);
    expect(onTick).toHaveBeenCalledWith('b');
    expect(onSeek).not.toHaveBeenCalled();
  });
});
