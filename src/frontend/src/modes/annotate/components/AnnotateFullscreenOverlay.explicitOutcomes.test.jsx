import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { AnnotateFullscreenOverlay } from './AnnotateFullscreenOverlay';

// T9830: create mode offers two explicit, always-visible outcomes —
// "Create an editable clip" (makes a draft) and "Save play" (no draft/render/
// credits) — replacing the rating-driven default + toggle + label-switching
// single Save button. These tests pin the brief's acceptance criteria.

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

describe('AnnotateFullscreenOverlay — explicit create outcomes (T9830)', () => {
  it('AC1: unrated / 4-star / 5-star all show the SAME two enabled buttons', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} onCreateClip={() => {}} newClipLayerIsMine />);
    const both = () => [
      screen.getByRole('button', { name: 'Create an editable clip' }),
      screen.getByRole('button', { name: 'Save play' }),
    ];
    both().forEach((b) => expect(b.disabled).toBe(false));
    fireEvent.keyDown(window, { key: '5' }); // 5-star
    both().forEach((b) => expect(b.disabled).toBe(false));
    fireEvent.keyDown(window, { key: '1' }); // low rating
    both().forEach((b) => expect(b.disabled).toBe(false));
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

  it('AC3: "Create an editable clip" saves createProject=true with an EMPTY form (no rating/sport/tags/notes required)', async () => {
    const onCreateClip = vi.fn(() => Promise.resolve({ raw_clip_id: 2, project_created: true }));
    // Default profile is no_sport; no tags, no notes, no manual name.
    render(<AnnotateFullscreenOverlay {...baseProps} onCreateClip={onCreateClip} nextClipNumber={9} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create an editable clip' }));
    });
    expect(onCreateClip).toHaveBeenCalledTimes(1);
    expect(onCreateClip.mock.calls[0][0]).toMatchObject({ createProject: true, tags: [], notes: '' });
  });

  it('AC4 (double-click): a second click while the save is in flight is a no-op (one create, not two)', async () => {
    const { promise, resolve } = deferred();
    const onCreateClip = vi.fn(() => promise);
    render(<AnnotateFullscreenOverlay {...baseProps} onCreateClip={onCreateClip} />);
    const btn = screen.getByRole('button', { name: 'Create an editable clip' });
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

describe('AnnotateFullscreenOverlay — both outcomes on every layout (T9830)', () => {
  it('the desktop strip create mode shows both buttons', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} onCreateClip={() => {}} layout="strip" surface="inline_desktop" />);
    expect(screen.getByRole('button', { name: 'Create an editable clip' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save play' })).toBeTruthy();
  });

  it('the mobile inline sheet create mode shows both buttons', () => {
    mockViewport(true);
    render(<AnnotateFullscreenOverlay {...baseProps} onCreateClip={() => {}} layout="inline" surface="sheet_mobile" />);
    expect(screen.getByRole('button', { name: 'Create an editable clip' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save play' })).toBeTruthy();
  });

  it('the landscape-inline bar create mode shows both buttons', () => {
    mockViewport(true);
    render(<AnnotateFullscreenOverlay {...baseProps} onCreateClip={() => {}} layout="landscape-inline" surface="fullscreen_mobile" />);
    expect(screen.getByRole('button', { name: 'Create an editable clip' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save play' })).toBeTruthy();
  });
});
