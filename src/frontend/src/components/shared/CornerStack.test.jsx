import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

/**
 * T11950: the bottom-right corner is ONE fixed flex-col-reverse stack. Report is the
 * first child (bottom), toasts sit above it, so they can never overlap. The Guidance
 * switch is an in-flow header chip, never a floating layer over content.
 */
vi.mock('../../utils/apiFetch', () => ({ default: (...args) => fetch(...args) }));
vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('./ModeSwitcher', () => ({ ModeSwitcher: () => null }));
vi.mock('../CreditBalance', () => ({ CreditBalance: () => null }));
vi.mock('../SignInButton', () => ({ SignInButton: () => null }));
vi.mock('../InstallButton', () => ({ InstallButton: () => null }));

import { CornerStack } from './CornerStack';
import { ToastContainer, useToastStore } from './Toast';
import GuidanceToggle from '../instructions/GuidanceToggle';
import { UnifiedHeader } from './UnifiedHeader';
import { useAuthStore } from '../../stores/authStore';

afterEach(() => { cleanup(); useToastStore.setState({ toasts: [] }); });

describe('T11950 corner stack', () => {
  it('stacks toasts above Report in a single fixed column', () => {
    useToastStore.setState({ toasts: [{ id: 1, type: 'success', title: 'Highlight ready' }] });
    render(<CornerStack><button data-testid="report">Report</button><ToastContainer stacked /></CornerStack>);
    const stack = screen.getByTestId('corner-stack');
    expect(stack.className).toContain('fixed');
    expect(stack.className).toContain('flex-col-reverse');
    expect(stack.children[0]).toBe(screen.getByTestId('report'));
    expect(stack.contains(screen.getByText('Highlight ready'))).toBe(true);
    // the stacked toast list must not pin itself independently
    expect(screen.getByText('Highlight ready').closest('.fixed')).toBe(stack);
  });

  it('keeps the Guidance place in the editor header with an in-flow slot; the switch itself is pinned above modals', () => {
    useAuthStore.setState({ isAuthenticated: true });
    const { container } = render(<UnifiedHeader breadcrumbType="Games" editorMode="annotate" />);
    const slot = container.querySelector('.invisible.flex-shrink-0');
    expect(slot).not.toBeNull();
    expect(slot.closest('[data-testid="editor-header"], .mb-8')).not.toBeNull();
    expect(slot.closest('.fixed')).toBeNull();
    expect(screen.getByTestId('guidance-toggle').closest('[data-testid="guidance-toggle-layer"]').className).toContain('fixed');
  });

  it('GuidanceToggle chip meets the 44px touch target', () => {
    useAuthStore.setState({ isAuthenticated: true });
    render(<GuidanceToggle />);
    expect(screen.getByTestId('guidance-toggle').className).toMatch(/min-h-11/);
  });

  // T15740: a static `bottom-20` cleared an ordinary action band, but Focus's short-
  // desktop "above" row (Trim/SlowMo) can push the band well past 80px tall -- the
  // stack must track the band's REAL published height (--cta-bar-h), not a guess.
  // Real-browser geometry evidence: e2e/checks/T15740.check.spec.js.
  it('offsets the corner stack by the live --cta-bar-h, not a static guess (T15740)', () => {
    render(<CornerStack><button data-testid="report">Report</button></CornerStack>);
    const stack = screen.getByTestId('corner-stack');
    expect(stack.className).toContain('bottom-[calc(var(--cta-bar-h,0px)+1rem)]');
    expect(stack.className).toContain('lg:bottom-[calc(var(--cta-bar-h,0px)+5rem)]');
  });
});
