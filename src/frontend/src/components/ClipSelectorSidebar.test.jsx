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
};

function makeClip(overrides = {}) {
  return {
    id: 'clip_1',
    workingClipId: 1,
    fileName: 'test.mp4',
    fileNameDisplay: 'test',
    duration: 10,
    isExtracted: true,
    isExtracting: false,
    isFailed: false,
    extractionStatus: null,
    rating: null,
    tags: [],
    annotateNotes: null,
    annotateName: null,
    cropKeyframes: [],
    game_id: null,
    ...overrides,
  };
}

describe('ClipSelectorSidebar extraction states', () => {
  it('renders "Extracting..." for a clip with isExtracting=true', () => {
    const clip = makeClip({
      isExtracted: false,
      isExtracting: true,
      extractionStatus: 'running',
    });
    render(<ClipSelectorSidebar {...defaultProps} clips={[clip]} />);
    expect(screen.getByText('Extracting...')).toBeTruthy();
  });

  it('renders "Waiting for extraction" for a pending clip', () => {
    const clip = makeClip({
      isExtracted: false,
      isExtracting: false,
      extractionStatus: 'pending',
    });
    render(<ClipSelectorSidebar {...defaultProps} clips={[clip]} />);
    expect(screen.getByText('Waiting for extraction')).toBeTruthy();
  });

  it('renders "Retrying..." for a clip with extractionStatus=retrying', () => {
    const clip = makeClip({
      isExtracted: false,
      isExtracting: false,
      isFailed: false,
      extractionStatus: 'retrying',
    });
    render(<ClipSelectorSidebar {...defaultProps} clips={[clip]} />);
    expect(screen.getByText('Retrying...')).toBeTruthy();
  });

  it('renders "Failed" with retry button for a failed clip', () => {
    const clip = makeClip({
      isExtracted: false,
      isExtracting: false,
      isFailed: true,
      extractionStatus: 'failed',
    });
    render(<ClipSelectorSidebar {...defaultProps} clips={[clip]} />);
    expect(screen.getByText('Failed')).toBeTruthy();
    expect(screen.getByText('Retry')).toBeTruthy();
  });

  it('calls onRetryExtraction when retry button is clicked', () => {
    const onRetry = vi.fn();
    const clip = makeClip({
      id: 'clip_99',
      workingClipId: 99,
      isExtracted: false,
      isExtracting: false,
      isFailed: true,
      extractionStatus: 'failed',
    });
    render(
      <ClipSelectorSidebar {...defaultProps} clips={[clip]} onRetryExtraction={onRetry} />
    );
    fireEvent.click(screen.getByText('Retry'));
    expect(onRetry).toHaveBeenCalledWith(99);
  });

  it('does not show retry button for retrying (auto-retry in progress) clips', () => {
    const clip = makeClip({
      isExtracted: false,
      isExtracting: false,
      isFailed: false,
      extractionStatus: 'retrying',
    });
    render(<ClipSelectorSidebar {...defaultProps} clips={[clip]} />);
    expect(screen.queryByText('Retry')).toBeNull();
  });
});
