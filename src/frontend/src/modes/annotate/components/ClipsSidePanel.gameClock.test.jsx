import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// T4080: ClipsSidePanel must show each clip's in-match soccer time and order rows
// by in-match start (the reference order Reel Drafts / My Reels match). Mock the
// heavy children and capture what ClipListItem receives.
vi.mock('./ClipListItem', () => ({
  default: ({ region, index, gameClock }) => (
    <div data-testid="row" data-id={region.id} data-clock={gameClock ?? ''}>
      {`${index + 1}:${region.id}:${gameClock ?? ''}`}
    </div>
  ),
}));
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
  clipCount: 0,
  videoDuration: 6000,
};

describe('ClipsSidePanel — in-match soccer time + ordering (T4080)', () => {
  it('shows MM\'SS" on each row, ordered by in-match start (single-video game)', () => {
    // Deliberately out of order; should render sorted by startTime.
    const clipRegions = [
      { id: 'c2', startTime: 754, endTime: 760, videoSequence: 1 }, // 12'34"
      { id: 'c1', startTime: 65, endTime: 70, videoSequence: 1 },   //  1'05"
    ];
    render(<ClipsSidePanel {...baseProps} clipRegions={clipRegions} boundaryOffsets={[]} />);

    const rows = screen.getAllByTestId('row');
    expect(rows.map((r) => r.getAttribute('data-id'))).toEqual(['c1', 'c2']);
    expect(rows.map((r) => r.getAttribute('data-clock'))).toEqual(["1'05\"", "12'34\""]);
  });

  it('applies the prior-half offset for a 2nd-half clip without double-counting', () => {
    // virtualClipRegions bake the offset into startTime and keep raw in _actualStartTime.
    const clipRegions = [
      { id: 'h1', startTime: 754, endTime: 760, _actualStartTime: 754, videoSequence: 1 },
      { id: 'h2', startTime: 2710, endTime: 2720, _actualStartTime: 10, videoSequence: 2 },
    ];
    render(<ClipsSidePanel {...baseProps} clipRegions={clipRegions} boundaryOffsets={[2700]} />);

    const rows = screen.getAllByTestId('row');
    // seq1 before seq2; raw 10 + 2700 offset = 45'10" (not 2710 + 2700)
    expect(rows.map((r) => r.getAttribute('data-id'))).toEqual(['h1', 'h2']);
    expect(rows.map((r) => r.getAttribute('data-clock'))).toEqual(["12'34\"", "45'10\""]);
  });
});
