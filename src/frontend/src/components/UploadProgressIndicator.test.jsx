/**
 * T4100: the upload-pipeline-polish messages must reach the USER-VISIBLE layer.
 * The manager (uploadManager.test.js) proves notify() emits the honest strings;
 * the store (uploadStore.test.js) proves they flow into the entry message;
 * these tests prove UploadProgressIndicator actually RENDERS them to the user.
 *
 * T7360: the indicator now renders the whole queue as a stack. These pin the
 * single-upload parity (one card, unchanged) AND the multi-upload stack.
 */

import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';

import { useUploadStore, UPLOAD_STATUS } from '../stores/uploadStore';
import { UPLOAD_PHASE } from '../services/uploadManager';
import { UploadProgressIndicator } from './UploadProgressIndicator';

const base = { id: 'u1', fileName: 'clip.mp4', fileSize: 5 * 1024 * 1024, progress: 100 };
// Place a single upload; phase ERROR maps to an error entry, otherwise it is active.
const setUpload = (over) => {
  const status = over?.phase === UPLOAD_PHASE.ERROR ? UPLOAD_STATUS.ERROR : UPLOAD_STATUS.UPLOADING;
  useUploadStore.setState({ uploads: [{ ...base, status, ...over }] });
};

afterEach(() => {
  cleanup(); // unmount before clearing store state so no update fires outside act()
  useUploadStore.setState({ uploads: [] });
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

describe('UploadProgressIndicator — queue stack (T7360)', () => {
  it('renders one card only when a single upload runs (parity with pre-queue UI)', () => {
    setUpload({ phase: UPLOAD_PHASE.UPLOADING, progress: 30, message: 'Uploading...' });
    render(<UploadProgressIndicator />);
    expect(screen.getByText('Uploading clip.mp4')).toBeTruthy();
    // No "Queued" row and no Retry/Dismiss when only one healthy upload runs.
    expect(screen.queryByText('Queued')).toBeNull();
    expect(screen.queryByText('Retry')).toBeNull();
  });

  it('stacks the active upload, a failed upload, and a queued upload together', () => {
    useUploadStore.setState({
      uploads: [
        { id: 'a', fileName: 'active.mp4', fileSize: 5 * 1024 * 1024, progress: 40, phase: UPLOAD_PHASE.UPLOADING, message: 'Uploading...', status: UPLOAD_STATUS.UPLOADING },
        { id: 'b', fileName: 'failed.mp4', fileSize: 5 * 1024 * 1024, progress: 0, phase: UPLOAD_PHASE.ERROR, message: 'Upload failed', status: UPLOAD_STATUS.ERROR },
        { id: 'c', fileName: 'waiting.mp4', fileSize: 5 * 1024 * 1024, progress: 0, phase: UPLOAD_PHASE.HASHING, message: 'Queued', status: UPLOAD_STATUS.QUEUED },
      ],
    });
    render(<UploadProgressIndicator />);
    expect(screen.getByText('Uploading active.mp4')).toBeTruthy(); // active card
    expect(screen.getByText('Retry')).toBeTruthy();                // failed row
    expect(screen.getByText('waiting.mp4')).toBeTruthy();          // queued row
    expect(screen.getByText('Queued')).toBeTruthy();
    expect(screen.getByText('Cancel')).toBeTruthy();
  });
});
