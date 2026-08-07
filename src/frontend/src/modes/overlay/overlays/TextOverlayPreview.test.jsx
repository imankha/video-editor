// T6620 (report item 3) — the eye button must actually hide the text in the
// preview. Regression: a DISABLED element (`enabled === false`) is hidden even
// while its region is SELECTED; an `enabled === undefined` element (a
// DB-loaded element never toggled) still SHOWS.
//
// T6630 round 4 — model reframe: `textOverlays` is now a list of REGIONS
// (time spans), each containing N elements that render SIMULTANEOUSLY. The
// core bug this replaces: two elements added at different times used to live
// in separate disjoint spans and could never render together ("only the
// second one showed up").

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';

// Mock the display-rect hook to a fixed rect (no DOM layout in unit tests).
vi.mock('../../../hooks/useVideoDisplayRect', () => ({
  default: () => ({ rect: { offsetX: 0, offsetY: 0, width: 100, height: 100 } }),
}));

// Stub RichText to a plain marker carrying the element's text so we can
// assert which elements rendered without pulling in fonts/canvas.
vi.mock('../../../components/RichText', () => ({
  default: ({ spec }) => <div data-testid="richtext">{spec.text}</div>,
}));

import TextOverlayPreview from './TextOverlayPreview';

afterEach(cleanup);

function region(id, elements, startTime = 0, endTime = 10) {
  return { id, startTime, endTime, elements };
}
function element(id, text, enabled) {
  const el = { id, spec: { text } };
  if (enabled !== undefined) el.enabled = enabled;
  return el;
}

function renderPreview(textOverlays, selectedRegionId = null) {
  return render(
    <TextOverlayPreview
      videoRef={{ current: null }}
      videoMetadata={{ width: 100, height: 100 }}
      textOverlays={textOverlays}
      currentTime={5}
      selectedRegionId={selectedRegionId}
    />,
  );
}

describe('TextOverlayPreview — multiple elements in ONE region render SIMULTANEOUSLY (T6630 round 4)', () => {
  it('THE BUG THIS FIXES: two elements in the same region both render at once, not just the second', () => {
    const r = region('r1', [element('a', 'FIRST', true), element('b', 'SECOND', true)]);
    renderPreview([r]);
    expect(screen.getByText('FIRST')).toBeTruthy();
    expect(screen.getByText('SECOND')).toBeTruthy();
  });

  it('each element gets its own data-testid so distinct on-screen positions can be asserted', () => {
    const r = region('r1', [element('a', 'FIRST', true), element('b', 'SECOND', true)]);
    renderPreview([r]);
    expect(screen.getByTestId('text-preview-element-a')).toBeTruthy();
    expect(screen.getByTestId('text-preview-element-b')).toBeTruthy();
  });

  it('elements from a DIFFERENT (inactive) region do not render alongside an active region\'s elements', () => {
    const active = region('r1', [element('a', 'ACTIVE', true)], 0, 10);
    const inactive = region('r2', [element('b', 'INACTIVE', true)], 20, 30);
    renderPreview([active, inactive]); // currentTime=5, inside r1's window only
    expect(screen.getByText('ACTIVE')).toBeTruthy();
    expect(screen.queryByText('INACTIVE')).toBeNull();
  });
});

describe('TextOverlayPreview — eye toggle hides one ELEMENT, not the whole region (T6620 + T6630 round 4)', () => {
  it('hides a disabled element whose region is in range', () => {
    const r = region('r1', [element('a', 'HIDE ME', false)]);
    renderPreview([r]);
    expect(screen.queryByText('HIDE ME')).toBeNull();
  });

  it('hides a disabled element EVEN when its region is selected', () => {
    // The core bug: the selected-region short-circuit used to render regardless
    // of `enabled`, so clicking the eye on the element you were editing never hid it.
    const r = region('r1', [element('a', 'SELECTED HIDDEN', false)]);
    renderPreview([r], 'r1');
    expect(screen.queryByText('SELECTED HIDDEN')).toBeNull();
  });

  it('shows an enabled element in range', () => {
    const r = region('r1', [element('a', 'VISIBLE', true)]);
    renderPreview([r]);
    expect(screen.getByText('VISIBLE')).toBeTruthy();
  });

  it('shows a DB-loaded element with enabled === undefined (never toggled)', () => {
    const r = region('r1', [element('a', 'UNDEFINED SHOWS')]);
    renderPreview([r]);
    expect(screen.getByText('UNDEFINED SHOWS')).toBeTruthy();
  });

  it('shows a selected region\'s enabled element even when the playhead is outside its range', () => {
    const r = region('r1', [element('a', 'EDIT OUT OF RANGE', true)], 20, 30);
    renderPreview([r], 'r1');
    expect(screen.getByText('EDIT OUT OF RANGE')).toBeTruthy();
  });

  it('one disabled element does not hide its enabled sibling in the SAME region', () => {
    const r = region('r1', [element('a', 'HIDDEN', false), element('b', 'STILL SHOWS', true)]);
    renderPreview([r]);
    expect(screen.queryByText('HIDDEN')).toBeNull();
    expect(screen.getByText('STILL SHOWS')).toBeTruthy();
  });
});
