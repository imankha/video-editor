import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../utils/veoHighlights', async () => {
  const real = await vi.importActual('../utils/veoHighlights/clipImport.js');
  return {
    ...real,
    readZipEntries: vi.fn(),
    extractEntry: vi.fn(async (_z, e) => new File(['x'], e.name)),
    isVeoHighlightsZip: vi.fn(),
    parseEntries: vi.fn(() => ({ parsed: [] })),
    readDurations: vi.fn(async () => ({})),
    withDurations: vi.fn((p) => p),
    mergeMoments: vi.fn(),
  };
});

import * as veo from '../utils/veoHighlights';
import { VeoZipPickList } from './VeoZipPickList';

const entry = (name) => ({ name });
const moment = (labels, stamp_s, name) => ({
  stamp_s, duration_s: 25, labels, entries: [{ name, upload: true }],
});

describe('VeoZipPickList (T13230)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows a visible message for a non-Veo zip', async () => {
    veo.readZipEntries.mockResolvedValue([entry('a.txt')]);
    veo.isVeoHighlightsZip.mockReturnValue(false);
    render(<VeoZipPickList zipFile={new File(['z'], 'x.zip')} onUpload={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText('Only Veo highlights zips are supported.')).toBeTruthy();
    expect(screen.queryByTestId('veo-add')).toBeNull();
  });

  it('lists moments with nothing selected, filters by chip, uploads the chosen moment', async () => {
    const entries = [entry('01 000100_-_Goal.mp4'), entry('02 000200_-_Attack.mp4')];
    veo.readZipEntries.mockResolvedValue(entries);
    veo.isVeoHighlightsZip.mockReturnValue(true);
    veo.mergeMoments.mockReturnValue({
      moments: [moment(['Goal'], 60, entries[0].name), moment(['Attack'], 120, entries[1].name)],
    });
    const onUpload = vi.fn();
    render(<VeoZipPickList zipFile={new File(['z'], 'x.zip')} onUpload={onUpload} onClose={vi.fn()} />);

    await screen.findByText('1:00');
    expect(screen.getAllByRole('checkbox').every((c) => !c.checked)).toBe(true);
    expect(screen.getByTestId('veo-add').disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Goal 1' }));
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    fireEvent.click(screen.getByTestId('veo-add'));

    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1));
    const [files, meta] = onUpload.mock.calls[0];
    expect(files.map((f) => f.name)).toEqual(['01 000100_-_Goal.mp4']);
    expect(meta['01 000100_-_Goal.mp4']).toEqual({ name: 'Goal 1:00', tags: ['Goal'], notes: 'Veo: Goal' });
  });
});
