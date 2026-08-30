import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// T8040: ClipsSidePanel threads its onOpenClipInFocus prop into the desktop
// ClipDetailsEditor's onOpenInFocus prop. Mock ClipDetailsEditor to a stub
// that surfaces onOpenInFocus as a clickable button, so a broken rename in
// either component fails this test instead of silently producing a dead
// button (see T8040 review finding on the optional-chained call).
vi.mock('./ClipDetailsEditor', () => ({
  default: ({ onOpenInFocus, region }) => (
    <button onClick={() => onOpenInFocus(region.autoProjectId)}>stub-focus-button</button>
  ),
}));
vi.mock('./ClipListItem', () => ({ default: () => null }));
vi.mock('./AnnotateFullscreenOverlay', () => ({ AnnotateFullscreenOverlay: () => null }));
vi.mock('../hooks/useAnnotate', () => ({
  validateTsvContent: () => ({ success: true, annotations: [] }),
  generateTsvContent: () => '',
}));

import { ClipsSidePanel } from './ClipsSidePanel';

const baseProps = {
  onSelectRegion: () => {},
  onUpdateRegion: () => {},
  onDeleteRegion: () => {},
  onImportAnnotations: () => {},
  maxNotesLength: 500,
  clipCount: 1,
  videoDuration: 6000,
};

const clipRegions = [
  { id: 'c1', startTime: 10, endTime: 20, videoSequence: 1, my_athlete: true, autoProjectId: 42 },
];

describe('ClipsSidePanel — onOpenClipInFocus prop wiring (T8040)', () => {
  it('forwards onOpenClipInFocus to ClipDetailsEditor as onOpenInFocus', () => {
    const onOpenClipInFocus = vi.fn();
    render(
      <ClipsSidePanel
        {...baseProps}
        clipRegions={clipRegions}
        selectedRegionId="c1"
        boundaryOffsets={[]}
        onOpenClipInFocus={onOpenClipInFocus}
      />
    );
    fireEvent.click(screen.getByText('stub-focus-button'));
    expect(onOpenClipInFocus).toHaveBeenCalledWith(42);
  });
});
