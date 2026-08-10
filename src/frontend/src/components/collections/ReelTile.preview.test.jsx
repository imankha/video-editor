import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Fine-vs-coarse gating runs through the REAL useTilePreview -> useIsCoarsePointer
// (T6420) — stub matchMedia + flip the pointer type per test. jsdom has no media
// playback, so stub the methods the primitive drives.
let coarsePointer = false;
let playSpy;
let loadSpy;
beforeEach(() => {
  coarsePointer = false;
  window.matchMedia = (query) => ({
    matches: query.includes('pointer: coarse') ? coarsePointer : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
  playSpy = vi.fn().mockResolvedValue(undefined);
  loadSpy = vi.fn();
  HTMLMediaElement.prototype.play = playSpy;
  HTMLMediaElement.prototype.load = loadSpy;
  HTMLMediaElement.prototype.pause = vi.fn();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

import { ReelTile } from './ReelTile';
import { PREVIEW_REVEAL_DELAY_MS, PREVIEW_WARM_DELAY_MS } from '../../hooks/useTilePreview';

const baseProps = () => ({
  download: { id: 42, project_name: 'Nutmeg', aspect_ratio: '9:16' },
  posterUrl: '/api/downloads/42/poster.jpg',
  displayName: 'Nutmeg',
  metaLine: '9:16 - 1 clip',
  unwatchedStyle: { dot: 'bg-cyan-400', border: 'border-cyan-400' },
  onPlay: vi.fn(),
  onWebShare: vi.fn(),
  onCopyLink: vi.fn(),
  onDownload: vi.fn(),
  onBeforeAfter: vi.fn(),
  showBeforeAfter: false,
  onOpenProject: vi.fn(),
  canOpenSource: () => false,
  onMove: vi.fn(),
  canMoveProfiles: false,
  onDelete: vi.fn(),
  onRename: vi.fn(),
});

const renderTile = (overrides = {}) => {
  const props = { ...baseProps(), ...overrides };
  const utils = render(<ReelTile {...props} />);
  return { ...utils, props, video: () => utils.container.querySelector('video') };
};
const EXPECTED_STREAM = '/api/downloads/42/stream';

describe('T6420 ReelTile inline hover preview', () => {
  it('grid at rest: the preview <video> has preload="none" and no src (zero requests)', () => {
    const { video } = renderTile();
    expect(video()).not.toBeNull();
    expect(video().getAttribute('preload')).toBe('none');
    expect(video().getAttribute('src')).toBeNull();
  });

  it('FINE pointer hover: warms (attaches the /stream src) then plays', () => {
    const { video } = renderTile();
    fireEvent.pointerEnter(screen.getByTestId('reel-card'));
    act(() => vi.advanceTimersByTime(PREVIEW_WARM_DELAY_MS));
    expect(video().getAttribute('src')).toBe(EXPECTED_STREAM);
    expect(playSpy).not.toHaveBeenCalled(); // still warming, poster showing
    act(() => vi.advanceTimersByTime(PREVIEW_REVEAL_DELAY_MS - PREVIEW_WARM_DELAY_MS));
    expect(playSpy).toHaveBeenCalled();
  });

  it('COARSE pointer: never attaches a src (touch stays byte-identical, T6430 owns it)', () => {
    coarsePointer = true;
    const { video } = renderTile();
    fireEvent.pointerEnter(screen.getByTestId('reel-card'));
    act(() => vi.advanceTimersByTime(PREVIEW_REVEAL_DELAY_MS * 2));
    expect(video().getAttribute('src')).toBeNull();
    expect(playSpy).not.toHaveBeenCalled();
  });

  it('leave releases the stream (clears src)', () => {
    const { video } = renderTile();
    const card = screen.getByTestId('reel-card');
    fireEvent.pointerEnter(card);
    act(() => vi.advanceTimersByTime(PREVIEW_REVEAL_DELAY_MS));
    expect(video().getAttribute('src')).toBe(EXPECTED_STREAM);
    fireEvent.pointerLeave(card);
    expect(video().getAttribute('src')).toBeNull();
  });

  it('opening the full player (Play) tears down the inline preview AND calls onPlay', () => {
    const { video, props } = renderTile();
    fireEvent.pointerEnter(screen.getByTestId('reel-card'));
    act(() => vi.advanceTimersByTime(PREVIEW_REVEAL_DELAY_MS));
    expect(video().getAttribute('src')).toBe(EXPECTED_STREAM);

    fireEvent.click(screen.getByRole('button', { name: 'Play video' }));
    expect(props.onPlay).toHaveBeenCalled();
    expect(video().getAttribute('src')).toBeNull(); // released before the player opens
  });

  it('the preview is ephemeral: hovering fires NO write/action handlers', () => {
    const { props } = renderTile();
    fireEvent.pointerEnter(screen.getByTestId('reel-card'));
    act(() => vi.advanceTimersByTime(PREVIEW_REVEAL_DELAY_MS));
    // No watched-marking, no share/copy/download/open/delete — preview is read-only.
    expect(props.onPlay).not.toHaveBeenCalled();
    expect(props.onWebShare).not.toHaveBeenCalled();
    expect(props.onCopyLink).not.toHaveBeenCalled();
    expect(props.onDownload).not.toHaveBeenCalled();
    expect(props.onOpenProject).not.toHaveBeenCalled();
    expect(props.onDelete).not.toHaveBeenCalled();
  });
});
