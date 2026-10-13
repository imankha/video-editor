import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

/**
 * T12670: the Guidance toggle must not collide with the title / mode tabs at
 * 768 and 1024. jsdom has no layout, so this pins the class contract:
 * compact header stays stacked (tabs on their own row) until the desktop
 * branch at 1024, and the desktop header wraps instead of crushing its breadcrumb.
 */
let mobile = true;
vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => mobile }));
vi.mock('./ModeSwitcher', () => ({ ModeSwitcher: () => <div data-testid="mode-switcher-stub" /> }));
vi.mock('../CreditBalance', () => ({ CreditBalance: () => <div /> }));
vi.mock('../SignInButton', () => ({ SignInButton: () => null }));
vi.mock('../InstallButton', () => ({ InstallButton: () => null }));
vi.mock('../instructions/GuidanceToggle', () => ({ default: () => <div data-testid="guidance-stub" /> }));

import { UnifiedHeader } from './UnifiedHeader';

beforeEach(() => cleanup());

describe('T12670: header does not collide with Guidance toggle', () => {
  it('compact header never collapses to one row (tabs would sit under the toggle at 768)', () => {
    const { container } = render(<UnifiedHeader breadcrumbType="Clips" breadcrumbItemName="Play 1" editorMode="framing" />);
    expect(container.firstChild.className).not.toContain('md:flex-row');
    expect(screen.getByRole('group', { name: 'Editor steps' }).className).not.toContain('md:flex');
  });

  it('desktop header wraps and keeps the control cluster unshrunk at 1024', () => {
    mobile = false;
    const { container } = render(<UnifiedHeader breadcrumbType="Clips" breadcrumbItemName="Play 1" editorMode="framing" />);
    mobile = true;
    const header = container.firstChild;
    expect(header.className).toContain('flex-wrap');
    expect(screen.getByTestId('guidance-stub').parentElement.className).toContain('flex-shrink-0');
  });
});
