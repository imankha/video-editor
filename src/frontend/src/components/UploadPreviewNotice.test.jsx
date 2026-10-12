/**
 * T9430: the local-preview banner tells the truth about the on-screen game's upload.
 * A visible local preview must never read as "saved online" while the upload is in
 * flight; a failure keeps the file+metadata and offers Retry upload.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { UPLOAD_PHASE } from '../services/uploadManager';
import { UPLOAD_STATE } from '../config/displayNames';

const retryUpload = vi.fn();
let currentEntry = null;

vi.mock('../stores/uploadStore', async (importActual) => {
  const actual = await importActual();
  return {
    ...actual,
    useUploadForGame: () => currentEntry,
    useUploadStore: (selector) => selector({ retryUpload }),
  };
});

import { UploadPreviewNotice } from './UploadPreviewNotice';

describe('T9430 UploadPreviewNotice', () => {
  beforeEach(() => {
    retryUpload.mockClear();
    currentEntry = null;
  });

  it('renders nothing when there is no upload for the game', () => {
    const { container } = render(<UploadPreviewNotice gameId={42} />);
    expect(container.firstChild).toBeNull();
  });

  it('labels the local preview as not-saved while uploading', () => {
    currentEntry = { id: 'u1', phase: UPLOAD_PHASE.UPLOADING, progress: 42 };
    render(<UploadPreviewNotice gameId={42} />);
    const notice = screen.getByTestId('upload-preview-notice');
    expect(notice.getAttribute('data-upload-state')).toBe('uploading');
    expect(notice.textContent).toContain(UPLOAD_STATE.NOTICE_UPLOADING);
    // T11870: the bar owns the single percentage; the notice carries none.
    expect(notice.textContent).not.toMatch(/\d+%/);
  });

  it('shows the not-saved label while preparing (before any transfer)', () => {
    currentEntry = { id: 'u1', phase: UPLOAD_PHASE.PREPARING };
    render(<UploadPreviewNotice gameId={42} />);
    const notice = screen.getByTestId('upload-preview-notice');
    expect(notice.getAttribute('data-upload-state')).toBe('preparing');
    expect(notice.textContent).toContain(UPLOAD_STATE.NOTICE_PREPARING);
  });

  it('renders nothing once saved (server ack retires the entry)', () => {
    currentEntry = { id: 'u1', phase: UPLOAD_PHASE.COMPLETE };
    const { container } = render(<UploadPreviewNotice gameId={42} />);
    expect(container.firstChild).toBeNull();
  });

  it('on failure shows Upload failed and offers Retry upload (file+metadata retained)', () => {
    currentEntry = { id: 'u9', phase: UPLOAD_PHASE.ERROR, message: 'Failed to fetch' };
    render(<UploadPreviewNotice gameId={42} />);
    const notice = screen.getByTestId('upload-preview-notice');
    expect(notice.getAttribute('data-upload-state')).toBe('failed');
    expect(notice.textContent).toContain(UPLOAD_STATE.FAILED);

    fireEvent.click(screen.getByRole('button', { name: UPLOAD_STATE.RETRY_UPLOAD }));
    expect(retryUpload).toHaveBeenCalledWith('u9');
  });

  it('T12480: uses plain wording, no internal "Local preview ... Preparing" text', () => {
    currentEntry = { id: 'u1', phase: UPLOAD_PHASE.UPLOADING, progress: 15 };
    render(<UploadPreviewNotice gameId={42} />);
    const text = screen.getByTestId('upload-preview-notice').textContent;
    expect(text).toBe('Uploading your game. Keep this tab open.');
    currentEntry = { id: 'u1', phase: UPLOAD_PHASE.PREPARING };
    cleanup();
    render(<UploadPreviewNotice gameId={42} />);
    expect(screen.getByTestId('upload-preview-notice').textContent).toBe('Getting your game ready. Keep this tab open.');
  });
});
