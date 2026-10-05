import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

/**
 * T11740 — class-contract for the compact (mobile) UnifiedHeader. Below `md`
 * (768px) the header is two rows (title block stacked over the editor-step tabs);
 * at `md`+ it collapses back to one row. The row split is pure Tailwind, so these
 * assertions pin the responsive class contract rather than measuring pixels.
 *
 * useIsMobile is forced true so the compact branch renders. The header's heavier
 * children (ModeSwitcher/CreditBalance/SignInButton/InstallButton) are stubbed —
 * this test owns only the header's own layout.
 */

vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => true }));
vi.mock('./ModeSwitcher', () => ({ ModeSwitcher: () => <div data-testid="mode-switcher-stub" /> }));
vi.mock('../CreditBalance', () => ({ CreditBalance: () => <div data-testid="credit-balance-stub" /> }));
vi.mock('../SignInButton', () => ({ SignInButton: () => null }));
vi.mock('../InstallButton', () => ({ InstallButton: () => null }));

import { UnifiedHeader } from './UnifiedHeader';

beforeEach(() => cleanup());

describe('T11740: compact UnifiedHeader class contract', () => {
  it('wraps the header in a column that becomes a row at md+', () => {
    const { container } = render(
      <UnifiedHeader breadcrumbType="Games" breadcrumbItemName="at Oceanside Breakers" editorMode="annotate" />
    );
    const wrapper = container.firstChild;
    expect(wrapper.className).toContain('flex-col');
    expect(wrapper.className).toContain('md:flex-row');
  });

  it('renders the title with line-clamp-2 so a long name wraps to two lines instead of collapsing to 0px', () => {
    render(
      <UnifiedHeader breadcrumbType="Games" breadcrumbItemName="at Oceanside Breakers" editorMode="annotate" />
    );
    const title = screen.getByTestId('editor-header-title');
    expect(title.className).toContain('line-clamp-2');
    expect(title.textContent).toBe('at Oceanside Breakers');
  });

  it('shows a game-name second line on Focus/Spotlight (breadcrumbGameName present)', () => {
    render(
      <UnifiedHeader
        breadcrumbType="Clips"
        breadcrumbItemName="Play 1"
        breadcrumbGameName="at Oceanside Breakers"
        editorMode="framing"
      />
    );
    expect(screen.getByTestId('editor-header-title').textContent).toBe('Play 1');
    expect(screen.getByText('at Oceanside Breakers')).toBeTruthy();
  });

  it('omits the second line on Annotate (no breadcrumbGameName — the title already IS the game name)', () => {
    render(
      <UnifiedHeader breadcrumbType="Games" breadcrumbItemName="at Oceanside Breakers" editorMode="annotate" />
    );
    // Only the title node carries the game name; no separate gray subtitle line.
    expect(screen.getAllByText('at Oceanside Breakers')).toHaveLength(1);
  });

  it('gives the back button a 44px (w-11 h-11) touch target', () => {
    render(<UnifiedHeader breadcrumbType="Games" breadcrumbItemName="Game" editorMode="annotate" />);
    const back = screen.getByTitle('Back');
    expect(back.className).toContain('w-11');
    expect(back.className).toContain('h-11');
  });

  it('lays row 2 (the editor-step tabs) out as a labeled 3-col grid that becomes a flex row at md+', () => {
    render(<UnifiedHeader breadcrumbType="Games" breadcrumbItemName="Game" editorMode="annotate" />);
    // role="group" + aria-label is the a11y contract the three tabs live under.
    const group = screen.getByRole('group', { name: 'Editor steps' });
    expect(group.className).toContain('grid-cols-3'); // equal cells below md
    expect(group.className).toContain('md:flex'); // collapses to one row at md+
  });
});
