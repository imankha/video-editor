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

// T5700: marker tint is a SECONDARY cue (colored underline foot) — rating stays
// the primary hue (background), never overwritten by the layer color.
describe('ClipRegionLayer — layer tint (T5700)', () => {
  it('tints a My Athlete marker cyan and a Team marker amber, without changing the rating background', () => {
    const regions = [
      { id: 'mine', startTime: 0, endTime: 5, rating: 4, my_athlete: true },
      { id: 'team', startTime: 10, endTime: 15, rating: 4, my_athlete: false },
    ];
    render(<ClipRegionLayer regions={regions} duration={100} selectedRegionId={null} onSelectRegion={() => {}} />);

    const badges = screen.getAllByText('!'); // rating-4 notation, both markers
    expect(badges).toHaveLength(2);

    const mineStyle = badges[0].style;
    const teamStyle = badges[1].style;
    // Same rating background on both — layer never overwrites the primary hue.
    expect(mineStyle.backgroundColor).toBe(teamStyle.backgroundColor);
    // Distinct layer-color underline foot.
    expect(mineStyle.borderBottom).toContain('rgb(6, 182, 212)'); // cyan-500 #06b6d4
    expect(teamStyle.borderBottom).toContain('rgb(245, 158, 11)'); // amber-500 #f59e0b
  });

  it('a legacy my_athlete=null marker tints as My Athlete (cyan), matching the ?? true rule', () => {
    const regions = [{ id: 'legacy', startTime: 0, endTime: 5, rating: 3, my_athlete: null }];
    render(<ClipRegionLayer regions={regions} duration={100} selectedRegionId={null} onSelectRegion={() => {}} />);
    const badge = screen.getByText('!?');
    expect(badge.style.borderBottom).toContain('rgb(6, 182, 212)');
  });

  it('the hover/select tooltip names the layer', () => {
    const regions = [{ id: 'team', startTime: 0, endTime: 5, rating: 4, name: 'Great press', my_athlete: false }];
    render(<ClipRegionLayer regions={regions} duration={100} selectedRegionId="team" onSelectRegion={() => {}} />);
    expect(screen.getByText('Team', { exact: false })).toBeTruthy();
  });

  // T5700 follow-up: an empty per-layer lane (Annotate's two-lane desktop split) still
  // renders a track with a custom empty message, rather than silently disappearing.
  it('renders a caller-provided emptyMessage when there are no regions', () => {
    render(<ClipRegionLayer regions={[]} duration={100} selectedRegionId={null} onSelectRegion={() => {}} emptyMessage="No Team clips yet" />);
    expect(screen.getByText('No Team clips yet')).toBeTruthy();
  });
});
