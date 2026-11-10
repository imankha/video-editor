import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// T15640 AC1: "Jump to play" on the mobile clip row landed at the play's END
// (region.endTime was passed through instead of region.startTime), so tapping
// it on a 14-22s play seeked to the END of the play rather than its start.
vi.mock('./ClipDetailsEditor', () => ({ default: () => null }));
vi.mock('./AnnotateFullscreenOverlay', () => ({ AnnotateFullscreenOverlay: () => null }));
vi.mock('../hooks/useAnnotate', () => ({
  validateTsvContent: () => ({ success: true, annotations: [] }),
  generateTsvContent: () => '',
}));

import { ClipsSidePanel } from './ClipsSidePanel';

const baseProps = {
  selectedRegionId: null,
  onSelectRegion: () => {},
  onUpdateRegion: () => {},
  onDeleteRegion: () => {},
  onImportAnnotations: () => {},
  maxNotesLength: 500,
  clipCount: 1,
  videoDuration: 6000,
  boundaryOffsets: [],
  isMobile: true,
};

const clipRegions = [
  { id: 'play-1', startTime: 14, endTime: 36, videoSequence: 1, my_athlete: true },
];

describe('ClipsSidePanel — Jump to play (T15640:C1)', () => {
  it('calls onJumpToClip with the play START time, not its end time', () => {
    const onJumpToClip = vi.fn();
    render(<ClipsSidePanel {...baseProps} clipRegions={clipRegions} onJumpToClip={onJumpToClip} />);

    fireEvent.click(screen.getByTitle('Jump to play'));

    expect(onJumpToClip).toHaveBeenCalledWith('play-1', 14);
  });
});
