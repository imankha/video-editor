/**
 * T7360: the store holds a QUEUE of uploads (was a singular activeUpload).
 *
 * Contract pinned here:
 *   - starting a 2nd upload while one runs is ACCEPTED (queued), never dropped
 *   - the queue is serial-one-active: completion/failure/cancel auto-advances it
 *   - a failed upload stays visible with its own retry and does NOT block the queue
 *   - per-entry completion callbacks fire BEFORE the entry is retired (T1540 race)
 *   - a duplicate drop (same name+size) is rejected VISIBLY (toast.info), not silently
 *   - ids are collision-free even for two drops in the same millisecond
 *
 * Also preserves the bug26p (failure surfacing) and T4100 (honest message) contracts,
 * adapted to the per-entry shape.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the upload orchestration so we control success/failure, but keep the real
// UPLOAD_PHASE constants.
vi.mock('../services/uploadManager', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, uploadGame: vi.fn(), uploadMultiVideoGame: vi.fn() };
});
vi.mock('../components/shared', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('./questStore', () => ({
  useQuestStore: { getState: () => ({ fetchProgress: vi.fn() }) },
}));
vi.mock('./creditStore', () => ({
  useCreditStore: { getState: () => ({ fetchCredits: vi.fn() }) },
}));
// T7820: the local thumbnail capture is fire-and-forget at enqueue; default to the
// "capture failed" null so unrelated tests are unaffected.
vi.mock('../utils/captureVideoFrame', () => ({
  captureVideoFrame: vi.fn(() => Promise.resolve(null)),
}));

import { useUploadStore, UPLOAD_STATUS } from './uploadStore';
import { captureVideoFrame } from '../utils/captureVideoFrame';
import { uploadGame, UPLOAD_PHASE } from '../services/uploadManager';
import { toast } from '../components/shared';

// A file of an exact byte size so name+size identity is controllable.
const mkFile = (name, sizeBytes = 4) =>
  new File([new Uint8Array(sizeBytes)], name, { type: 'video/mp4' });

// A promise we can settle from the test to hold an upload "in flight".
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

const store = () => useUploadStore.getState();
const uploads = () => store().uploads;
const byName = (name) => uploads().find(u => u.fileName === name);
const activeEntry = () => uploads().find(u => u.status === UPLOAD_STATUS.UPLOADING);

const startFile = (name, size = 4, onComplete = null) =>
  store().startUpload(
    mkFile(name, size),
    { opponentName: 'Rivals' },
    { duration: 1, width: 2, height: 2 },
    onComplete,
    { gameName: name },
    null,
  );

describe('uploadStore — queue mechanics (T7360)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store().reset();
  });

  it('accepts a 2nd upload while one runs: first uploading, second queued, distinct ids', () => {
    uploadGame.mockReturnValueOnce(deferred().promise); // first stays in flight
    const id1 = startFile('a.mp4');
    const id2 = startFile('b.mp4');

    expect(id1).toBeTruthy();
    expect(id2).toBeTruthy();
    expect(id1).not.toBe(id2);
    expect(uploads()).toHaveLength(2);
    expect(byName('a.mp4').status).toBe(UPLOAD_STATUS.UPLOADING);
    expect(byName('b.mp4').status).toBe(UPLOAD_STATUS.QUEUED);
    // The queued upload has NOT been handed to the manager yet.
    expect(uploadGame).toHaveBeenCalledTimes(1);
  });

  it('auto-advances the queue (FIFO) when the active upload completes', async () => {
    const d1 = deferred();
    uploadGame.mockReturnValueOnce(d1.promise);
    startFile('a.mp4');
    uploadGame.mockReturnValueOnce(deferred().promise); // b will run when promoted
    startFile('b.mp4');

    d1.resolve({ game_id: 1, name: 'a', status: 'created' });

    await vi.waitFor(() => expect(byName('b.mp4')?.status).toBe(UPLOAD_STATUS.UPLOADING));
    // Completed entry retired; only the promoted one remains.
    expect(byName('a.mp4')).toBeUndefined();
    expect(uploadGame).toHaveBeenCalledTimes(2);
  });

  it('isolates a failure: failed entry stays as error AND the next queued promotes', async () => {
    const d1 = deferred();
    uploadGame.mockReturnValueOnce(d1.promise);
    startFile('a.mp4');
    uploadGame.mockReturnValueOnce(deferred().promise);
    startFile('b.mp4');

    d1.reject(new Error('R2 exploded'));

    await vi.waitFor(() => expect(byName('a.mp4')?.status).toBe(UPLOAD_STATUS.ERROR));
    expect(byName('b.mp4').status).toBe(UPLOAD_STATUS.UPLOADING); // not blocked behind the failure
    expect(toast.error).toHaveBeenCalledTimes(1);
    // The failed entry retains its retry context (holds the File handle).
    expect(byName('a.mp4').retryContext).not.toBeNull();
  });

  it('retryUpload(id) re-runs THAT errored entry through the one queue engine', async () => {
    const d1 = deferred();
    uploadGame.mockReturnValueOnce(d1.promise);
    const id = startFile('a.mp4');
    d1.reject(new Error('transient'));
    await vi.waitFor(() => expect(byName('a.mp4')?.status).toBe(UPLOAD_STATUS.ERROR));

    uploadGame.mockResolvedValueOnce({ game_id: 8, name: 'a', status: 'created' });
    store().retryUpload(id);

    await vi.waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(uploadGame).toHaveBeenCalledTimes(2); // original + retry
    expect(uploads()).toHaveLength(0); // succeeded, retired
  });

  it('fires a per-entry completion callback BEFORE the entry is retired (T1540 race)', async () => {
    const d1 = deferred();
    uploadGame.mockReturnValueOnce(d1.promise);
    let statusAtCallback;
    let id;
    id = startFile('a.mp4', 4, () => {
      statusAtCallback = uploads().find(u => u.id === id)?.status;
    });

    d1.resolve({ game_id: 1, name: 'a' });

    await vi.waitFor(() => expect(statusAtCallback).toBeDefined());
    // Entry still present + uploading when the callback ran (retire happens after).
    expect(statusAtCallback).toBe(UPLOAD_STATUS.UPLOADING);
    expect(uploads()).toHaveLength(0); // then retired
    expect(store().isUploading()).toBe(false);
  });

  it('rejects a duplicate drop (same name+size) VISIBLY and returns the existing id', () => {
    uploadGame.mockReturnValueOnce(deferred().promise);
    const id1 = startFile('game.mp4', 100);
    const id2 = startFile('game.mp4', 100); // same identity

    expect(id2).toBe(id1); // caller gets the existing entry's id
    expect(uploads()).toHaveLength(1); // no second entry
    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(toast.info.mock.calls[0][0]).toMatch(/already queued/i);
    // A DIFFERENT file (different size) is not a duplicate.
    const id3 = startFile('game.mp4', 101);
    expect(id3).not.toBe(id1);
    expect(uploads()).toHaveLength(2);
  });

  it('generates collision-free ids even for two drops in the same millisecond', () => {
    const spy = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    uploadGame.mockReturnValue(deferred().promise);
    const id1 = startFile('x.mp4', 1);
    const id2 = startFile('y.mp4', 2);
    expect(id1).not.toBe(id2);
    spy.mockRestore();
  });

  it('cancelUpload(id): cancelling the active entry promotes the next; cancelling a queued entry leaves the active running', () => {
    // Cancel the ACTIVE entry -> next promotes.
    uploadGame.mockReturnValueOnce(deferred().promise);
    const idA = startFile('a.mp4', 1);
    uploadGame.mockReturnValueOnce(deferred().promise);
    startFile('b.mp4', 2);
    store().cancelUpload(idA);
    expect(byName('a.mp4')).toBeUndefined();
    expect(byName('b.mp4').status).toBe(UPLOAD_STATUS.UPLOADING);
    expect(uploadGame).toHaveBeenCalledTimes(2);

    // Now cancel a QUEUED entry -> active untouched.
    const idC = startFile('c.mp4', 3); // queued behind active b
    expect(byName('c.mp4').status).toBe(UPLOAD_STATUS.QUEUED);
    store().cancelUpload(idC);
    expect(byName('c.mp4')).toBeUndefined();
    expect(byName('b.mp4').status).toBe(UPLOAD_STATUS.UPLOADING);
    expect(uploadGame).toHaveBeenCalledTimes(2); // no new upload started
  });

  it('threads onGameCreated into the active entry gameId', async () => {
    uploadGame.mockImplementationOnce((_file, _onProgress, options) => {
      options.onGameCreated({ game_id: 42, name: 'server-name' });
      return deferred().promise; // stays in flight
    });
    const id = startFile('a.mp4');
    await vi.waitFor(() => expect(uploads().find(u => u.id === id)?.gameId).toBe(42));
    expect(activeEntry().gameId).toBe(42);
  });
});

describe('uploadStore — failure surfacing (bug26p, per-entry)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store().reset();
  });

  it('fires toast.error and keeps the errored entry with a Retry context on failure', async () => {
    uploadGame.mockRejectedValueOnce(new Error('R2 exploded'));
    startFile('a.mp4');

    await vi.waitFor(() => expect(byName('a.mp4')?.phase).toBe(UPLOAD_PHASE.ERROR));
    expect(byName('a.mp4').status).toBe(UPLOAD_STATUS.ERROR);
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error.mock.calls[0][0]).toMatch(/upload failed/i);
    expect(byName('a.mp4').retryContext).not.toBeNull();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('still fires toast.success and retires the entry on a successful upload', async () => {
    uploadGame.mockResolvedValueOnce({ game_id: 7, name: 'a', status: 'created' });
    startFile('a.mp4');

    await vi.waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(uploads()).toHaveLength(0);
    expect(toast.error).not.toHaveBeenCalled();
  });

  // T8340: dedup — the backend returned an EXISTING game (already_owned), so Annotate
  // opened the OLD game. The completion toast must NOT announce a fresh "Game ready!"
  // upload; it must honestly say the game was already in the library.
  it('announces dedup honestly (no "Game ready!") when the upload was already_owned', async () => {
    uploadGame.mockResolvedValueOnce({
      game_id: 42, name: 'a', status: 'already_owned', deduplicated: true,
    });
    startFile('a.mp4');

    await vi.waitFor(() => expect(toast.info).toHaveBeenCalledTimes(1));
    expect(toast.success).not.toHaveBeenCalled();
    const [title, opts] = toast.info.mock.calls[0];
    expect(title).toBe('Already in your library');
    expect(opts.message).toMatch(/already in your account/i);
    expect(uploads()).toHaveLength(0);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('uses the credits modal (no toast, no lingering entry) on insufficient credits', async () => {
    const err = new Error('Insufficient credits');
    err.insufficientCredits = true;
    err.uploadCost = 5;
    err.balance = 2;
    uploadGame.mockRejectedValueOnce(err);
    startFile('a.mp4');

    await vi.waitFor(() => expect(store().insufficientCredits).not.toBeNull());
    expect(store().insufficientCredits).toEqual({ required: 5, balance: 2 });
    expect(toast.error).not.toHaveBeenCalled();
    expect(uploads()).toHaveLength(0); // entry retired, queue can advance
  });
});

// T7820: local preview frame for the uploading game tile — memory-only, fire-and-forget.
describe('uploadStore — preview frame (T7820)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store().reset();
  });

  it('captures a preview frame at enqueue without blocking the upload start', async () => {
    captureVideoFrame.mockResolvedValueOnce('data:image/jpeg;base64,FRAME');
    uploadGame.mockReturnValueOnce(deferred().promise);
    const id = startFile('a.mp4');

    // Enqueue returns immediately with previewFrame still null (fire-and-forget).
    expect(uploads().find(u => u.id === id).previewFrame).toBeNull();
    expect(captureVideoFrame).toHaveBeenCalledTimes(1);

    await vi.waitFor(() =>
      expect(uploads().find(u => u.id === id).previewFrame).toBe('data:image/jpeg;base64,FRAME'),
    );
  });

  it('a failed capture (null) leaves previewFrame null — the tile falls back to branded art', async () => {
    captureVideoFrame.mockResolvedValueOnce(null);
    uploadGame.mockReturnValueOnce(deferred().promise);
    const id = startFile('a.mp4');

    // Give the microtask chain a beat; the entry must still be null, never a fixup.
    await new Promise((r) => setTimeout(r, 0));
    expect(uploads().find(u => u.id === id).previewFrame).toBeNull();
  });

  it('a late-resolving capture for a retired (cancelled) entry is a silent no-op', async () => {
    let resolveCapture;
    captureVideoFrame.mockReturnValueOnce(new Promise((r) => { resolveCapture = r; }));
    uploadGame.mockReturnValueOnce(deferred().promise);
    const id = startFile('a.mp4');
    store().cancelUpload(id);
    expect(uploads()).toHaveLength(0);

    resolveCapture('data:image/jpeg;base64,LATE');
    await new Promise((r) => setTimeout(r, 0));
    expect(uploads()).toHaveLength(0); // nothing resurrected, nothing thrown
  });
});

// T4100: the honest message the manager emits must reach the entry's message.
describe('uploadStore — honest progress message passthrough (T4100)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store().reset();
  });

  it('forwards the manager message into the active entry message', async () => {
    uploadGame.mockImplementationOnce((_file, onProgress) => {
      onProgress({ phase: UPLOAD_PHASE.FINALIZING, percent: 100, message: 'Already uploaded - finishing up' });
      return new Promise(() => {}); // never resolves
    });
    startFile('a.mp4');

    await vi.waitFor(() =>
      expect(activeEntry()?.message).toBe('Already uploaded - finishing up'),
    );
    expect(activeEntry()?.message).not.toBe('Uploading...');
  });

  it('falls back to "Uploading..." only when the manager omits a message', async () => {
    uploadGame.mockImplementationOnce((_file, onProgress) => {
      onProgress({ phase: UPLOAD_PHASE.UPLOADING, percent: 20 }); // no message
      return new Promise(() => {});
    });
    startFile('a.mp4');

    await vi.waitFor(() => expect(activeEntry()?.phase).toBe(UPLOAD_PHASE.UPLOADING));
    expect(activeEntry()?.message).toBe('Uploading...');
  });
});
