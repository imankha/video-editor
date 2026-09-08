import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// T8970 item 2: in Playback Annotations mode a sidebar row click seeks playback
// (onSelectRegion -> seekToClip) and the active clip is highlighted, but the
// MUTATING ClipDetailsEditor must NOT render — otherwise the user can rename /
// retag / delete / create-reel a clip mid-playback (the "users can still click on
// the clips menu in playback mode" bug). The active clip's selection is a playback
// cursor, not an edit target.
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

describe('ClipsSidePanel — details editor gated off in playback mode (T8970)', () => {
  it('hides ClipDetailsEditor for the active clip while isPlaybackMode (desktop)', () => {
    // During playback the parent sets selectedRegionId = activeClipId, which
    // pre-fix rendered the editor for the playing clip.
    render(
      <ClipsSidePanel
        {...baseProps}
        clipRegions={clipRegions}
        selectedRegionId="c1"
        activePlaybackClipId="c1"
        isPlaybackMode={true}
      />
    );
    expect(screen.queryByTestId('details-editor')).toBeNull();
  });

  it('still shows ClipDetailsEditor for a selected clip in normal annotate mode', () => {
    render(
      <ClipsSidePanel
        {...baseProps}
        clipRegions={clipRegions}
        selectedRegionId="c1"
        isPlaybackMode={false}
      />
    );
    expect(screen.getByTestId('details-editor')).toBeTruthy();
  });

  it('hides the mobile detail takeover while isPlaybackMode', () => {
    render(
      <ClipsSidePanel
        {...baseProps}
        clipRegions={clipRegions}
        selectedRegionId="c1"
        activePlaybackClipId="c1"
        isMobile={true}
        isPlaybackMode={true}
      />
    );
    // Mobile takeover renders the same ClipDetailsEditor full-panel; gated off too.
    expect(screen.queryByTestId('details-editor')).toBeNull();
  });
});
