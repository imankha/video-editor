import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import ExportButtonView from './ExportButtonView';

const baseProps = {
  isCurrentlyExporting: false, isExporting: false, isExternallyExporting: false,
  displayProgress: 0, displayMessage: '', error: null, failedExport: null,
  disconnected: false, reconnectionFailed: false, retrying: false, isFramingMode: true,
  hasUnframedClips: false, isButtonDisabled: false, buttonTitle: undefined,
  includeAudio: true, onIncludeAudioChange: vi.fn(), onExport: vi.fn(),
};

describe('T14530: ExportButtonView failure copy', () => {
  afterEach(cleanup);

  it('T14530:C4 a failed export never prints the raw server error', () => {
    render(<ExportButtonView {...baseProps}
      failedExport={{ error: 'Generation failed: CUDA out of memory in worker 3' }} />);
    expect(screen.queryByText(/CUDA/)).toBeNull();
    expect(screen.getByText(/We couldn't sharpen your highlight/)).toBeTruthy();
  });

  it('T14530:C4 a retryable failure tells the parent the highlight did not save', () => {
    render(<ExportButtonView {...baseProps}
      failedExport={{ error: 'sync_failed', retryable: true }} />);
    expect(screen.getByText(/We couldn't save your highlight/)).toBeTruthy();
  });

  it('T14530:C4 the disconnected state does not describe polling', () => {
    render(<ExportButtonView {...baseProps} disconnected />);
    expect(screen.queryByText(/polling|server/i)).toBeNull();
  });
});
