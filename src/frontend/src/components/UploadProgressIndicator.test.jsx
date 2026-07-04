/**
 * T4100: the upload-pipeline-polish messages must reach the USER-VISIBLE layer.
 * The manager (uploadManager.test.js) proves notify() emits the honest strings;
 * the store (uploadStore.test.js) proves they flow into activeUpload.message;
 * these tests prove UploadProgressIndicator actually RENDERS them to the user.
 */

import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';

import { useUploadStore } from '../stores/uploadStore';
import { UPLOAD_PHASE } from '../services/uploadManager';
import { UploadProgressIndicator } from './UploadProgressIndicator';

const base = { id: 'u1', fileName: 'clip.mp4', fileSize: 5 * 1024 * 1024, progress: 100 };
const setUpload = (over) => useUploadStore.setState({ activeUpload: { ...base, ...over } });

afterEach(() => {
  cleanup(); // unmount before clearing store state so no update fires outside act()
  useUploadStore.setState({ activeUpload: null });
});

describe('UploadProgressIndicator — user-visible T4100 messages', () => {
  it('renders the honest dedup message (fix 3), not a blanket "Uploading..."', () => {
    // The dedup path emits FINALIZING(100, "Already uploaded - finishing up").
    setUpload({ phase: UPLOAD_PHASE.FINALIZING, message: 'Already uploaded - finishing up' });
    render(<UploadProgressIndicator />);
    expect(screen.getByText('Already uploaded - finishing up')).toBeTruthy();
    // The old blanket placeholder must NOT be what the user sees here.
    expect(screen.queryByText('Uploading...')).toBeNull();
  });

  it('renders an actionable finalize-failure message with Retry/Dismiss (fix 2)', () => {
    const msg =
      "Couldn't finish saving your video (finalize failed, status 500). " +
      "The bytes uploaded but the final step didn't complete — please try uploading again.";
    setUpload({ phase: UPLOAD_PHASE.ERROR, message: msg });
    render(<UploadProgressIndicator />);
    // Actionable phrasing (not the bare "Finalize failed: 500").
    expect(screen.getByText(/finalize failed, status 500/)).toBeTruthy();
    expect(screen.getByText(/please try uploading again/)).toBeTruthy();
    // Error surface offers recovery affordances.
    expect(screen.getByText('Retry')).toBeTruthy();
    expect(screen.getByText('Dismiss')).toBeTruthy();
  });

  it('surfaces a manager-provided phase message verbatim (honest phase messaging)', () => {
    setUpload({ phase: UPLOAD_PHASE.UPLOADING, progress: 42, message: 'Uploading... 42%' });
    render(<UploadProgressIndicator />);
    expect(screen.getByText('Uploading... 42%')).toBeTruthy();
  });

  it('falls back to "Uploading..." only when no message is present', () => {
    setUpload({ phase: UPLOAD_PHASE.UPLOADING, progress: 10, message: undefined });
    render(<UploadProgressIndicator />);
    expect(screen.getByText('Uploading...')).toBeTruthy();
  });
});
