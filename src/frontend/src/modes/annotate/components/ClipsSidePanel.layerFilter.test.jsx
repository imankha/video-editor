import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// T5700: the mode toggle (surface a) sets which layer NEW clips default to
// (via onSetNewClipLayer — never writes anything itself), and the filter pills
// (surface e) filter the rendered list client-side only.
vi.mock('./ClipListItem', () => ({
  default: ({ region }) => <div data-testid="row" data-id={region.id} data-mine={String(region.my_athlete ?? true)} />,
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
  clipCount: 3,
  videoDuration: 6000,
};

const clipRegions = [
  { id: 'mine', startTime: 10, endTime: 20, videoSequence: 1, my_athlete: true },
  { id: 'team', startTime: 30, endTime: 40, videoSequence: 1, my_athlete: false },
  { id: 'legacy', startTime: 50, endTime: 60, videoSequence: 1, my_athlete: null },
];

describe('ClipsSidePanel — mode toggle + layer filter (T5700)', () => {
  it('mode toggle reflects newClipLayerIsMine and calls onSetNewClipLayer on click — never touches clip data', () => {
    const onSetNewClipLayer = vi.fn();
    render(
      <ClipsSidePanel {...baseProps} clipRegions={clipRegions} boundaryOffsets={[]} newClipLayerIsMine={true} onSetNewClipLayer={onSetNewClipLayer} />
    );
    expect(screen.getByRole('radio', { name: 'My Athlete layer' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: 'Team layer' }));
    expect(onSetNewClipLayer).toHaveBeenCalledWith(false);
  });

  it('filter pills default to All (every clip shown)', () => {
    render(<ClipsSidePanel {...baseProps} clipRegions={clipRegions} boundaryOffsets={[]} layerFilter="all" />);
    expect(screen.getAllByTestId('row')).toHaveLength(3);
  });

  it('the My Athlete filter shows my_athlete=true AND legacy null clips, excludes Team', () => {
    render(<ClipsSidePanel {...baseProps} clipRegions={clipRegions} boundaryOffsets={[]} layerFilter="mine" />);
    const ids = screen.getAllByTestId('row').map((r) => r.getAttribute('data-id'));
    expect(ids.sort()).toEqual(['legacy', 'mine']);
  });

  it('the Team filter shows only my_athlete=false clips', () => {
    render(<ClipsSidePanel {...baseProps} clipRegions={clipRegions} boundaryOffsets={[]} layerFilter="team" />);
    const ids = screen.getAllByTestId('row').map((r) => r.getAttribute('data-id'));
    expect(ids).toEqual(['team']);
  });

  it('clicking a filter pill calls onSetLayerFilter with that value', () => {
    const onSetLayerFilter = vi.fn();
    render(<ClipsSidePanel {...baseProps} clipRegions={clipRegions} boundaryOffsets={[]} layerFilter="all" onSetLayerFilter={onSetLayerFilter} />);
    fireEvent.click(screen.getByRole('button', { name: 'Team' }));
    expect(onSetLayerFilter).toHaveBeenCalledWith('team');
  });

  it('shows a layer-specific empty state when the filter yields zero rows (clips DO exist)', () => {
    render(<ClipsSidePanel {...baseProps} clipRegions={clipRegions.filter((r) => r.my_athlete !== false)} boundaryOffsets={[]} layerFilter="team" />);
    expect(screen.getByText('No Team clips')).toBeTruthy();
    expect(screen.queryByTestId('row')).toBeNull();
  });

  it('an empty game (no clips at all) still shows the generic "No clips yet" message', () => {
    render(<ClipsSidePanel {...baseProps} clipRegions={[]} boundaryOffsets={[]} layerFilter="team" />);
    expect(screen.getByText('No clips yet')).toBeTruthy();
  });
});
