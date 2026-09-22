import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

/**
 * T10970: `showTextLane` gates BOTH halves of the Text lane (the label in the
 * fixed left column and the TextLayer track) and shrinks the playhead-line
 * height so the line ends at the Highlight lane. Default `true` keeps every
 * existing caller unchanged.
 */

const timelineBaseProps = vi.fn();

vi.mock('../../components/timeline/TimelineBase', () => ({
  EDGE_PADDING: 0,
  TimelineBase: (props) => {
    timelineBaseProps(props);
    return (
      <div>
        <div data-testid="labels">{props.layerLabels}</div>
        <div data-testid="layers">{props.children}</div>
      </div>
    );
  },
}));
vi.mock('../../components/timeline/RegionLayer', () => ({ default: () => <div data-testid="region-layer" /> }));
vi.mock('../../components/timeline/TextLayer', () => ({ default: () => <div data-testid="text-layer" /> }));
vi.mock('./layers/DetectionMarkerLayer', () => ({ default: () => <div /> }));
vi.mock('./layers/PosterMarkerLayer', () => ({ default: () => <div /> }));

import { OverlayMode } from './OverlayMode';

function baseProps(overrides = {}) {
  return {
    videoUrl: 'blob:overlay',
    currentTime: 0,
    duration: 10,
    visualDuration: 10,
    ...overrides,
  };
}

function lastTotalLayerHeight() {
  const calls = timelineBaseProps.mock.calls;
  return calls[calls.length - 1][0].totalLayerHeight;
}

describe('OverlayMode -- showTextLane (T10970)', () => {
  it('defaults to showing the Text lane label and track', () => {
    render(<OverlayMode {...baseProps()} />);
    expect(screen.getByTestId('text-layer-toggle')).toBeTruthy();
    expect(screen.getByTestId('text-layer')).toBeTruthy();
    expect(lastTotalLayerHeight()).toBe('13.5rem');
  });

  it('showTextLane=false removes the label and the track and shortens the playhead line', () => {
    render(<OverlayMode {...baseProps({ showTextLane: false })} />);
    expect(screen.queryByTestId('text-layer-toggle')).toBeNull();
    expect(screen.queryByTestId('text-layer')).toBeNull();
    expect(screen.getByTestId('region-layer')).toBeTruthy();
    expect(lastTotalLayerHeight()).toBe('8.25rem');
  });

  it('with detection data the hidden lane still subtracts exactly its own height', () => {
    const highlightRegions = [{ detections: [{ boxes: [{ x: 0, y: 0, w: 1, h: 1 }] }] }];
    render(<OverlayMode {...baseProps({ highlightRegions, showTextLane: false })} />);
    expect(lastTotalLayerHeight()).toBe('10.5rem');
  });
});
