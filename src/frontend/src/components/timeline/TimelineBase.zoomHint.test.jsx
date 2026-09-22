import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TimelineBase } from './TimelineBase';

/**
 * T10370 — the "Scroll to zoom timeline" hint must only render when the host mode
 * actually wired zoom-by-wheel. Annotate selects the playhead layer but never passes
 * onTimelineZoomByWheel, which previously left a dead, always-"100%" hint on screen.
 */
describe('TimelineBase zoom hint', () => {
  const baseProps = {
    currentTime: 0,
    duration: 10,
    onSeek: () => {},
    selectedLayer: 'playhead',
    layerLabels: <div />,
  };

  it('hides the hint when onTimelineZoomByWheel is not provided (Annotate)', () => {
    render(<TimelineBase {...baseProps} />);
    expect(screen.queryByText(/Scroll to zoom timeline/)).toBeNull();
  });

  it('shows the hint when onTimelineZoomByWheel is provided (Focus/Overlay)', () => {
    render(<TimelineBase {...baseProps} onTimelineZoomByWheel={() => {}} timelineZoom={150} />);
    expect(screen.getByText('Scroll to zoom timeline')).toBeTruthy();
  });

  it('hides the hint when the playhead layer is not selected, even with the handler wired', () => {
    render(<TimelineBase {...baseProps} selectedLayer="clips" onTimelineZoomByWheel={() => {}} />);
    expect(screen.queryByText(/Scroll to zoom timeline/)).toBeNull();
  });
});
