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
import { useCreditStore } from '../stores/creditStore';
import { VeoZipPickList } from './VeoZipPickList';

const entry = (name) => ({ name });
const moment = (labels, stamp_s, name) => ({
  stamp_s, duration_s: 25, labels, entries: [{ name, upload: true, stamp_s, durationS: 25 }],
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

    await screen.findAllByRole('checkbox');
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

      await screen.findAllByRole('checkbox');
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
      expect(payload.name).toBe('Vs Legends FC San Diego'); // the title the details step shows (T13600)
      // T13246: the opponent is prefilled from the zip name (the details step), nothing else.
      expect(payload.opponentName).toBe('Legends FC San Diego');
      expect(payload.gameDate).toBe('');
      expect(payload.files.map((f) => [f.file.name, f.sequence, f.offset_seconds, f.durationS]))
        .toEqual([['Attack 1m15s.mp4', 1, 75, 20], ['Defence 15m05s.mp4', 2, 905, 15]]);
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
      await screen.findAllByRole('checkbox');
      fireEvent.click(screen.getByRole('checkbox'));
      fireEvent.click(screen.getByTestId('veo-add'));
      expect(await screen.findByTestId('veo-error')).toBeTruthy();
      expect(onCreateGame).not.toHaveBeenCalled();
    });
  });

  describe('game details step (T13246)', () => {
    const zipName = 'Veo highlights WCFC B2012 vs. Legends FC San Diego (1st Half).zip';
    const setup = async (name = zipName) => {
      veo.extractEntry.mockImplementation(async (_z, e) => new File(['x'], e.name));
      veo.readZipEntries.mockResolvedValue([entry('a.mp4')]);
      veo.isVeoHighlightsZip.mockReturnValue(true);
      veo.mergeMoments.mockReturnValue({
        moments: [{ stamp_s: 60, duration_s: 25, labels: ['Goal'], entries: [{ name: 'a.mp4', upload: true, stamp_s: 75, durationS: 20 }] }],
      });
      const onCreateGame = vi.fn();
      render(<VeoZipPickList zipFile={new File(['z'], name)} gameMode onCreateGame={onCreateGame} onClose={vi.fn()} />);
      await screen.findAllByRole('checkbox');
      fireEvent.click(screen.getByRole('checkbox'));
      return onCreateGame;
    };

    it('shows a Game details (optional) disclosure, open because the zip name filled the opponent', async () => {
      await setup();
      const disclosure = screen.getByTestId('game-details-disclosure');
      expect(disclosure.open).toBe(true);
      expect(screen.getByDisplayValue('Legends FC San Diego')).toBeTruthy();
      expect(screen.getByText(/Filled in from your zip's name/)).toBeTruthy();
    });

    it('stays collapsed when the zip name says nothing, and Create still works untouched', async () => {
      const onCreateGame = await setup('Veo highlights.zip');
      expect(screen.getByTestId('game-details-disclosure').open).toBe(false);
      fireEvent.click(screen.getByTestId('veo-add'));
      await waitFor(() => expect(onCreateGame).toHaveBeenCalledTimes(1));
      expect(onCreateGame.mock.calls[0][0]).toMatchObject({ name: 'Veo highlights', opponentName: '', gameDate: '', gameType: 'unknown', tournamentName: null });
    });

    it('previews the title the game will get and sends the edited details in the one payload', async () => {
      const onCreateGame = await setup();
      expect(screen.getByTestId('veo-title-preview').textContent).toBe('Game title: Vs Legends FC San Diego');
      fireEvent.click(screen.getByRole('button', { name: 'Away' }));
      fireEvent.change(document.querySelector('input[type="date"]'), { target: { value: '2026-03-28' } });
      expect(screen.getByTestId('veo-title-preview').textContent).toBe('Game title: at Legends FC San Diego Mar 28');
      fireEvent.click(screen.getByTestId('veo-add'));
      await waitFor(() => expect(onCreateGame).toHaveBeenCalledTimes(1));
      expect(onCreateGame.mock.calls[0][0]).toMatchObject({
        name: 'at Legends FC San Diego Mar 28',
        opponentName: 'Legends FC San Diego', gameDate: '2026-03-28', gameType: 'away', tournamentName: null,
      });
    });

    it('with the opponent cleared the game keeps the zip title', async () => {
      await setup();
      fireEvent.change(screen.getByDisplayValue('Legends FC San Diego'), { target: { value: '' } });
      expect(screen.getByTestId('veo-title-preview').textContent).toBe('Game title: WCFC B2012 vs. Legends FC San Diego (1st Half)');
    });
  });

  describe('make a game: cost, title, counts, names (T13600)', () => {
    const zipName = 'Veo highlights WCFC vs. LA Breakers FC Long Beach.zip';
    const up = (name, stamp_s, durationS, size = 1000) => ({ name, upload: true, stamp_s, durationS, size });
    // A merged moment whose group span (60s, 40s) differs from its uploaded entry (75s, 20s).
    const momentsFixture = [
      { stamp_s: 60, duration_s: 40, labels: ['Goal', 'Shot on goal'], entries: [up('g.mp4', 75, 20, 2 * 1024 ** 3)] },
      { stamp_s: 200, duration_s: 25, labels: ['Shot on goal', 'Attack'], entries: [up('s.mp4', 200, 25)] },
      { stamp_s: 300, duration_s: 25, labels: ['Attack'], entries: [up('a.mp4', 300, 25)] },
    ];
    const setup = async () => {
      veo.extractEntry.mockImplementation(async (_z, e) => new File(['x'], e.name));
      veo.readZipEntries.mockResolvedValue(momentsFixture.map((m) => entry(m.entries[0].name)));
      veo.isVeoHighlightsZip.mockReturnValue(true);
      veo.mergeMoments.mockReturnValue({ moments: momentsFixture });
      const onCreateGame = vi.fn();
      render(<VeoZipPickList zipFile={new File(['z'], zipName)} gameMode onCreateGame={onCreateGame} onClose={vi.fn()} />);
      await screen.findAllByRole('checkbox');
      return onCreateGame;
    };

    it('A: shows the credit cost for the picked highlights and the balance before Create', async () => {
      useCreditStore.setState({ balance: 171, loaded: true });
      await setup();
      expect(screen.getByText('Cost: 2 credits')).toBeTruthy(); // nothing picked: 1 GB minimum + export
      fireEvent.click(screen.getAllByRole('checkbox')[0]); // a 2 GB entry
      expect(screen.getByText('Cost: 3 credits')).toBeTruthy();
      expect(screen.getByText('Balance: 171 credits')).toBeTruthy();
    });

    it('B: the created game is titled exactly what the picker promised', async () => {
      const onCreateGame = await setup();
      const promised = screen.getByTestId('veo-title-preview').textContent.replace('Game title: ', '');
      expect(promised).toBe('Vs LA Breakers FC Long Beach');
      fireEvent.click(screen.getAllByRole('checkbox')[0]);
      fireEvent.click(screen.getByTestId('veo-add'));
      await waitFor(() => expect(onCreateGame).toHaveBeenCalledTimes(1));
      expect(onCreateGame.mock.calls[0][0].name).toBe(promised);
    });

    it('C: chip counts add up to the rows, each chip filters to exactly that many rows, rows show the placed time', async () => {
      await setup();
      const counts = screen.getAllByRole('button').map((b) => /^(Goal|Shot on goal|Attack) (\d+)$/.exec(b.textContent)).filter(Boolean);
      expect(counts.map((m) => [m[1], Number(m[2])])).toEqual([['Goal', 1], ['Shot on goal', 1], ['Attack', 1]]);
      expect(screen.getAllByRole('checkbox')).toHaveLength(3);
      // The Goal row reads the uploaded entry's 1:15 / 20s, the same as the suggestion it becomes.
      expect(screen.getByText('1:15')).toBeTruthy();
      expect(screen.getByText('20s')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Attack 1' }));
      expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    });

    it('C: each suggestion carries only its row label, so the game gets no chip without a suggestion', async () => {
      const onCreateGame = await setup();
      fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
      fireEvent.click(screen.getByTestId('veo-add'));
      await waitFor(() => expect(onCreateGame).toHaveBeenCalledTimes(1));
      expect(onCreateGame.mock.calls[0][0].veoSuggestions.map((s) => s.labels)).toEqual([['Goal'], ['Shot on goal'], ['Attack']]);
    });

    it('D: the game videos are named for the play, not the raw zip entry', async () => {
      const onCreateGame = await setup();
      fireEvent.click(screen.getAllByRole('checkbox')[0]);
      fireEvent.click(screen.getByTestId('veo-add'));
      await waitFor(() => expect(onCreateGame).toHaveBeenCalledTimes(1));
      expect(onCreateGame.mock.calls[0][0].files[0].file.name).toBe('Goal 1m15s.mp4');
    });

    it('the moment list scrolls with the dialog body, not in its own nested window', async () => {
      await setup();
      const body = screen.getByTestId('veo-pick-list').querySelector('.overflow-y-auto');
      expect(body.contains(screen.getByTestId('game-details-disclosure'))).toBe(true);
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
