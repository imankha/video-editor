import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// T15780: a game file over the server's game-upload cap (mirrored via
// configStore.maxGameUploadBytes, set from /api/bootstrap) must never enter the
// hash/upload pipeline -- refused in the picker before addFiles runs, with a
// beacon recording the refusal (reason size_over_cap) and copy naming the limit
// and a next step. Mirrors the T10250 clip-cap pre-flight pattern.

const { addFilesMock } = vi.hoisted(() => ({ addFilesMock: vi.fn() }));

vi.mock('../hooks/useFootageIntake', () => ({
  useFootageIntake: () => ({
    status: 'empty', items: [], order: [], confidence: 'unknown', gaps: [],
    placement: 'sequence', lanes: [], question: null, skipped: [], proxies: {},
    addFiles: addFilesMock, removeItem: vi.fn(), setManualOrder: vi.fn(), setPlacementMode: vi.fn(),
  }),
}));
vi.mock('./shared', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }));

const { beaconMock } = vi.hoisted(() => ({ beaconMock: vi.fn() }));
vi.mock('../services/uploadManager', () => ({
  UPLOAD_KIND: { GAME: 'game', CLIP: 'clip' },
  sendUploadFailureBeacon: beaconMock,
}));

import { GameFootagePicker } from './GameFootagePicker';
import { useConfigStore } from '../stores/configStore';

const TEN_GB = 10 * 1024 * 1024 * 1024;

function bigFile(name, size) {
  const file = new File(['x'], name, { type: 'video/mp4' });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

beforeEach(() => {
  addFilesMock.mockReset().mockResolvedValue({ duplicates: [] });
  beaconMock.mockReset();
  useConfigStore.setState({ maxGameUploadBytes: TEN_GB });
});

describe('T15780 oversize pre-flight', () => {
  it('refuses an over-cap file before addFiles, beacons size_over_cap with no hash, and shows the limit + next step', async () => {
    render(<GameFootagePicker onFootageChange={vi.fn()} />);
    const file = bigFile('DJI_huge.mp4', 11 * 1024 * 1024 * 1024);

    fireEvent.change(screen.getByTestId('footage-file-input'), { target: { files: [file] } });

    await waitFor(() => expect(beaconMock).toHaveBeenCalledTimes(1));
    expect(addFilesMock).not.toHaveBeenCalled();

    const beaconPayload = beaconMock.mock.calls[0][0];
    expect(beaconPayload.reason).toBe('size_over_cap');
    expect(beaconPayload.phase).toBe('preparing');
    expect(beaconPayload.kind).toBe('game');
    expect(beaconPayload.file_size).toBe(11 * 1024 * 1024 * 1024);
    expect(beaconPayload).not.toHaveProperty('blake3_hash');

    const note = screen.getByTestId('footage-oversize-error');
    expect(note.textContent).toContain('10GB');
    expect(note.textContent).toMatch(/Trim|split/);
  });

  it('lets an under-cap file through to addFiles with no beacon', async () => {
    render(<GameFootagePicker onFootageChange={vi.fn()} />);
    const file = bigFile('normal.mp4', 5 * 1024 * 1024);

    fireEvent.change(screen.getByTestId('footage-file-input'), { target: { files: [file] } });

    await waitFor(() => expect(addFilesMock).toHaveBeenCalledTimes(1));
    expect(beaconMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('footage-oversize-error')).toBeNull();
  });

  it('skips the gate while the cap is unknown (bootstrap unresolved), letting the server be the fallback authority', async () => {
    useConfigStore.setState({ maxGameUploadBytes: null });
    render(<GameFootagePicker onFootageChange={vi.fn()} />);
    const file = bigFile('DJI_huge.mp4', 11 * 1024 * 1024 * 1024);

    fireEvent.change(screen.getByTestId('footage-file-input'), { target: { files: [file] } });

    await waitFor(() => expect(addFilesMock).toHaveBeenCalledTimes(1));
    expect(beaconMock).not.toHaveBeenCalled();
  });
});
