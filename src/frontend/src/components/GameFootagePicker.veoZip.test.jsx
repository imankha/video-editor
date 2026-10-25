import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { addFilesMock } = vi.hoisted(() => ({ addFilesMock: vi.fn(async () => ({ duplicates: [] })) }));
vi.mock('../hooks/useFootageIntake', () => ({
  useFootageIntake: () => ({
    status: 'empty', items: [], order: [], confidence: 'unknown', gaps: [], placement: 'sequence',
    lanes: [], question: null, skipped: [], proxies: {},
    addFiles: addFilesMock, removeItem: vi.fn(), setManualOrder: vi.fn(), setPlacementMode: vi.fn(),
  }),
}));
vi.mock('../utils/veoHighlights', () => ({
  readZipEntries: vi.fn(async () => [{ name: 'x' }]),
  isVeoHighlightsZip: vi.fn(() => true),
}));

import { GameFootagePicker } from './GameFootagePicker';

describe('GameFootagePicker Veo zip (T13240)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hands a Veo zip to onVeoZip and never feeds it to the footage intake (no game is created)', async () => {
    const onVeoZip = vi.fn();
    const onFootageChange = vi.fn();
    render(<GameFootagePicker onVeoZip={onVeoZip} onFootageChange={onFootageChange} />);
    const zip = new File(['z'], 'Veo highlights A vs. B.zip', { type: 'application/zip' });
    fireEvent.change(screen.getByTestId('footage-file-input'), { target: { files: [zip] } });
    await waitFor(() => expect(onVeoZip).toHaveBeenCalledWith(zip));
    expect(addFilesMock).not.toHaveBeenCalled();
    expect(onFootageChange).not.toHaveBeenCalledWith(expect.objectContaining({ files: [expect.anything()] }));
  });

  it('keeps ingesting the videos dropped alongside the zip', async () => {
    const onVeoZip = vi.fn();
    render(<GameFootagePicker onVeoZip={onVeoZip} />);
    const zip = new File(['z'], 'h.zip');
    const video = new File(['v'], 'half.mp4', { type: 'video/mp4' });
    fireEvent.change(screen.getByTestId('footage-file-input'), { target: { files: [zip, video] } });
    await waitFor(() => expect(addFilesMock).toHaveBeenCalledWith([video]));
    expect(onVeoZip).toHaveBeenCalledWith(zip);
  });
});
