/**
 * T7820: UploadingGameTile — an in-flight upload rendered as a real game tile.
 *
 * Contract pinned here (approved design):
 *   - UPLOADING: green chip + live % + green (GAME.progressBar) bottom-edge bar at
 *     the live width; locally-captured thumbnail <img> when previewFrame exists;
 *     tile click keeps the annotate-during-upload navigation
 *   - QUEUED: dimmed media, chip "Queued", NO bar fill; still cancellable
 *   - RESUME (server pending_uploads session): yellow chip + yellow-600 bar FROZEN
 *     at progress_percent; ALWAYS the branded fallback (the File handle died with
 *     the page — no fake thumbnail); tile click = onResume
 *   - FAILED: mirrors the T7490 upload_failed skin (rose chip "Upload incomplete",
 *     Retry / two-tap Discard bar, rose bar frozen at the failure point); tile
 *     itself is inert
 *   - X cancel uses the double-tap confirm pattern
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mutable profile state so tests can vary the fallback sport (same harness shape
// as GameTile.test.jsx).
const h = vi.hoisted(() => ({
  profiles: [{ id: 'p1', name: 'Fall Soccer', sport: 'soccer', isCurrent: true }],
  currentProfileId: 'p1',
}));

vi.mock('../../stores', () => ({
  useProfileStore: (sel) => sel({ profiles: h.profiles, currentProfileId: h.currentProfileId }),
}));

import { UploadingGameTile } from '../UploadingGameTile';
import { UPLOAD_STATUS } from '../../stores/uploadStore';
import { UPLOAD_PHASE } from '../../services/uploadManager';
import { GAME } from '../../config/themeColors';

const mkUpload = (over = {}) => ({
  id: 'upl_1',
  status: UPLOAD_STATUS.UPLOADING,
  fileName: 'game.mp4',
  gameName: 'vs Rivals',
  progress: 55,
  phase: UPLOAD_PHASE.UPLOADING,
  message: 'Uploading...',
  startedAt: new Date().toISOString(),
  previewFrame: null,
  ...over,
});

const mkSession = (over = {}) => ({
  session_id: 'sess_1',
  original_filename: 'paused.mp4',
  completed_parts: 5,
  total_parts: 8,
  progress_percent: 62,
  file_size: 1000,
  created_at: new Date().toISOString(),
  ...over,
});

const tile = () => screen.getByTestId('uploading-game-tile');
const barFill = () => screen.queryByTestId('upload-tile-bar-fill');

beforeEach(() => {
  h.profiles = [{ id: 'p1', name: 'Fall Soccer', sport: 'soccer', isCurrent: true }];
  h.currentProfileId = 'p1';
});

describe('UploadingGameTile — UPLOADING (green)', () => {
  it('renders the green bottom-edge bar at the live width with chip + %', () => {
    render(<UploadingGameTile upload={mkUpload()} onClick={vi.fn()} onCancel={vi.fn()} />);

    expect(tile().dataset.tileState).toBe('uploading');
    expect(screen.getByText('Uploading')).toBeTruthy(); // chip
    expect(screen.getByText('55%')).toBeTruthy();       // meta line %
    expect(barFill().className).toContain(GAME.progressBar); // bg-green-600, same as the old bar
    expect(barFill().style.width).toBe('55%');
  });

  it('shows the locally-captured thumbnail when previewFrame exists, fallback otherwise', () => {
    const { unmount } = render(
      <UploadingGameTile upload={mkUpload({ previewFrame: 'data:image/jpeg;base64,FRAME' })} />,
    );
    const img = screen.getByTestId('upload-tile-thumb');
    expect(img.getAttribute('src')).toBe('data:image/jpeg;base64,FRAME');
    expect(screen.queryByTestId('upload-tile-fallback')).toBeNull();
    unmount();

    // No frame -> branded sport-ball fallback (current profile = soccer).
    render(<UploadingGameTile upload={mkUpload()} />);
    expect(screen.queryByTestId('upload-tile-thumb')).toBeNull();
    expect(screen.getByTestId('upload-tile-fallback')).toBeTruthy();
    expect(screen.getByText('⚽')).toBeTruthy();
  });

  it('derives an ETA from startedAt + progress in the meta line', () => {
    // 60s elapsed at 50% -> ~60s remaining -> "~1m left".
    render(<UploadingGameTile
      upload={mkUpload({ progress: 50, startedAt: new Date(Date.now() - 60_000).toISOString() })}
    />);
    expect(screen.getByText('~1m left')).toBeTruthy();
  });

  it('finalizing shows an indeterminate shimmer at full width', () => {
    render(<UploadingGameTile upload={mkUpload({ progress: 98, phase: UPLOAD_PHASE.FINALIZING })} />);
    expect(barFill().className).toContain('animate-pulse');
    expect(barFill().style.width).toBe('100%');
    expect(screen.getByText('Processing...')).toBeTruthy();
  });

  it('tile click keeps the annotate-during-upload navigation (T1540)', () => {
    const onClick = vi.fn();
    render(<UploadingGameTile upload={mkUpload()} onClick={onClick} onCancel={vi.fn()} />);
    fireEvent.click(tile());
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('X cancel requires a second confirming tap', () => {
    const onCancel = vi.fn();
    render(<UploadingGameTile upload={mkUpload()} onClick={vi.fn()} onCancel={onCancel} />);

    const x = screen.getByRole('button', { name: /cancel upload of/i });
    fireEvent.click(x);
    expect(onCancel).not.toHaveBeenCalled(); // first tap arms
    fireEvent.click(screen.getByRole('button', { name: /confirm cancel of/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('UploadingGameTile — QUEUED (dimmed, no fill)', () => {
  it('dims the media, shows the Queued chip, and renders NO bar fill', () => {
    render(<UploadingGameTile upload={mkUpload({ status: UPLOAD_STATUS.QUEUED, progress: 0 })} onCancel={vi.fn()} />);

    expect(tile().dataset.tileState).toBe('queued');
    expect(screen.getAllByText('Queued').length).toBeGreaterThan(0); // chip + meta
    expect(screen.getByTestId('upload-tile-fallback').className).toContain('opacity-50');
    expect(screen.getByTestId('upload-tile-bar')).toBeTruthy(); // empty track only
    expect(barFill()).toBeNull();
  });
});

describe('UploadingGameTile — RESUME (yellow, server session)', () => {
  it('renders the yellow bar frozen at progress_percent with the Resume chip', () => {
    render(<UploadingGameTile session={mkSession()} onResume={vi.fn()} onCancel={vi.fn()} />);

    expect(tile().dataset.tileState).toBe('resume');
    expect(screen.getByText('Resume')).toBeTruthy(); // chip
    expect(screen.getByText('5 / 8 parts')).toBeTruthy();
    expect(barFill().className).toContain('bg-yellow-600'); // same as the old PendingUploadCard bar
    expect(barFill().style.width).toBe('62%');
  });

  it('NEVER shows a thumbnail (File handle lost on reload) — branded fallback only', () => {
    render(<UploadingGameTile session={mkSession()} onResume={vi.fn()} />);
    expect(screen.queryByTestId('upload-tile-thumb')).toBeNull();
    expect(screen.getByTestId('upload-tile-fallback')).toBeTruthy();
    expect(screen.getByText('⚽')).toBeTruthy();
  });

  it('tile click reopens the picker (onResume), not the annotate navigation', () => {
    const onResume = vi.fn();
    const onClick = vi.fn();
    render(<UploadingGameTile session={mkSession()} onResume={onResume} onClick={onClick} />);
    fireEvent.click(tile());
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('UploadingGameTile — FAILED (rose, T7490 skin)', () => {
  const failed = () => mkUpload({ status: UPLOAD_STATUS.ERROR, phase: UPLOAD_PHASE.ERROR, progress: 30, message: 'Upload failed' });

  it('mirrors the upload_failed tile skin: rose chip, frozen rose bar, Retry/Discard', () => {
    render(<UploadingGameTile upload={failed()} onRetry={vi.fn()} onDiscard={vi.fn()} />);

    expect(tile().dataset.tileState).toBe('failed');
    expect(screen.getByText('Upload incomplete')).toBeTruthy(); // same chip copy as T7490
    expect(barFill().className).toContain('bg-rose-600');
    expect(barFill().style.width).toBe('30%'); // frozen at the failure point
    expect(screen.getByRole('button', { name: /retry upload of/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /discard/i })).toBeTruthy();
  });

  it('Retry fires immediately; Discard needs a second confirming tap; the tile is inert', () => {
    const onRetry = vi.fn();
    const onDiscard = vi.fn();
    const onClick = vi.fn();
    render(<UploadingGameTile upload={failed()} onRetry={onRetry} onDiscard={onDiscard} onClick={onClick} />);

    fireEvent.click(tile());
    expect(onClick).not.toHaveBeenCalled(); // inert like the T7490 tile

    fireEvent.click(screen.getByRole('button', { name: /retry upload of/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /^discard/i }));
    expect(onDiscard).not.toHaveBeenCalled(); // first tap escalates
    fireEvent.click(screen.getByRole('button', { name: /confirm discard/i }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it('has no X cancel (Retry/Discard own the failed state, like T7490)', () => {
    render(<UploadingGameTile upload={failed()} onRetry={vi.fn()} onDiscard={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /cancel upload of/i })).toBeNull();
  });
});
