import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import { ClipSelectorSidebar } from './ClipSelectorSidebar';

// Default props for a minimal render
const defaultProps = {
  clips: [],
  selectedClipId: null,
  onSelectClip: vi.fn(),
  onAddClip: vi.fn(),
  onDeleteClip: vi.fn(),
  onReorderClips: vi.fn(),
  globalTransition: { type: 'cut', duration: 0 },
  onTransitionChange: vi.fn(),
  onAddFromLibrary: vi.fn(),
  onUploadWithMetadata: vi.fn(),
  existingRawClipIds: [],
  games: [],
  clipMetadataCache: {},
};

/**
 * Create a raw backend clip shape (WorkingClipResponse).
 * T250: No more client-side IDs or stored boolean flags.
 */
function makeClip(overrides = {}) {
  return {
    id: 1,
    filename: 'test.mp4',
    file_url: null,
    crop_data: null,
    segments_data: null,
    timing_data: null,
    rating: null,
    tags: [],
    notes: null,
    name: null,
    game_id: null,
    raw_clip_id: null,
    ...overrides,
  };
}

describe('ClipSelectorSidebar', () => {
  it('renders clip without filename as selectable (uses game video range queries)', () => {
    const clip = makeClip({ filename: null });
    render(<ClipSelectorSidebar {...defaultProps} clips={[clip]} />);
    const clipItem = screen.getByTestId('clip-item');
    expect(clipItem.className).not.toContain('opacity-60');
    expect(clipItem.className).not.toContain('cursor-default');
  });

  it('renders clip with filename as selectable', () => {
    const clip = makeClip({ filename: 'test.mp4' });
    render(<ClipSelectorSidebar {...defaultProps} clips={[clip]} />);
    const clipItem = screen.getByTestId('clip-item');
    expect(clipItem.className).not.toContain('opacity-60');
  });

  // T9460: on a freshly created draft (Annotate save -> Focus open), the clip is
  // loaded via fetchClips WITHOUT a clipMetadataCache entry. The sidebar must still
  // show the real duration derived from the clip's own boundaries, never 0.0s.
  describe('duration on the freshly-created-draft path (T9460)', () => {
    it('shows the real duration from clip boundaries when the metadata cache is empty', () => {
      const clip = makeClip({ start_time: 3, end_time: 9 });
      render(<ClipSelectorSidebar {...defaultProps} clips={[clip]} clipMetadataCache={{}} />);
      expect(screen.getByText('6.0s')).toBeTruthy();
      expect(screen.queryByText('0.0s')).toBeNull();
    });

    it('still shows the duration from the metadata cache when present (revisit path)', () => {
      const clip = makeClip({ id: 1, start_time: 3, end_time: 9 });
      render(
        <ClipSelectorSidebar
          {...defaultProps}
          clips={[clip]}
          clipMetadataCache={{ 1: { duration: 6 } }}
        />
      );
      expect(screen.getByText('6.0s')).toBeTruthy();
      expect(screen.queryByText('0.0s')).toBeNull();
    });

    it('renders a loading state, never 0.0s, when the duration is genuinely unknown', () => {
      const clip = makeClip({ start_time: null, end_time: null });
      render(<ClipSelectorSidebar {...defaultProps} clips={[clip]} clipMetadataCache={{}} />);
      expect(screen.queryByText('0.0s')).toBeNull();
      expect(screen.getByText('Loading…')).toBeTruthy();
    });
  });

  // T8350: TERTIARY staleness cue — a per-clip amber dot beside the framing
  // status indicator, for the screen where boundaries are actually edited.
  describe('staleness dot (T8350)', () => {
    it('shows the amber dot for a clip whose live boundaries drifted from its reel snapshot', () => {
      const clip = makeClip({ start_time: 11, end_time: 20, reel_source_start_time: 10, reel_source_end_time: 20 });
      render(<ClipSelectorSidebar {...defaultProps} clips={[clip]} />);
      const dot = screen.getByLabelText('Edited since this reel was made');
      expect(dot).toBeTruthy();
      expect(dot.getAttribute('title')).toBe('Edited since this reel was made — re-export to update');
    });

    it('shows no dot for a clip whose boundaries match its reel snapshot', () => {
      const clip = makeClip({ start_time: 10, end_time: 20, reel_source_start_time: 10, reel_source_end_time: 20 });
      render(<ClipSelectorSidebar {...defaultProps} clips={[clip]} />);
      expect(screen.queryByLabelText('Edited since this reel was made')).toBeNull();
    });

    it('shows no dot for a clip that was never produced (NULL snapshot)', () => {
      const clip = makeClip({ start_time: 10, end_time: 20, reel_source_start_time: null, reel_source_end_time: null });
      render(<ClipSelectorSidebar {...defaultProps} clips={[clip]} />);
      expect(screen.queryByLabelText('Edited since this reel was made')).toBeNull();
    });
  });
});
