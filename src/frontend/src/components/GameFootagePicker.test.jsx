import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// T8810 — GameFootagePicker: one universal dropzone (single file, many files, or a
// folder) driven by useFootageIntake. These tests mock the hook so we can pin each
// of the three visual states, the zero-accepted error, the T7890 beacon (once per
// accepted selection from EVERY path), the emitted payload shape, and folder
// drag-drop via a mocked webkitGetAsEntry() directory tree.

const { intake, addFilesMock, removeItemMock, setManualOrderMock, toastInfo } = vi.hoisted(() => ({
  intake: {
    current: {
      status: 'empty',
      items: [],
      order: [],
      confidence: 'unknown',
      gaps: [],
      skipped: [],
      proxies: {},
    },
  },
  addFilesMock: vi.fn(),
  removeItemMock: vi.fn(),
  setManualOrderMock: vi.fn(),
  toastInfo: vi.fn(),
}));

vi.mock('../hooks/useFootageIntake', () => ({
  useFootageIntake: () => ({
    ...intake.current,
    addFiles: addFilesMock,
    removeItem: removeItemMock,
    setManualOrder: setManualOrderMock,
  }),
}));

vi.mock('./shared', () => ({
  toast: { info: toastInfo, success: vi.fn(), error: vi.fn() },
}));

import { GameFootagePicker } from './GameFootagePicker';

function setIntake(partial) {
  intake.current = { ...intake.current, ...partial };
}

function makeItem(name, size = 1024) {
  return { name, size, duration: 60, creationTime: null, file: new File(['x'], name, { type: 'video/mp4' }) };
}

beforeEach(() => {
  addFilesMock.mockReset().mockResolvedValue({ duplicates: [] });
  removeItemMock.mockReset();
  setManualOrderMock.mockReset();
  toastInfo.mockReset();
  setIntake({ status: 'empty', items: [], order: [], confidence: 'unknown', gaps: [], skipped: [], proxies: {} });
});

describe('GameFootagePicker — states', () => {
  it('empty: renders the approved heading, folder link, and both hidden inputs', () => {
    render(<GameFootagePicker onFootageChange={vi.fn()} />);
    expect(screen.getByText('Drop your whole game here')).toBeTruthy();
    expect(screen.getByTestId('footage-folder-link').textContent).toBe('or add a whole folder');
    expect(screen.getByTestId('footage-file-input')).toBeTruthy();
    expect(screen.getByTestId('footage-folder-input')).toBeTruthy();
    // main input allows multi-select; folder input is a directory picker
    expect(screen.getByTestId('footage-file-input').hasAttribute('multiple')).toBe(true);
    expect(screen.getByTestId('footage-folder-input').hasAttribute('webkitdirectory')).toBe(true);
  });

  it('checking: renders "Checking your videos..." with one skeleton chip per accepted file', () => {
    setIntake({ status: 'checking', items: [makeItem('a.mp4'), makeItem('b.mp4'), makeItem('c.mp4')] });
    render(<GameFootagePicker onFootageChange={vi.fn()} />);
    expect(screen.getByText('Checking your videos...')).toBeTruthy();
    expect(screen.getAllByTestId('footage-skeleton-chip')).toHaveLength(3);
  });

  it('ready single: shows today\'s green filename + size chip (byte-for-byte look)', () => {
    const item = makeItem('game.mp4', 5 * 1024 * 1024);
    setIntake({ status: 'ready', items: [item], order: [item] });
    render(<GameFootagePicker onFootageChange={vi.fn()} />);
    expect(screen.getByTestId('footage-picker-ready-single')).toBeTruthy();
    const name = screen.getByText('game.mp4');
    expect(name.className).toContain('text-green-400');
    expect(screen.getByText('5.0 MB')).toBeTruthy();
  });

  it('ready multi: mounts the FootageStrip (real confirm strip, not the old placeholder)', () => {
    const order = [makeItem('DJI_0003.MP4'), makeItem('DJI_0004.MP4'), makeItem('DJI_0005.MP4')];
    setIntake({ status: 'ready', items: order, order, confidence: 'time', skipped: ['clip.THM'] });
    render(<GameFootagePicker onFootageChange={vi.fn()} />);
    expect(screen.getByTestId('footage-picker-ready-multi')).toBeTruthy();
    expect(screen.getByTestId('footage-strip')).toBeTruthy();
    expect(screen.getAllByTestId('footage-chip')).toHaveLength(3);
    // The T8810 placeholder list is gone.
    expect(screen.queryByTestId('footage-order-list')).toBeNull();
    // Skipped junk now lives in the strip's gray disclosure.
    expect(screen.getByTestId('footage-skipped').textContent).toContain('Skipped 1 extra camera file');
  });

  it('ready multi with confident order does NOT auto-open the reorder editor', () => {
    const order = [makeItem('DJI_0003.MP4'), makeItem('DJI_0004.MP4')];
    setIntake({ status: 'ready', items: order, order, confidence: 'time' });
    render(<GameFootagePicker onFootageChange={vi.fn()} />);
    expect(screen.queryByTestId('footage-reorder-list')).toBeNull();
  });

  it('ready multi with unknown order auto-opens the reorder editor', () => {
    const order = [makeItem('clipA.mp4'), makeItem('clipB.mp4')];
    setIntake({ status: 'ready', items: order, order, confidence: 'unknown' });
    render(<GameFootagePicker onFootageChange={vi.fn()} />);
    expect(screen.getByTestId('footage-reorder-list')).toBeTruthy();
  });

  it('Adjust order opens the reorder editor; Done closes it', () => {
    const order = [makeItem('DJI_0003.MP4'), makeItem('DJI_0004.MP4')];
    setIntake({ status: 'ready', items: order, order, confidence: 'time' });
    render(<GameFootagePicker onFootageChange={vi.fn()} />);
    expect(screen.queryByTestId('footage-reorder-list')).toBeNull();
    fireEvent.click(screen.getByTestId('footage-adjust-order'));
    expect(screen.getByTestId('footage-reorder-list')).toBeTruthy();
    fireEvent.click(screen.getByTestId('footage-reorder-done'));
    expect(screen.queryByTestId('footage-reorder-list')).toBeNull();
  });

  it('single-file state remains untouched — no strip, no reorder editor (T8810 C0)', () => {
    const only = makeItem('game.mp4', 5 * 1024 * 1024);
    setIntake({ status: 'ready', items: [only], order: [only], confidence: 'time' });
    render(<GameFootagePicker onFootageChange={vi.fn()} />);
    expect(screen.getByTestId('footage-picker-ready-single')).toBeTruthy();
    expect(screen.queryByTestId('footage-strip')).toBeNull();
    expect(screen.queryByTestId('footage-reorder-list')).toBeNull();
  });
});

