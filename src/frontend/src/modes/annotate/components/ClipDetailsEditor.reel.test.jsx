import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ClipDetailsEditor } from './ClipDetailsEditor';

// jsdom lacks matchMedia; ClipDetailsEditor renders through the real useIsMobile hook.
// matches:false => desktop, where the Reel button renders.
beforeEach(() => {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
});

const baseRegion = {
  id: 'c1',
  startTime: 0,
  endTime: 10,
  rating: 4,
  tags: [],
  notes: '',
  name: 'Test clip',
};

// T8040: once a reel exists for a clip (region.autoProjectId), the dead-end
// disabled "Reel Created" button is replaced with an actionable "Focus"
// button that opens that reel directly.
describe('ClipDetailsEditor — Reel button (T8040)', () => {
  it('shows an enabled "Create Reel" button when no reel exists yet', () => {
    render(<ClipDetailsEditor region={{ ...baseRegion, autoProjectId: null }} onUpdate={() => {}} onDelete={() => {}} />);
    const button = screen.getByRole('button', { name: 'Create Reel' });
    expect(button.disabled).toBe(false);
  });

  it('clicking "Create Reel" fires onUpdate({ createProject: true }) and shows a disabled transitional state while the request is in flight', () => {
    const onUpdate = vi.fn();
    render(<ClipDetailsEditor region={{ ...baseRegion, autoProjectId: null }} onUpdate={onUpdate} onDelete={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create Reel' }));
    expect(onUpdate).toHaveBeenCalledWith({ createProject: true });
    const button = screen.getByRole('button', { name: 'Reel Created' });
    expect(button.disabled).toBe(true);
  });

  it('shows an enabled "Focus" button once region.autoProjectId is set, not a disabled "Reel Created"', () => {
    render(<ClipDetailsEditor region={{ ...baseRegion, autoProjectId: 42 }} onUpdate={() => {}} onDelete={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Reel Created' })).toBeNull();
    const button = screen.getByRole('button', { name: 'Focus' });
    expect(button.disabled).toBe(false);
  });

  it('clicking "Focus" calls onOpenInFocus with the clip\'s autoProjectId', () => {
    const onOpenInFocus = vi.fn();
    render(
      <ClipDetailsEditor
        region={{ ...baseRegion, autoProjectId: 42 }}
        onUpdate={() => {}}
        onDelete={() => {}}
        onOpenInFocus={onOpenInFocus}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Focus' }));
    expect(onOpenInFocus).toHaveBeenCalledTimes(1);
    expect(onOpenInFocus).toHaveBeenCalledWith(42);
  });

  describe('on mobile', () => {
    beforeEach(() => {
      window.matchMedia = (query) => ({
        matches: true,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      });
    });

    it('never renders the Reel control (Create Reel or Focus) — desktop only', () => {
      render(<ClipDetailsEditor region={{ ...baseRegion, autoProjectId: 42 }} onUpdate={() => {}} onDelete={() => {}} />);
      expect(screen.queryByRole('button', { name: 'Focus' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Create Reel' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Reel Created' })).toBeNull();
    });
  });
});
