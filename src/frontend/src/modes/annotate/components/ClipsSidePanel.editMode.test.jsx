import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// T8590: the non-fullscreen "Add Clip form" render must pass existingClip
// (the selected region) into AnnotateFullscreenOverlay so EDITING opens the
// overlay in edit mode instead of silently falling back to create mode
// (isEditMode = !!existingClip in AnnotateFullscreenOverlay). Mock the
// overlay to a stub that surfaces the existingClip prop so a regression here
// fails this test instead of only showing up live (see T8590 task file).
vi.mock('./AnnotateFullscreenOverlay', () => ({
  AnnotateFullscreenOverlay: ({ existingClip }) => (
    <div>{existingClip ? `Edit Play:${existingClip.id}` : 'Add Play'}</div>
  ),
}));
vi.mock('./ClipListItem', () => ({ default: () => null }));
vi.mock('./ClipDetailsEditor', () => ({ default: () => null }));
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
  boundaryOffsets: [],
  onCreateClip: () => {},
  onUpdateClip: () => {},
};

const clipRegions = [
  { id: 'c1', startTime: 10, endTime: 20, videoSequence: 1, my_athlete: true, name: 'Great Pass', rating: 5 },
];

describe('ClipsSidePanel — inline overlay existingClip wiring (T8590)', () => {
  it('passes the selected region as existingClip when EDITING (showAddClipForm + selection)', () => {
    render(
      <ClipsSidePanel
        {...baseProps}
        clipRegions={clipRegions}
        selectedRegionId="c1"
        showAddClipForm={true}
      />
    );
    expect(screen.getByText('Edit Play:c1')).toBeTruthy();
  });

  it('passes no existingClip when CREATING (showAddClipForm, no selection)', () => {
    render(
      <ClipsSidePanel
        {...baseProps}
        clipRegions={clipRegions}
        selectedRegionId={null}
        showAddClipForm={true}
      />
    );
    expect(screen.getByText('Add Play')).toBeTruthy();
  });
});
