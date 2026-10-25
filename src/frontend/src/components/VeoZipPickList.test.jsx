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
    expect(meta['01 000100_-_Goal.mp4']).toEqual({ name: 'Goal 1:00', tags: ['Goal'], notes: 'Veo: Goal', rating: null });
  });

  describe('game mode (T13245)', () => {
    const zipName = 'Veo highlights WCFC vs. Legends FC San Diego (1st Half).zip';
    // The merged group stamp (60) differs from its uploaded entry's own stamp (75): placement
    // must come from the uploaded entry.
    const gameMoment = (labels, groupStamp, name, ownStamp, durationS) => ({
      stamp_s: groupStamp, duration_s: 99, labels,
      entries: [
        { name: `other-${name}`, upload: false, stamp_s: groupStamp, durationS: 5 },
        { name, upload: true, stamp_s: ownStamp, durationS },
      ],
    });

    it('extracts the picked uploaded entries one at a time and hands one game payload over, creating no clips', async () => {
      const entries = [entry('a.mp4'), entry('b.mp4'), entry('c.mp4')];
      veo.readZipEntries.mockResolvedValue(entries);
      veo.isVeoHighlightsZip.mockReturnValue(true);
      veo.mergeMoments.mockReturnValue({
        moments: [
          gameMoment(['Attack'], 60, 'a.mp4', 75, 20),
          gameMoment(['Goal', 'Highlight'], 400, 'b.mp4', 410, 30),
          gameMoment(['Defence'], 900, 'c.mp4', 905, 15),
        ],
      });
      let active = 0;
      let maxActive = 0;
      const gates = [];
      veo.extractEntry.mockImplementation((_z, e) => new Promise((resolve) => {
        active += 1; maxActive = Math.max(maxActive, active);
        gates.push(() => { active -= 1; resolve(new File(['x'], e.name)); });
      }));
      const onUpload = vi.fn();
      const onCreateGame = vi.fn();
      render(<VeoZipPickList zipFile={new File(['z'], zipName)} gameMode onUpload={onUpload} onCreateGame={onCreateGame} onClose={vi.fn()} />);

      await screen.findByText('1:00');
      const boxes = screen.getAllByRole('checkbox');
      fireEvent.click(boxes[2]); // pick out of order: c then a
      fireEvent.click(boxes[0]);
      const button = screen.getByTestId('veo-add');
      expect(button.textContent).toBe('Create game from 2 highlights');
      fireEvent.click(button);

      await waitFor(() => expect(gates).toHaveLength(1));
      expect(screen.getByTestId('veo-add').textContent).toBe('Preparing 0/2...');
      gates[0]();
      await waitFor(() => expect(gates).toHaveLength(2));
      expect(screen.getByTestId('veo-add').textContent).toBe('Preparing 1/2...');
      gates[1]();
      await waitFor(() => expect(onCreateGame).toHaveBeenCalledTimes(1));

      expect(maxActive).toBe(1);
      expect(onUpload).not.toHaveBeenCalled();
      const payload = onCreateGame.mock.calls[0][0];
      expect(payload.name).toBe('WCFC vs. Legends FC San Diego (1st Half)');
      // No opponent: GET /api/games rebuilds the title as "Vs {opponent}" whenever one is set,
      // which would replace the zip title (the title already names the opponent).
      expect(payload).not.toHaveProperty('opponentName');
      expect(payload.files.map((f) => [f.file.name, f.sequence, f.offset_seconds, f.durationS]))
        .toEqual([['a.mp4', 1, 75, 20], ['c.mp4', 2, 905, 15]]);
      expect(payload.veoSuggestions).toEqual([
        { video_sequence: 1, start: 0, labels: ['Attack'] },
        { video_sequence: 2, start: 0, labels: ['Defence'] },
      ]);
    });

    it('a failed extraction shows the read error and creates no game', async () => {
      veo.readZipEntries.mockResolvedValue([entry('a.mp4')]);
      veo.isVeoHighlightsZip.mockReturnValue(true);
      veo.mergeMoments.mockReturnValue({ moments: [gameMoment(['Goal'], 60, 'a.mp4', 75, 20)] });
      veo.extractEntry.mockRejectedValue(new Error('boom'));
      const onCreateGame = vi.fn();
      vi.spyOn(console, 'error').mockImplementation(() => {});
      render(<VeoZipPickList zipFile={new File(['z'], zipName)} gameMode onCreateGame={onCreateGame} onClose={vi.fn()} />);
      await screen.findByText('1:00');
      fireEvent.click(screen.getByRole('checkbox'));
      fireEvent.click(screen.getByTestId('veo-add'));
      expect(await screen.findByTestId('veo-error')).toBeTruthy();
      expect(onCreateGame).not.toHaveBeenCalled();
    });
  });

  it('does not close on a backdrop click, so a stray tap keeps the selection (no backdrop close)', async () => {
    veo.readZipEntries.mockResolvedValue([entry('a.txt')]);
    veo.isVeoHighlightsZip.mockReturnValue(false);
    const onClose = vi.fn();
    render(<VeoZipPickList zipFile={new File(['z'], 'x.zip')} onUpload={vi.fn()} onClose={onClose} />);
    const dialog = await screen.findByTestId('veo-pick-list');
    fireEvent.click(dialog.previousElementSibling);
    expect(onClose).not.toHaveBeenCalled();
  });
});
