import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

// T11240 C1/C2 (R9): the Focus sidebar's per-clip framing badge (T10980) moves into
// UnifiedHeader's `extraControls` slot now that the sidebar is gone. `FramingHeaderStatus`
// is a leaf presentational component gated on FRAMING mode, driven by the same
// `clipIsFramed` predicate the export gate uses (utils/clipSelectors.js) so the badge and
// the export gate can never disagree. Module does not exist yet — RED on C1.

import { FramingHeaderStatus } from './FramingHeaderStatus';

const FRAMING = 'framing';
const OVERLAY = 'overlay';

function croppedClip() {
  return { id: 1, crop_data: [{ frame: 0, x: 0, y: 0, width: 100, height: 100 }] };
}
function trimOnlyClip() {
  return { id: 1, crop_data: [], segments_data: { trimRange: { start: 1, end: 5 }, segmentSpeeds: {}, userSplits: [] } };
}
function speedOnlyClip() {
  return { id: 1, crop_data: [], segments_data: { trimRange: null, segmentSpeeds: { '0': 0.5 }, userSplits: [] } };
}
function untouchedClip() {
  return { id: 1, crop_data: [], segments_data: { trimRange: null, segmentSpeeds: {}, userSplits: [] } };
}

describe('FramingHeaderStatus (T11240 R9)', () => {
  it('renders nothing outside FRAMING mode', () => {
    const { container } = render(<FramingHeaderStatus editorMode={OVERLAY} clip={croppedClip()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing with no clip', () => {
    const { container } = render(<FramingHeaderStatus editorMode={FRAMING} clip={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is DONE for a clip with crop keyframes', () => {
    render(<FramingHeaderStatus editorMode={FRAMING} clip={croppedClip()} />);
    expect(screen.getByTestId('clip-framing-badge')).toHaveAttribute('data-state', 'done');
  });

  it('is DONE for a trim-only clip', () => {
    render(<FramingHeaderStatus editorMode={FRAMING} clip={trimOnlyClip()} />);
    expect(screen.getByTestId('clip-framing-badge')).toHaveAttribute('data-state', 'done');
  });

  it('is DONE for a speed-only clip', () => {
    render(<FramingHeaderStatus editorMode={FRAMING} clip={speedOnlyClip()} />);
    expect(screen.getByTestId('clip-framing-badge')).toHaveAttribute('data-state', 'done');
  });

  it('is UNDONE for an untouched clip', () => {
    render(<FramingHeaderStatus editorMode={FRAMING} clip={untouchedClip()} />);
    expect(screen.getByTestId('clip-framing-badge')).toHaveAttribute('data-state', 'undone');
  });
});