describe('GameFootagePicker — selection paths + beacon', () => {
  it('fires onFileSelected exactly once per accepted selection via the file input', async () => {
    const onFileSelected = vi.fn();
    render(<GameFootagePicker onFootageChange={vi.fn()} onFileSelected={onFileSelected} />);
    const input = screen.getByTestId('footage-file-input');
    fireEvent.change(input, { target: { files: [new File(['x'], 'game.mp4', { type: 'video/mp4' })] } });
    await waitFor(() => expect(addFilesMock).toHaveBeenCalledTimes(1));
    expect(onFileSelected).toHaveBeenCalledTimes(1);
  });

  it('fires onFileSelected via the folder input path too', async () => {
    const onFileSelected = vi.fn();
    render(<GameFootagePicker onFootageChange={vi.fn()} onFileSelected={onFileSelected} />);
    fireEvent.change(screen.getByTestId('footage-folder-input'), {
      target: { files: [new File(['x'], 'DJI_0003.MP4', { type: '' })] },
    });
    await waitFor(() => expect(addFilesMock).toHaveBeenCalledTimes(1));
    expect(onFileSelected).toHaveBeenCalledTimes(1);
  });

  it('the folder link triggers the hidden folder (webkitdirectory) input', () => {
    render(<GameFootagePicker onFootageChange={vi.fn()} />);
    const folderInput = screen.getByTestId('footage-folder-input');
    const clickSpy = vi.spyOn(folderInput, 'click');
    fireEvent.click(screen.getByTestId('footage-folder-link'));
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('zero-accepted selection shows the error, does NOT addFiles, does NOT fire the beacon', async () => {
    const onFileSelected = vi.fn();
    render(<GameFootagePicker onFootageChange={vi.fn()} onFileSelected={onFileSelected} />);
    fireEvent.change(screen.getByTestId('footage-file-input'), {
      target: { files: [new File(['x'], 'thumb.THM', { type: '' })] },
    });
    expect(await screen.findByTestId('footage-error')).toBeTruthy();
    expect(screen.getByTestId('footage-error').textContent).toContain("didn't find any game videos");
    expect(addFilesMock).not.toHaveBeenCalled();
    expect(onFileSelected).not.toHaveBeenCalled();
  });

  it('junk-only add while files already exist still surfaces the error (ready-multi state)', async () => {
    const order = [makeItem('DJI_0003.MP4'), makeItem('DJI_0004.MP4')];
    setIntake({ status: 'ready', items: order, order });
    render(<GameFootagePicker onFootageChange={vi.fn()} />);
    fireEvent.change(screen.getByTestId('footage-file-input'), {
      target: { files: [new File(['x'], 'thumb.THM', { type: '' })] },
    });
    expect(await screen.findByTestId('footage-error')).toBeTruthy();
    expect(addFilesMock).not.toHaveBeenCalled();
  });

  it('duplicate add surfaces an "Already added" toast per duplicate name', async () => {
    addFilesMock.mockResolvedValue({ duplicates: ['game.mp4'] });
    render(<GameFootagePicker onFootageChange={vi.fn()} />);
    fireEvent.change(screen.getByTestId('footage-file-input'), {
      target: { files: [new File(['x'], 'game.mp4', { type: 'video/mp4' })] },
    });
    await waitFor(() => expect(toastInfo).toHaveBeenCalledWith('Already added', { message: 'game.mp4' }));
  });

  it('folder DRAG-drop walks a mocked webkitGetAsEntry() directory tree into addFiles', async () => {
    render(<GameFootagePicker onFootageChange={vi.fn()} />);
    const dropzone = screen.getByTestId('footage-picker-empty').querySelector('[role="button"]');

    const child = (name) => ({
      isFile: true,
      isDirectory: false,
      name,
      file: (resolve) => resolve(new File(['x'], name, { type: '' })),
    });
    const dirEntry = {
      isFile: false,
      isDirectory: true,
      name: 'DJI Action 6',
      createReader: () => {
        let done = false;
        return {
          readEntries: (resolve) => {
            const batch = done ? [] : [child('DJI_0003.MP4'), child('DJI_0004.MP4')];
            done = true;
            resolve(batch);
          },
        };
      },
    };
    const dataTransfer = {
      items: [{ webkitGetAsEntry: () => dirEntry }],
      files: [],
    };
    fireEvent.drop(dropzone, { dataTransfer });

    await waitFor(() => expect(addFilesMock).toHaveBeenCalledTimes(1));
    const walked = addFilesMock.mock.calls[0][0];
    expect(walked.map((f) => f.name)).toEqual(['DJI_0003.MP4', 'DJI_0004.MP4']);
  });
});

describe('GameFootagePicker — reported payload', () => {
  it('single file: emits files:[{file, sequence:1}] with totalBytes', () => {
    const item = makeItem('game.mp4', 2048);
    setIntake({ status: 'ready', items: [item], order: [item], proxies: {} });
    const onFootageChange = vi.fn();
    render(<GameFootagePicker onFootageChange={onFootageChange} />);
    const last = onFootageChange.mock.calls.at(-1)[0];
    expect(last.files).toEqual([{ file: item.file, sequence: 1, creationTime: null }]);
    expect(last.totalBytes).toBe(2048);
  });

  it('T8870: threads the item creationTime through as recorded_at evidence', () => {
    const ct = new Date('2026-07-18T18:44:59Z');
    const item = { name: 'DJI_0005.MP4', size: 1024, duration: 60, creationTime: ct,
      file: new File(['x'], 'DJI_0005.MP4', { type: 'video/mp4' }) };
    setIntake({ status: 'ready', items: [item], order: [item], proxies: {} });
    const onFootageChange = vi.fn();
    render(<GameFootagePicker onFootageChange={onFootageChange} />);
    const last = onFootageChange.mock.calls.at(-1)[0];
    expect(last.files[0].creationTime).toBe(ct);
  });

  it('four files: emits a 1..4 sequenced list in inferred order', () => {
    const order = [makeItem('DJI_0003.MP4'), makeItem('DJI_0004.MP4'), makeItem('DJI_0005.MP4'), makeItem('DJI_0006.MP4')];
    setIntake({ status: 'ready', items: order, order });
    const onFootageChange = vi.fn();
    render(<GameFootagePicker onFootageChange={onFootageChange} />);
    const last = onFootageChange.mock.calls.at(-1)[0];
    expect(last.files.map((f) => f.sequence)).toEqual([1, 2, 3, 4]);
    expect(last.files.map((f) => f.file.name)).toEqual([
      'DJI_0003.MP4',
      'DJI_0004.MP4',
      'DJI_0005.MP4',
      'DJI_0006.MP4',
    ]);
  });
});
