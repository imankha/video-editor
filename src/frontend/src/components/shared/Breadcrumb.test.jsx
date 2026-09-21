import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

/**
 * 2026-09-20 (user request): the in-match game clock previously lived in Overlay's
 * own dedicated "clip identity" card. That card duplicated the breadcrumb's title +
 * game name, so it was deleted (OverlayModeView.clipIdentity.test.jsx) and the one
 * datum unique to it — the game clock — moved onto this existing row instead, as a
 * de-emphasized `itemMeta` trailing the clip name.
 */

import { Breadcrumb } from './Breadcrumb';

describe('Breadcrumb itemMeta (2026-09-20)', () => {
  it('renders itemMeta after itemName when provided', () => {
    render(
      <Breadcrumb type="Clips" gameName="Vs Carlsbad Game Sep 1" itemName="Play 4" itemMeta={"0'26\""} />
    );
    expect(screen.getByText('Play 4')).toBeTruthy();
    expect(screen.getByText(/0'26"/)).toBeTruthy();
  });

  it('omits the meta segment entirely when not provided (e.g. multi-clip reels)', () => {
    render(<Breadcrumb type="Clips" gameName="Vs Carlsbad Game Sep 1" itemName="Play 4" />);
    expect(screen.getByText('Play 4')).toBeTruthy();
    expect(screen.queryByText(/0'26"/)).toBeNull();
  });

  it('never renders itemMeta without itemName', () => {
    render(<Breadcrumb type="Clips" itemMeta={"0'26\""} />);
    expect(screen.queryByText(/0'26"/)).toBeNull();
  });
});
