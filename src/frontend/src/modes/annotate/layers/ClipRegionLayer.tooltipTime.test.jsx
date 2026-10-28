import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ClipRegionLayer from './ClipRegionLayer';

// T13480: the marker tooltip showed the play's END time while the on-video card
// and the clip lists show its START (clipGameClock). A play spanning 0:00-0:04
// read "0:04" on the timeline and 0'00" on the card, so the card looked like it
// was showing before its play. The tooltip now names the same moment: the start.
describe('ClipRegionLayer — tooltip time is the play start (T13480)', () => {
  beforeEach(() => {
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  it('shows the start time, not the end time', () => {
    const regions = [
      { id: 'a', startTime: 65, endTime: 69, rating: 4, name: 'QA first play', my_athlete: true, index: 0 },
    ];
    render(
      <ClipRegionLayer
        regions={regions}
        duration={600}
        selectedRegionId="a"
        onSelectRegion={() => {}}
      />,
    );
    const tooltip = screen.getByTestId('clip-marker-tooltip');
    expect(tooltip.textContent).toContain('1:05');
    expect(tooltip.textContent).not.toContain('1:09');
  });
});
