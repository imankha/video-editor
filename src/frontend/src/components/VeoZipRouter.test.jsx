import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../utils/veoHighlights', async () => {
  const routing = await vi.importActual('../utils/veoHighlights/routing.js');
  return { ...routing, inspectVeoZip: vi.fn() };
});
vi.mock('./VeoZipPickList', () => ({
  VeoZipPickList: ({ note }) => <div data-testid="pick-list">{note}</div>,
}));

import { inspectVeoZip } from '../utils/veoHighlights';
import { VeoZipRouter } from './VeoZipRouter';

const zip = new File(['z'], 'Veo highlights Lions vs. Rovers FC.zip');
const games = [
  { id: 1, opponent_name: 'Other', game_date: '2026-09-20', video_duration: 5400 },
  { id: 2, opponent_name: 'Rovers FC', game_date: '2026-09-05', video_duration: 5400 },
];
const setup = (g = games) => {
  const props = { zipFile: zip, games: g, onSuggest: vi.fn(), onUploadClips: vi.fn(), onClose: vi.fn() };
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

  it('goes straight to the clip pick list, with the note, when no game fits', async () => {
    inspectVeoZip.mockResolvedValue({ minLengthS: 99999 });
    const props = setup();
    const list = await screen.findByTestId('pick-list');
    expect(list.textContent).toContain('Upload the full Veo game first');
    expect(props.onSuggest).not.toHaveBeenCalled();
  });

  it('"Upload as clips" opens the pick list without the note', async () => {
    inspectVeoZip.mockResolvedValue({ minLengthS: 3000 });
    setup();
    fireEvent.click(await screen.findByTestId('veo-route-clips'));
    expect((await screen.findByTestId('pick-list')).textContent).toBe('');
  });

  it('does not close on a backdrop click (no backdrop close)', async () => {
    inspectVeoZip.mockResolvedValue({ minLengthS: 3000 });
    const props = setup();
    const dialog = await screen.findByTestId('veo-route');
    fireEvent.click(dialog.previousElementSibling);
    expect(props.onClose).not.toHaveBeenCalled();
  });
});
