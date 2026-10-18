import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import Guide from './Guide';
import { resolveGuide, homeFacts } from './resolveGuide';
import { useSettingsStore } from '../../stores/settingsStore';

afterEach(() => { cleanup(); vi.restoreAllMocks(); useSettingsStore.getState().reset(); });

const PANEL = { left: 600, right: 1000, top: 100, bottom: 700, width: 400, height: 600 };
const DROPZONE = { left: 620, right: 980, top: 300, bottom: 420, width: 360, height: 120 };

function mockLayout(viewportWidth, rects = {}) {
  window.innerWidth = viewportWidth;
  window.innerHeight = 900;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
    if (this.hasAttribute('data-guide-panel')) return rects.panel ?? PANEL;
    if (this.getAttribute('data-testid') === 'upload-dropzone') return rects.dropzone ?? DROPZONE;
    return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 };
  });
}

function Dialog() {
  const guide = resolveGuide(homeFacts({ modal: 'choose' }));
  return (
    <div data-guide-panel>
      <div data-testid="upload-dropzone"><Guide guide={guide} inline beside testId="upload-guide" /></div>
    </div>
  );
}

describe('Guide beside (upload dialog)', () => {
  it('on a wide screen the card leaves the dialog and sits to its right, level with the dropzone', () => {
    mockLayout(1600);
    render(<Dialog />);
    const card = screen.getByTestId('beside-guide');
    expect(screen.getByTestId('upload-dropzone').contains(card)).toBe(false);
    expect(card.parentElement).toBe(document.body);
    expect(card.dataset.side).toBe('right');
    expect(card.style.left).toBe('1012px');
    expect(card.style.top).toBe('300px');
    expect(card.contains(screen.getByTestId('upload-guide'))).toBe(true);
  });

  it('uses the left side when the right has no room', () => {
    mockLayout(1200);
    render(<Dialog />);
    expect(screen.getByTestId('beside-guide').dataset.side).toBe('left');
  });

  it('stays inline in the dialog on a phone (no room beside it)', () => {
    mockLayout(390, { panel: { left: 12, right: 378, top: 100, bottom: 700, width: 366, height: 600 } });
    render(<Dialog />);
    expect(screen.queryByTestId('beside-guide')).toBeNull();
    expect(screen.getByTestId('upload-dropzone').contains(screen.getByTestId('upload-guide'))).toBe(true);
  });

  it('Got it dismisses the beside card', () => {
    mockLayout(1600);
    render(<Dialog />);
    fireEvent.click(screen.getByTestId('guide-got-it'));
    expect(screen.queryByTestId('beside-guide')).toBeNull();
  });
});
