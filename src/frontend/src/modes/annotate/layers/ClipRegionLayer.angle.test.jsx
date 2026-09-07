import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ClipRegionLayer from './ClipRegionLayer';

beforeEach(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const regions = [
  { id: 'backbone', startTime: 0, endTime: 5, rating: 4, my_athlete: true, index: 0, videoSequence: 1 },
  { id: 'angle', startTime: 0, endTime: 5, rating: 5, my_athlete: true, index: 1, videoSequence: 2 },
];

describe('ClipRegionLayer — angle-sourced clip treatment (T8890)', () => {
  it('marks an angle-sourced clip with the camera glyph; backbone clip gets none', () => {
    render(
      <ClipRegionLayer
        regions={regions}
        duration={100}
        selectedRegionId={null}
        onSelectRegion={() => {}}
        angleSequences={new Set([2])}
      />,
    );
    // Exactly one glyph -> only the angle clip (seq 2).
    expect(screen.getAllByTestId('angle-clip-glyph').length).toBe(1);
  });

  it('renders ZERO angle treatment when angleSequences is absent (common case)', () => {
    const { container } = render(
      <ClipRegionLayer regions={regions} duration={100} selectedRegionId={null} onSelectRegion={() => {}} />,
    );
    expect(screen.queryByTestId('angle-clip-glyph')).toBeNull();
    expect(container.innerHTML).not.toContain('#a78bfa'); // no violet accent
  });
});
