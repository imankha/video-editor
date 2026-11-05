import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// T13247: the picker takes any zip of clips when it accepts zips (onVeoZip given). jsdom's Blob
// cannot be sliced into bytes, so the zip reader is stubbed; the real unzip is covered by
// utils/zipClips.test.js.
const { addFilesMock, zipEntries } = vi.hoisted(() => ({
  addFilesMock: vi.fn(async () => ({ duplicates: [] })),
  zipEntries: { current: [] },
}));
vi.mock('../hooks/useFootageIntake', () => ({
  useFootageIntake: () => ({
    status: 'empty', items: [], order: [], confidence: 'unknown', gaps: [], placement: 'sequence',
    lanes: [], question: null, skipped: [], proxies: {},
    addFiles: addFilesMock, removeItem: vi.fn(), setManualOrder: vi.fn(), setPlacementMode: vi.fn(),
  }),
}));
vi.mock('../utils/veoHighlights', () => ({
  readZipEntries: vi.fn(async () => zipEntries.current),
  isVeoHighlightsZip: vi.fn((entries) => entries.some((e) => e.name === '.veo-zip')),
  extractEntry: vi.fn(async (zip, entry, type) => new File(['v'], entry.name, { type })),
}));

import { GameFootagePicker } from './GameFootagePicker';

const entry = (name, size = 10) => ({ name, size });
const pick = (files) => fireEvent.change(screen.getByTestId('footage-file-input'), { target: { files } });

describe('GameFootagePicker zip of clips (T13247)', () => {
  beforeEach(() => { vi.clearAllMocks(); zipEntries.current = []; });

  it('unzips a plain zip and adds its videos as footage, like a loose pick', async () => {
    zipEntries.current = [entry('a.mp4'), entry('sub/b.mov'), entry('__MACOSX/._a.mp4'), entry('readme.txt')];
    const onVeoZip = vi.fn();
    render(<GameFootagePicker onVeoZip={onVeoZip} />);
    pick([new File(['z'], 'phone clips.zip', { type: 'application/zip' })]);
    await waitFor(() => expect(addFilesMock).toHaveBeenCalledTimes(1));
    expect(addFilesMock.mock.calls[0][0].map((f) => f.name)).toEqual(['a.mp4', 'b.mov']);
    expect(onVeoZip).not.toHaveBeenCalled();
  });

  it('a zip with no videos shows the error line and the picker stays usable', async () => {
    zipEntries.current = [entry('a.jpg')];
    render(<GameFootagePicker onVeoZip={vi.fn()} />);
    pick([new File(['z'], 'photos.zip')]);
    expect(await screen.findByText('This zip has no videos in it.')).toBeTruthy();
    expect(addFilesMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('footage-picker-empty')).toBeTruthy();
  });

  it('a refused Veo zip is not handed on; the picker says why', async () => {
    zipEntries.current = [entry('.veo-zip'), entry('01 000252_-_Goal.mp4')];
    const onVeoZip = vi.fn();
    render(<GameFootagePicker onVeoZip={onVeoZip} veoZipRefusal="No import here." />);
    pick([new File(['z'], 'Veo highlights A vs. B.zip')]);
    expect(await screen.findByText('No import here.')).toBeTruthy();
    expect(onVeoZip).not.toHaveBeenCalled();
    expect(addFilesMock).not.toHaveBeenCalled();
  });

  it('says "zip of clips" only when it accepts zips', () => {
    const { unmount } = render(<GameFootagePicker onVeoZip={vi.fn()} />);
    expect(screen.getByText('MP4, MOV, WebM, or a zip of plays')).toBeTruthy();
    expect(screen.getByText('Tap to choose videos or a zip of plays')).toBeTruthy();
    unmount();
    render(<GameFootagePicker />);
    expect(screen.getByText('MP4, MOV, or WebM')).toBeTruthy();
    expect(screen.getByText('Tap to choose videos. Pick as many as you want.')).toBeTruthy();
    expect(screen.queryByText(/zip/i)).toBeNull();
  });
});
