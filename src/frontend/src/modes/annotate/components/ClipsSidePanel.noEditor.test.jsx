import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// T8600 D2: the desktop sidebar add/edit form is DELETED (not hidden behind a
// flag) — the under-canvas strip (AnnotateModeView) is now the ONLY desktop
// non-fullscreen editor. ClipsSidePanel renders no AnnotateFullscreenOverlay
// at all; it still suppresses ClipDetailsEditor while an editor is open
// (clipEditorOpen, renamed from showAddClipForm) so a live per-field-persisting
// editor and the strip's batch-on-Save form can never co-exist. Re-homes the
// T8590 existingClip invariant check to AnnotateModeView.strip.test.jsx.
vi.mock('./ClipListItem', () => ({ default: () => null }));
vi.mock('./ClipDetailsEditor', () => ({ default: () => <div data-testid="details-editor" /> }));
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
};

const clipRegions = [
  { id: 'c1', startTime: 10, endTime: 20, videoSequence: 1, my_athlete: true, name: 'Great Pass', rating: 5 },
];

describe('ClipsSidePanel — no live editor render site (T8600)', () => {
  it('never renders AnnotateFullscreenOverlay, even while clipEditorOpen', () => {
    render(
      <ClipsSidePanel
        {...baseProps}
        clipRegions={clipRegions}
        selectedRegionId="c1"
        clipEditorOpen={true}
      />
    );
    // The overlay used to render literal "Edit Play"/"Add Play" text (T8590 test);
    // with the render site deleted, neither the overlay nor its text exists.
    expect(screen.queryByText(/^(Add|Edit) Play$/)).toBeNull();
  });

  it('hides ClipDetailsEditor while clipEditorOpen (mutual exclusion with the strip)', () => {
    render(
      <ClipsSidePanel
        {...baseProps}
        clipRegions={clipRegions}
        selectedRegionId="c1"
        clipEditorOpen={true}
      />
    );
    expect(screen.queryByTestId('details-editor')).toBeNull();
  });

  it('shows ClipDetailsEditor for a selected clip once clipEditorOpen is false', () => {
    render(
      <ClipsSidePanel
        {...baseProps}
        clipRegions={clipRegions}
        selectedRegionId="c1"
        clipEditorOpen={false}
      />
    );
    expect(screen.getByTestId('details-editor')).toBeTruthy();
  });
});
