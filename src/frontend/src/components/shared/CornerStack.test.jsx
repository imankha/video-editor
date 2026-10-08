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

  it('keeps Guidance as an in-flow chip (not fixed) inside the editor header', () => {
    useAuthStore.setState({ isAuthenticated: true });
    render(<UnifiedHeader breadcrumbType="Games" editorMode="annotate" />);
    const toggle = screen.getByTestId('guidance-toggle');
    expect(toggle.closest('[data-testid="editor-header"], .mb-8')).not.toBeNull();
    expect(toggle.closest('.fixed')).toBeNull();
  });

  it('GuidanceToggle chip meets the 44px touch target', () => {
    useAuthStore.setState({ isAuthenticated: true });
    render(<GuidanceToggle />);
    expect(screen.getByTestId('guidance-toggle').className).toMatch(/min-h-11/);
  });
});
