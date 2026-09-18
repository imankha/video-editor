import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { AnnotateFullscreenOverlay } from './AnnotateFullscreenOverlay';

// T9830/T10290: create mode used to offer two explicit, always-visible
// outcomes — "Save play" and "Save and Frame" — replacing the rating-driven
// default + toggle + label-switching single Save button, and T9830's "Create
// an editable clip". T10310 (2026-09-18 user request): "Save and Frame" moved
// OUT of the editor entirely onto the main Annotate screen's split [Edit
// Play]/[Frame Clip] row (AnnotateModeView) — this editor now has exactly one
// always-visible, always-enabled save outcome.

function mockViewport(matches) {
  window.matchMedia = (query) => ({
    matches, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  });
}

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

beforeEach(() => mockViewport(false)); // desktop

const baseProps = {
  isVisible: true,
  currentTime: 30,
  videoDuration: 6000,
  onUpdateClip: () => {},
  onResume: () => {},
  onClose: () => {},
  onSeek: () => {},
  videoController: {},
  surface: 'dock_fullscreen',
};

describe('AnnotateFullscreenOverlay — the one explicit create outcome (T9830, T10310)', () => {
  it('AC1: unrated / 4-star / 5-star all show the SAME single enabled Save button', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} onCreateClip={() => {}} newClipLayerIsMine />);
    const save = () => screen.getByRole('button', { name: 'Save play' });
    expect(save().disabled).toBe(false);
    fireEvent.keyDown(window, { key: '5' }); // 5-star
    expect(save().disabled).toBe(false);
    fireEvent.keyDown(window, { key: '1' }); // low rating
    expect(save().disabled).toBe(false);
    // "Save and Frame" moved out to the main screen -- never rendered here.
    expect(screen.queryByRole('button', { name: 'Save and Frame' })).toBeNull();
  });

  it('AC2: "Save play" saves the play with NO project (createProject false)', async () => {
    const onCreateClip = vi.fn(() => Promise.resolve({ raw_clip_id: 1 }));
    render(<AnnotateFullscreenOverlay {...baseProps} onCreateClip={onCreateClip} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save play' }));
    });
    expect(onCreateClip).toHaveBeenCalledTimes(1);
    expect(onCreateClip.mock.calls[0][0].createProject).toBe(false);
  });

  it('AC4 (double-click): a second click while the save is in flight is a no-op (one create, not two)', async () => {
    const { promise, resolve } = deferred();
    const onCreateClip = vi.fn(() => promise);
    render(<AnnotateFullscreenOverlay {...baseProps} onCreateClip={onCreateClip} />);
    const btn = screen.getByRole('button', { name: 'Save play' });
    await act(async () => {
      fireEvent.click(btn); // starts the save (promise pending)
      fireEvent.click(btn); // in-flight guard must swallow this one
    });
    expect(onCreateClip).toHaveBeenCalledTimes(1);
    await act(async () => { resolve({ raw_clip_id: 2 }); });
  });

  it('a fresh Save is possible again after a prior save settles (guard released)', async () => {
    const onCreateClip = vi.fn(() => Promise.resolve({ raw_clip_id: 3 }));
    render(<AnnotateFullscreenOverlay {...baseProps} onCreateClip={onCreateClip} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save play' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save play' }));
    });
    expect(onCreateClip).toHaveBeenCalledTimes(2);
  });
});

describe('AnnotateFullscreenOverlay — one save outcome, no Save and Frame, on every layout (T10310)', () => {
  it('the desktop strip create mode shows only Save play', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} onCreateClip={() => {}} layout="strip" surface="inline_desktop" />);
    expect(screen.getByRole('button', { name: 'Save play' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save and Frame' })).toBeNull();
  });

  it('the mobile inline sheet create mode shows only Save play', () => {
    mockViewport(true);
    render(<AnnotateFullscreenOverlay {...baseProps} onCreateClip={() => {}} layout="inline" surface="sheet_mobile" />);
    expect(screen.getByRole('button', { name: 'Save play' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save and Frame' })).toBeNull();
  });

  it('the landscape-inline bar create mode shows only Save play', () => {
    mockViewport(true);
    render(<AnnotateFullscreenOverlay {...baseProps} onCreateClip={() => {}} layout="landscape-inline" surface="fullscreen_mobile" />);
    expect(screen.getByRole('button', { name: 'Save play' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save and Frame' })).toBeNull();
  });
});
