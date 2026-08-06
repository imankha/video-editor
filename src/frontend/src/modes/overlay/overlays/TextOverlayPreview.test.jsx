// T6620 (report item 3) — the eye button must actually hide the text in the
// preview. Regression: a DISABLED block (`enabled === false`) is hidden even
// while it is the SELECTED block; an `enabled === undefined` block (a DB-loaded
// block never toggled) still SHOWS.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

// Mock the display-rect hook to a fixed rect (no DOM layout in unit tests).
vi.mock('../../../hooks/useVideoDisplayRect', () => ({
  default: () => ({ rect: { offsetX: 0, offsetY: 0, width: 100, height: 100 } }),
}));

// Stub RichText to a plain marker carrying the block text so we can assert which
// blocks rendered without pulling in fonts/canvas.
vi.mock('../../../components/RichText', () => ({
  default: ({ spec }) => <div data-testid="richtext">{spec.text}</div>,
}));

import TextOverlayPreview from './TextOverlayPreview';

afterEach(cleanup);

const block = (id, text, enabled, extra = {}) => ({
  id,
  spec: { text },
  startTime: 0,
  endTime: 10,
  enabled,
  ...extra,
});

function renderPreview(textOverlays, selectedTextId = null) {
  return render(
    <TextOverlayPreview
      videoRef={{ current: null }}
      videoMetadata={{ width: 100, height: 100 }}
      textOverlays={textOverlays}
      currentTime={5}
      selectedTextId={selectedTextId}
    />,
  );
}

describe('TextOverlayPreview — eye toggle (T6620)', () => {
  it('hides a disabled block whose range contains the playhead', () => {
    const { queryByText } = renderPreview([block('a', 'HIDE ME', false)]);
    expect(queryByText('HIDE ME')).toBeNull();
  });

  it('hides a disabled block EVEN when it is the selected block', () => {
    // The core bug: the selected-block short-circuit used to render it regardless
    // of `enabled`, so clicking the eye on the block you were editing never hid it.
    const { queryByText } = renderPreview([block('a', 'SELECTED HIDDEN', false)], 'a');
    expect(queryByText('SELECTED HIDDEN')).toBeNull();
  });

  it('shows an enabled block in range', () => {
    const { getByText } = renderPreview([block('a', 'VISIBLE', true)]);
    expect(getByText('VISIBLE')).toBeTruthy();
  });

  it('shows a DB-loaded block with enabled === undefined (never toggled)', () => {
    const b = { id: 'a', spec: { text: 'UNDEFINED SHOWS' }, startTime: 0, endTime: 10 };
    const { getByText } = renderPreview([b]);
    expect(getByText('UNDEFINED SHOWS')).toBeTruthy();
  });

  it('shows a selected enabled block even when the playhead is outside its range', () => {
    const b = block('a', 'EDIT OUT OF RANGE', true, { startTime: 20, endTime: 30 });
    const { getByText } = renderPreview([b], 'a');
    expect(getByText('EDIT OUT OF RANGE')).toBeTruthy();
  });
});
