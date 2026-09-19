import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ClipRegionLayer from './ClipRegionLayer';

// jsdom lacks ResizeObserver; the component only uses it for mobile marker sizing.
beforeEach(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

// T5700: layer tint is a SECONDARY cue — rating stays the primary hue (the disc
// icon), never overwritten by the layer color. T10430: the cue moved from a
// fixed-width underline foot on the marker to a span bar covering the clip's
// real startTime..endTime range along the track.
describe('ClipRegionLayer — layer tint (T5700)', () => {
  it('draws a cyan span for a My Athlete clip and an amber span for a Team clip, each over its real time range', () => {
    const regions = [
      { id: 'mine', startTime: 0, endTime: 5, rating: 4, my_athlete: true },
      { id: 'team', startTime: 10, endTime: 15, rating: 4, my_athlete: false },
    ];
    render(<ClipRegionLayer regions={regions} duration={100} selectedRegionId={null} onSelectRegion={() => {}} />);

    // Both markers are the same rating-4 disc; the layer never changes the disc color.
    const icons = screen.getAllByTestId('rating-icon');
    expect(icons).toHaveLength(2);
    expect(icons.map((i) => i.dataset.rating)).toEqual(['4', '4']);
    expect(screen.getAllByText('!')).toHaveLength(2); // notation kept for a11y/textContent

    const spans = screen.getAllByTestId('clip-span');
    expect(spans).toHaveLength(2);
    expect(spans[0].style.backgroundColor).toBe('rgb(6, 182, 212)'); // cyan-500 #06b6d4
    expect(spans[1].style.backgroundColor).toBe('rgb(245, 158, 11)'); // amber-500 #f59e0b
    // 0-5s and 10-15s of a 100s track.
    expect(spans[0].style.left).toBe('0%');
    expect(spans[0].style.width).toBe('5%');
    expect(spans[1].style.left).toBe('10%');
    expect(spans[1].style.width).toBe('5%');
  });

  it('a legacy my_athlete=null clip spans as My Athlete (cyan), matching the ?? true rule', () => {
    const regions = [{ id: 'legacy', startTime: 0, endTime: 5, rating: 3, my_athlete: null }];
    render(<ClipRegionLayer regions={regions} duration={100} selectedRegionId={null} onSelectRegion={() => {}} />);
    expect(screen.getByTestId('rating-icon').dataset.rating).toBe('3');
    expect(screen.getByTestId('clip-span').style.backgroundColor).toBe('rgb(6, 182, 212)');
  });

  // T6400: the tooltip no longer names the layer (user: "we should rely on coloring
  // to signal this"). The tint underline above + the two-lane split carry it visually.
  it('the hover/select tooltip shows the clip name but NOT the layer name', () => {
    const regions = [{ id: 'team', startTime: 0, endTime: 5, rating: 4, name: 'Great press', my_athlete: false }];
    render(<ClipRegionLayer regions={regions} duration={100} selectedRegionId="team" onSelectRegion={() => {}} />);
    expect(screen.getByText('Great press', { exact: false })).toBeTruthy();
    expect(screen.queryByText('Team', { exact: false })).toBeNull();
    expect(screen.queryByText('My Athlete', { exact: false })).toBeNull();
  });

  // T6400: the tooltip carries the layer as a colored left accent instead of text.
  it('accents the tooltip with the layer color (amber Team / cyan My Athlete)', () => {
    const team = [{ id: 'team', startTime: 0, endTime: 5, rating: 4, name: 'Great press', my_athlete: false }];
    const { unmount } = render(
      <ClipRegionLayer regions={team} duration={100} selectedRegionId="team" onSelectRegion={() => {}} />
    );
    expect(screen.getByText('Great press', { exact: false }).closest('div').style.borderLeft)
      .toContain('rgb(245, 158, 11)'); // amber-500
    unmount();

    const mine = [{ id: 'mine', startTime: 0, endTime: 5, rating: 4, name: 'Solo run', my_athlete: true }];
    render(<ClipRegionLayer regions={mine} duration={100} selectedRegionId="mine" onSelectRegion={() => {}} />);
    expect(screen.getByText('Solo run', { exact: false }).closest('div').style.borderLeft)
      .toContain('rgb(6, 182, 212)'); // cyan-500
  });

  // T6400: removing the visible label must NOT leave the layer conveyed by color
  // alone (WCAG 1.4.1) — the marker keeps it as its accessible name.
  it('the marker still exposes the layer as its accessible name', () => {
    const regions = [
      { id: 'team', startTime: 0, endTime: 5, rating: 4, name: 'Great press', my_athlete: false },
      { id: 'mine', startTime: 10, endTime: 15, rating: 4, name: 'Solo run', my_athlete: true },
    ];
    render(<ClipRegionLayer regions={regions} duration={100} selectedRegionId={null} onSelectRegion={() => {}} />);
    expect(screen.getByLabelText('Great press - Team')).toBeTruthy();
    expect(screen.getByLabelText('Solo run - My athlete')).toBeTruthy();
  });

  // T5700 follow-up: an empty per-layer lane (Annotate's two-lane desktop split) still
  // renders a track with a custom empty message, rather than silently disappearing.
  it('renders a caller-provided emptyMessage when there are no regions', () => {
    render(<ClipRegionLayer regions={[]} duration={100} selectedRegionId={null} onSelectRegion={() => {}} emptyMessage="No Team clips yet" />);
    expect(screen.getByText('No Team clips yet')).toBeTruthy();
  });
});
