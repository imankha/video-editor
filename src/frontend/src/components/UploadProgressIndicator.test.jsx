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
import { useEditorStore, EDITOR_MODES } from '../stores/editorStore';

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
    // T11870: the manager message is for logs; the user sees one sentence per phase.
    setUpload({ phase: UPLOAD_PHASE.FINALIZING, message: 'Already uploaded - finishing up' });
    render(<UploadProgressIndicator />);
    expect(screen.getByText('Finishing up')).toBeTruthy();
    expect(screen.queryByText('Already uploaded - finishing up')).toBeNull();
    expect(screen.queryByText('Uploading...')).toBeNull();
  });

  it('renders an actionable finalize-failure message with Retry/Dismiss (fix 2)', () => {
    const msg =
      "Couldn't finish saving your video (finalize failed, status 500). " +
      "The bytes uploaded but the final step didn't complete — please try uploading again.";
    setUpload({ phase: UPLOAD_PHASE.ERROR, message: msg });
    render(<UploadProgressIndicator />);
    expect(screen.getByText('Upload stopped.')).toBeTruthy();
    // Actionable phrasing (not the bare "Finalize failed: 500").
    expect(screen.getByText(/finalize failed, status 500/)).toBeTruthy();
    expect(screen.getByText(/please try uploading again/)).toBeTruthy();
    // Error surface offers recovery affordances (T9430: "Retry upload" copy).
    expect(screen.getByText('Retry upload')).toBeTruthy();
    expect(screen.getByText('Dismiss')).toBeTruthy();
  });

  it('T11870: shows exactly one percentage, never the manager phase percent', () => {
    setUpload({ phase: UPLOAD_PHASE.HASHING, progress: 3, message: 'Computing hash... 20%' });
    render(<UploadProgressIndicator />);
    const text = screen.getByTestId('active-upload-row').textContent;
    expect(text.match(/\d+%/g)).toEqual(['3%']);
    expect(text).toContain('Getting your game ready to upload');
    expect(text).toContain('Keep this tab open until it finishes.');
  });

  it('T11870: uploading phase says to keep the tab open and that marking can start', () => {
    setUpload({ phase: UPLOAD_PHASE.UPLOADING, progress: 42, message: 'Uploading... 42%' });
    render(<UploadProgressIndicator />);
    const text = screen.getByTestId('active-upload-row').textContent;
    expect(text.match(/\d+%/g)).toEqual(['42%']);
    expect(text).toContain('Uploading your game');
    expect(text).toContain('You can start marking plays.');
  });
});

describe('UploadProgressIndicator — queue stack (T7360)', () => {
  it('renders one card only when a single upload runs (parity with pre-queue UI)', () => {
    setUpload({ phase: UPLOAD_PHASE.UPLOADING, progress: 30, message: 'Uploading...' });
    render(<UploadProgressIndicator />);
    // T9430: honest state-led label ("Uploading: clip.mp4"), split across nodes.
    const active = screen.getByTestId('active-upload-row');
    expect(active.getAttribute('data-upload-state')).toBe('uploading');
    expect(active.textContent).toContain('Uploading');
    expect(active.textContent).toContain('clip.mp4');
    // No "Queued" row and no Retry/Dismiss when only one healthy upload runs.
    expect(screen.queryByText('Queued')).toBeNull();
    expect(screen.queryByText('Retry upload')).toBeNull();
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
    expect(screen.getByTestId('active-upload-row').textContent).toContain('active.mp4'); // active card
    expect(screen.getByTestId('failed-upload-row').textContent).toContain('failed.mp4'); // failed row
    expect(screen.getByText('Retry upload')).toBeTruthy();         // failed row action
    expect(screen.getByText('waiting.mp4')).toBeTruthy();          // queued row
    expect(screen.getByText('Queued')).toBeTruthy();
    expect(screen.getByText('Cancel')).toBeTruthy();
  });
});

describe('UploadProgressIndicator — placement (T12480)', () => {
  it('sits at the top of the viewport, never bottom-anchored over cards or the feedback button', () => {
    setUpload({ phase: UPLOAD_PHASE.UPLOADING, progress: 15, message: 'Uploading...' });
    const { container } = render(<UploadProgressIndicator />);
    const cls = container.firstChild.className;
    expect(cls).toMatch(/\btop-\d/);
    expect(cls).not.toMatch(/\bbottom-/);
    expect(cls).not.toMatch(/\bright-4\b/);
  });
});

// T14430: on a phone the top-pinned toast sat over the open game's failure banner and its Retry upload.
// The banner already says the upload stopped and offers Retry upload, so the toast drops that game's row
// while Annotate is open on it; every other failed upload (and every other screen) keeps its row.
describe('UploadProgressIndicator — no duplicate failed row over the banner (T14430)', () => {
  const failed = (id, gameId) => ({ id, gameId, fileName: `${id}.mp4`, fileSize: 5 * 1024 * 1024, progress: 20, phase: UPLOAD_PHASE.ERROR, message: 'Part 1 network error', status: UPLOAD_STATUS.ERROR });
  afterEach(() => useEditorStore.setState({ editorMode: EDITOR_MODES.PROJECT_MANAGER, activeAnnotateGameId: null }));

  it('T14430:C1 hides the failed row of the game open in Annotate (its banner offers Retry upload)', () => {
    useEditorStore.setState({ editorMode: EDITOR_MODES.ANNOTATE, activeAnnotateGameId: 7 });
    useUploadStore.setState({ uploads: [failed('open', 7), failed('other', 8)] });
    render(<UploadProgressIndicator />);
    const rows = screen.queryAllByTestId('failed-upload-row').map(r => r.textContent);
    expect(rows.some(t => t.includes('open.mp4'))).toBe(false);
    expect(rows.some(t => t.includes('other.mp4'))).toBe(true);
  });

  it('T14430:C1 keeps the failed row on Home, where no banner shows it', () => {
    useEditorStore.setState({ editorMode: EDITOR_MODES.PROJECT_MANAGER, activeAnnotateGameId: 7 });
    useUploadStore.setState({ uploads: [failed('open', 7)] });
    render(<UploadProgressIndicator />);
    expect(screen.getByTestId('failed-upload-row').textContent).toContain('open.mp4');
  });
});
