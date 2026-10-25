import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../utils/veoHighlights', async () => {
  const routing = await vi.importActual('../utils/veoHighlights/routing.js');
  return { ...routing, inspectVeoZip: vi.fn() };
});
vi.mock('./VeoZipPickList', () => ({
  VeoZipPickList: ({ note, gameMode, onCreateGame }) => (
    <div data-testid="pick-list" data-game-mode={gameMode ? 'yes' : 'no'}>
      {note}
      <button data-testid="mock-create" onClick={() => onCreateGame({ name: 'N' })}>create</button>
    </div>
  ),
}));

import { inspectVeoZip } from '../utils/veoHighlights';
import { VeoZipRouter } from './VeoZipRouter';

const zip = new File(['z'], 'Veo highlights Lions vs. Rovers FC.zip');
const games = [
  { id: 1, opponent_name: 'Other', game_date: '2026-09-20', video_duration: 5400 },
  { id: 2, opponent_name: 'Rovers FC', game_date: '2026-09-05', video_duration: 5400 },
];
const setup = (g = games) => {
  const props = { zipFile: zip, games: g, onSuggest: vi.fn(), onUploadClips: vi.fn(), onCreateGame: vi.fn(), onClose: vi.fn() };
  render(<VeoZipRouter {...props} />);
  return props;
};

describe('VeoZipRouter (T13240)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('offers suggested plays for the opponent match first, clips second; choosing A reports the game', async () => {
    inspectVeoZip.mockResolvedValue({ minLengthS: 3000 });
    const props = setup();
    const suggest = await screen.findAllByTestId('veo-route-suggest');
    expect(suggest[0].textContent).toContain('Rovers FC');
    const all = screen.getAllByRole('button').map((b) => b.textContent);
    expect(all.indexOf(suggest[0].textContent)).toBeLessThan(all.indexOf('Upload as clips'));
    fireEvent.click(suggest[0]);
    expect(props.onSuggest).toHaveBeenCalledWith(games[1], zip);
  });

  it('never offers a long game whose opponent does not match (the "Vs LA Rebels" report)', async () => {
    inspectVeoZip.mockResolvedValue({ minLengthS: 3000 });
    setup();
    const suggest = await screen.findAllByTestId('veo-route-suggest');
    expect(suggest).toHaveLength(1);
    expect(screen.queryByText(/Other/)).toBeNull();
  });

  it('with no candidate game lists "Make a game" first, then "Upload as clips"', async () => {
    inspectVeoZip.mockResolvedValue({ minLengthS: 99999 });
    const props = setup();
    await screen.findByTestId('veo-route-game');
    const all = screen.getAllByRole('button').map((b) => b.textContent);
    expect(all.indexOf('Make a game from these highlights')).toBeLessThan(all.indexOf('Upload as clips'));
    expect(all.indexOf('Make a game from these highlights')).toBe(0);
    expect(screen.queryByTestId('veo-route-suggest')).toBeNull();
    expect(props.onSuggest).not.toHaveBeenCalled();
  });

  it('with candidates, "Make a game" comes after the suggested-plays buttons and before "Upload as clips"', async () => {
    inspectVeoZip.mockResolvedValue({ minLengthS: 3000 });
    setup();
    const suggest = await screen.findAllByTestId('veo-route-suggest');
    const all = screen.getAllByRole('button').map((b) => b.textContent);
    const game = all.indexOf('Make a game from these highlights');
    expect(game).toBeGreaterThan(all.indexOf(suggest[suggest.length - 1].textContent));
    expect(game).toBeLessThan(all.indexOf('Upload as clips'));
  });

  it('"Make a game" opens the pick list in game mode and forwards its payload', async () => {
    inspectVeoZip.mockResolvedValue({ minLengthS: 99999 });
    const props = setup();
    fireEvent.click(await screen.findByTestId('veo-route-game'));
    expect((await screen.findByTestId('pick-list')).dataset.gameMode).toBe('yes');
    fireEvent.click(screen.getByTestId('mock-create'));
    expect(props.onCreateGame).toHaveBeenCalledWith({ name: 'N' });
  });

  it('"Upload as clips" opens the pick list without the note', async () => {
    inspectVeoZip.mockResolvedValue({ minLengthS: 3000 });
    setup();
    fireEvent.click(await screen.findByTestId('veo-route-clips'));
    const list = await screen.findByTestId('pick-list');
    expect(list.dataset.gameMode).toBe('no');
    expect(list.textContent).not.toContain('Upload the full Veo game first');
  });

  it('does not close on a backdrop click (no backdrop close)', async () => {
    inspectVeoZip.mockResolvedValue({ minLengthS: 3000 });
    const props = setup();
    const dialog = await screen.findByTestId('veo-route');
    fireEvent.click(dialog.previousElementSibling);
    expect(props.onClose).not.toHaveBeenCalled();
  });
});
