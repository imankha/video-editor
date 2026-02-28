import { render, screen, fireEvent } from '@testing-library/react';
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
  onRetryExtraction: vi.fn(),
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
    extraction_status: null,
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

describe('ClipSelectorSidebar extraction states', () => {
  it('renders "Extracting..." for a clip with extraction_status=running', () => {
    const clip = makeClip({
      filename: null,
      extraction_status: 'running',
    });
    render(<ClipSelectorSidebar {...defaultProps} clips={[clip]} />);
    expect(screen.getByText('Extracting...')).toBeTruthy();
  });

  it('renders "Waiting for extraction" for a clip with no extraction_status and no filename', () => {
    const clip = makeClip({
      filename: null,
      extraction_status: null,
    });
    render(<ClipSelectorSidebar {...defaultProps} clips={[clip]} />);
    expect(screen.getByText('Waiting for extraction')).toBeTruthy();
  });

  it('renders "Retrying..." for a clip with extraction_status=retrying', () => {
    const clip = makeClip({
      filename: null,
      extraction_status: 'retrying',
    });
    render(<ClipSelectorSidebar {...defaultProps} clips={[clip]} />);
    expect(screen.getByText('Retrying...')).toBeTruthy();
  });

  it('renders "Failed" with retry button for a failed clip', () => {
    const clip = makeClip({
      filename: null,
      extraction_status: 'failed',
    });
    render(<ClipSelectorSidebar {...defaultProps} clips={[clip]} />);
    expect(screen.getByText('Failed')).toBeTruthy();
    expect(screen.getByText('Retry')).toBeTruthy();
  });

  it('calls onRetryExtraction with clip.id when retry button is clicked', () => {
    const onRetry = vi.fn();
    const clip = makeClip({
      id: 99,
      filename: null,
      extraction_status: 'failed',
    });
    render(
      <ClipSelectorSidebar {...defaultProps} clips={[clip]} onRetryExtraction={onRetry} />
    );
    fireEvent.click(screen.getByText('Retry'));
    expect(onRetry).toHaveBeenCalledWith(99);
  });

  it('does not show retry button for retrying (auto-retry in progress) clips', () => {
    const clip = makeClip({
      filename: null,
      extraction_status: 'retrying',
    });
    render(<ClipSelectorSidebar {...defaultProps} clips={[clip]} />);
    expect(screen.queryByText('Retry')).toBeNull();
  });
});
