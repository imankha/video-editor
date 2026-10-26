import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// T13220: the sheet reads the zip with T13200 (mocked: no Worker in jsdom) and makes ONE onImport call.
vi.mock('../../../utils/veoHighlights', async (orig) => {
  const real = await orig();
  return {
    ...real,
    readZipEntries: vi.fn(async () => [{ name: 'x' }]),
    isVeoHighlightsZip: vi.fn(() => true),
    parseEntries: vi.fn(() => ({ parsed: [{ name: 'x' }] })),
    readDurations: vi.fn(async (_f, _e, { onProgress }) => { onProgress?.(1, 1); return { x: 12 }; }),
    withDurations: vi.fn((p) => p),
    mergeMoments: vi.fn(() => ({
      moments: [
        { stamp_s: 883, duration_s: 12, labels: ['Goal'] },
        { stamp_s: 900, duration_s: 10, labels: ['Shot on goal'] },
        { stamp_s: 950, duration_s: 10, labels: ['Shot on goal'] },
      ],
    })),
  };
});
import * as veo from '../../../utils/veoHighlights';
import { VeoImportSheet, summarizeMoments } from './VeoImportSheet';

const zip = (name) => ({ name });
const videos2 = [{ sequence: 1, name: 'First half' }, { sequence: 2, name: 'Second half' }];

beforeEach(() => vi.clearAllMocks());

describe('summarizeMoments', () => {
  it('pluralizes by primary label', () => {
    expect(summarizeMoments([
      { labels: ['Goal'] }, { labels: ['Shot on goal'] }, { labels: ['Shot on goal'] }, { labels: ['Highlight'] },
    ])).toBe('1 goal, 2 shots, 1 highlight');
  });
});

describe('VeoImportSheet', () => {
  it('shows the summary and imports once, mapped to start/end seconds, for a single-video game', async () => {
    const onImport = vi.fn(async () => {});
    render(<VeoImportSheet zipFile={zip('Rebels.zip')} videos={[{ sequence: 1, name: 'G' }]} onImport={onImport} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('veo-import-summary').textContent).toBe('3 moments: 1 goal, 2 shots'));
    expect(screen.queryByText(/Which video/)).toBeNull();
    fireEvent.click(screen.getByTestId('veo-import-submit'));
    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    expect(onImport.mock.calls[0][0]).toBe(1);
    expect(onImport.mock.calls[0][1][0]).toEqual({ start: 883, end: 895, labels: ['Goal'] });
  });

  it('T13400:C1 a 422 shows the server reason plus the make-a-new-game next step, not the generic retry', async () => {
    const err = Object.assign(new Error('POST failed (422)'), {
      status: 422,
      body: { detail: 'Moment runs to 212s but video 1 is 5s: wrong video?' },
    });
    const onImport = vi.fn(async () => { throw err; });
    render(<VeoImportSheet zipFile={zip('Rebels.zip')} videos={[{ sequence: 1, name: 'G' }]} onImport={onImport} onClose={vi.fn()} />);
    await waitFor(() => screen.getByTestId('veo-import-submit'));
    fireEvent.click(screen.getByTestId('veo-import-submit'));
    const alert = await screen.findByTestId('veo-import-failed');
    expect(alert.textContent).toContain('Moment runs to 212s but video 1 is 5s');
    expect(alert.textContent).toContain('Make a game');
    expect(alert.textContent).not.toMatch(/Try again/);
    expect(alert.textContent).not.toContain('?.');
  });

  it('T13400:C1 a 422 with a validation-array detail never says try again and names the next step', async () => {
    const err = Object.assign(new Error('POST failed (422)'), { status: 422, body: { detail: [{ msg: 'field required' }] } });
    const onImport = vi.fn(async () => { throw err; });
    render(<VeoImportSheet zipFile={zip('Rebels.zip')} videos={[{ sequence: 1, name: 'G' }]} onImport={onImport} onClose={vi.fn()} />);
    await waitFor(() => screen.getByTestId('veo-import-submit'));
    fireEvent.click(screen.getByTestId('veo-import-submit'));
    const alert = await screen.findByTestId('veo-import-failed');
    expect(alert.textContent).not.toMatch(/Try again/);
    expect(alert.textContent).toContain('Make a game');
  });

  it('T13400:C1 an unrelated 422 reason is shown as is, without the make-a-game next step or double punctuation', async () => {
    const err = Object.assign(new Error('POST failed (422)'), { status: 422, body: { detail: 'Each moment must span at least half a second' } });
    const onImport = vi.fn(async () => { throw err; });
    render(<VeoImportSheet zipFile={zip('Rebels.zip')} videos={[{ sequence: 1, name: 'G' }]} onImport={onImport} onClose={vi.fn()} />);
    await waitFor(() => screen.getByTestId('veo-import-submit'));
    fireEvent.click(screen.getByTestId('veo-import-submit'));
    const alert = await screen.findByTestId('veo-import-failed');
    expect(alert.textContent).toBe('Each moment must span at least half a second.');
  });

  it('T13400:C1 a non-422 failure keeps the generic retry message', async () => {
    const onImport = vi.fn(async () => { throw Object.assign(new Error('boom'), { status: 500, body: {} }); });
    render(<VeoImportSheet zipFile={zip('Rebels.zip')} videos={[{ sequence: 1, name: 'G' }]} onImport={onImport} onClose={vi.fn()} />);
    await waitFor(() => screen.getByTestId('veo-import-submit'));
    fireEvent.click(screen.getByTestId('veo-import-submit'));
    const alert = await screen.findByTestId('veo-import-failed');
    expect(alert.textContent).toMatch(/Try again/);
  });

  it('with 2+ videos preselects the half from the zip name and requires a choice otherwise', async () => {
    const { unmount } = render(<VeoImportSheet zipFile={zip('Match (2nd Half).zip')} videos={videos2} onImport={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => screen.getByTestId('veo-import-summary'));
    expect(screen.getByRole('radio', { name: 'Second half' }).checked).toBe(true);
    unmount();
    render(<VeoImportSheet zipFile={zip('Match.zip')} videos={videos2} onImport={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => screen.getByTestId('veo-import-summary'));
    expect(screen.getByTestId('veo-import-submit').disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'First half' }));
    expect(screen.getByTestId('veo-import-submit').disabled).toBe(false);
  });

  it('refuses a zip that is not a Veo highlights zip', async () => {
    veo.isVeoHighlightsZip.mockReturnValueOnce(false);
    render(<VeoImportSheet zipFile={zip('x.zip')} videos={videos2} onImport={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('veo-import-error').textContent).toMatch(/Only Veo highlights zips/));
    expect(screen.queryByTestId('veo-import-submit')).toBeNull();
  });

  it('has no backdrop close', async () => {
    const onClose = vi.fn();
    const { container } = render(<VeoImportSheet zipFile={zip('x.zip')} videos={videos2} onImport={vi.fn()} onClose={onClose} />);
    fireEvent.click(container.firstChild.firstChild);
    expect(onClose).not.toHaveBeenCalled();
  });
});
