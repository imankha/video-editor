import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AnnotateFullscreenOverlay } from './AnnotateFullscreenOverlay';

// T8140: one-tap first clip — form defaults ("Play N" auto-name), platform-aware
// copy, reassurance line, the mobile no-amber rule, and the add_clip_opened_no_save
// abandonment beacon.

const recordUiImpression = vi.fn();
vi.mock('../../../utils/uiTelemetry', () => ({
  recordUiImpression: (...args) => recordUiImpression(...args),
}));

// jsdom lacks matchMedia; the overlay renders through the real useIsMobile hook.
function mockViewport(matches) {
  window.matchMedia = (query) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}

beforeEach(() => {
  recordUiImpression.mockClear();
  mockViewport(false); // desktop by default
});

const baseProps = {
  isVisible: true,
  currentTime: 30,
  videoDuration: 6000,
  onCreateClip: () => {},
  onUpdateClip: () => {},
  onResume: () => {},
  onClose: () => {},
  onSeek: () => {},
  videoController: {},
  // T8600: required render-site discriminator for the abandonment beacon.
  // Default layout (no `layout` prop) is the desktop fullscreen dock.
  surface: 'dock_fullscreen',
};

const saveButton = (container) => container.querySelector('button.bg-green-600');

describe('AnnotateFullscreenOverlay — one-tap defaults (T8140)', () => {
  it('a nameless new clip saves with the "Play N" default name in one tap', () => {
    const onCreateClip = vi.fn();
    const { container } = render(
      <AnnotateFullscreenOverlay {...baseProps} onCreateClip={onCreateClip} nextClipNumber={3} />
    );
    // No typing, no field changes — just Save.
    fireEvent.click(saveButton(container));
    expect(onCreateClip).toHaveBeenCalledTimes(1);
    expect(onCreateClip.mock.calls[0][0]).toMatchObject({ name: 'Play 3' });
  });

  it('the "Play N" default is memory-only until Save (never written on open)', () => {
    const onCreateClip = vi.fn();
    render(<AnnotateFullscreenOverlay {...baseProps} onCreateClip={onCreateClip} nextClipNumber={1} />);
    // Opening the form does not create a clip.
    expect(onCreateClip).not.toHaveBeenCalled();
  });

  it('a manually typed name overrides the "Play N" default', () => {
    const onCreateClip = vi.fn();
    const { container } = render(
      <AnnotateFullscreenOverlay {...baseProps} onCreateClip={onCreateClip} nextClipNumber={2} />
    );
    fireEvent.change(screen.getByPlaceholderText('Enter clip name...'), { target: { value: 'My banger' } });
    fireEvent.click(saveButton(container));
    expect(onCreateClip.mock.calls[0][0]).toMatchObject({ name: 'My banger' });
  });

  it('shows the reassurance line in create mode only', () => {
    const { rerender } = render(<AnnotateFullscreenOverlay {...baseProps} />);
    expect(screen.getByText('You can change all of this later.')).toBeTruthy();
    rerender(
      <AnnotateFullscreenOverlay
        {...baseProps}
        existingClip={{ id: 'c1', startTime: 0, endTime: 10, rating: 4, tags: [] }}
      />
    );
    expect(screen.queryByText('You can change all of this later.')).toBeNull();
  });
});

describe('AnnotateFullscreenOverlay — platform-aware rating copy (T8140)', () => {
  it('desktop keeps the "(press 1-5)" keyboard hint', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} />);
    expect(screen.getByText('Rating (press 1-5)')).toBeTruthy();
  });

  it('mobile drops the keyboard hint', () => {
    mockViewport(true);
    render(<AnnotateFullscreenOverlay {...baseProps} />);
    expect(screen.queryByText('Rating (press 1-5)')).toBeNull();
    expect(screen.getByText('Rating')).toBeTruthy();
  });
});

describe('AnnotateFullscreenOverlay — no amber no_sport wall on mobile (T8140)', () => {
  it('mobile no_sport create form shows no amber "Pick your sport" prompt', () => {
    mockViewport(true);
    render(<AnnotateFullscreenOverlay {...baseProps} />);
    // Default profile is no_sport; on mobile the amber picker is replaced by the
    // full-screen question (fired elsewhere), so it must not render in-form.
    expect(screen.queryByText('Pick your sport to tag this clip')).toBeNull();
  });

  it('desktop no_sport create form keeps the in-form picker (T7922 preserved)', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} />);
    expect(screen.getByText('Pick your sport to tag this clip')).toBeTruthy();
  });
});

describe('AnnotateFullscreenOverlay — abandonment beacon (T8140)', () => {
  it('fires add_clip_opened_no_save once when a create-open closes without a save', () => {
    const { rerender } = render(<AnnotateFullscreenOverlay {...baseProps} isVisible={true} />);
    expect(recordUiImpression).not.toHaveBeenCalled();
    rerender(<AnnotateFullscreenOverlay {...baseProps} isVisible={false} />);
    expect(recordUiImpression).toHaveBeenCalledTimes(1);
    expect(recordUiImpression).toHaveBeenCalledWith('dialog', 'add_clip_opened_no_save:dock_fullscreen');
  });

  it('does NOT fire when the open ends in a save', () => {
    const { container, rerender } = render(
      <AnnotateFullscreenOverlay {...baseProps} isVisible={true} onCreateClip={() => {}} />
    );
    fireEvent.click(saveButton(container));
    rerender(<AnnotateFullscreenOverlay {...baseProps} isVisible={false} />);
    expect(recordUiImpression).not.toHaveBeenCalled();
  });

  it('does NOT fire for an edit-mode open', () => {
    const clip = { id: 'c1', startTime: 0, endTime: 10, rating: 4, tags: [] };
    const { rerender } = render(<AnnotateFullscreenOverlay {...baseProps} isVisible={true} existingClip={clip} />);
    rerender(<AnnotateFullscreenOverlay {...baseProps} isVisible={false} existingClip={clip} />);
    expect(recordUiImpression).not.toHaveBeenCalled();
  });
});

// T8600 §2.5: `surface` is a required, no-silent-fallback discriminator so a
// missed render site shows up as its own distinct row instead of quietly
// polluting a real surface's count.
describe('AnnotateFullscreenOverlay — beacon surface discriminator (T8600)', () => {
  it('interpolates the given surface into the beacon name', () => {
    const { rerender } = render(<AnnotateFullscreenOverlay {...baseProps} surface="sheet_mobile" isVisible={true} />);
    rerender(<AnnotateFullscreenOverlay {...baseProps} surface="sheet_mobile" isVisible={false} />);
    expect(recordUiImpression).toHaveBeenCalledWith('dialog', 'add_clip_opened_no_save:sheet_mobile');
  });

  it('falls back to :unknown_surface and warns when surface is missing (no silent fallback)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { rerender } = render(<AnnotateFullscreenOverlay {...baseProps} surface={undefined} isVisible={true} />);
    rerender(<AnnotateFullscreenOverlay {...baseProps} surface={undefined} isVisible={false} />);
    expect(recordUiImpression).toHaveBeenCalledWith('dialog', 'add_clip_opened_no_save:unknown_surface');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
