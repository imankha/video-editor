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
});
