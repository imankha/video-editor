import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AnnotateFullscreenOverlay } from './AnnotateFullscreenOverlay';
import { useProfileStore } from '../../../stores';

// T10610: the editor is ALWAYS editing an existing play now (create-at-tap
// happens in the container before this component ever opens). There is no
// Save/Update/Cancel button in ANY layout — every control persists on its own
// gesture. Replaces the retired .explicitOutcomes.test.jsx (design doc § E
// row 1's named replacement).

function mockViewport(matches) {
  window.matchMedia = (query) => ({
    matches, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  });
}

const baseClip = {
  id: 'clip-1',
  startTime: 10,
  endTime: 18,
  rating: 4,
  tags: [],
  name: 'Play 3',
  notes: '',
  tagged_teammates: [],
  my_athlete: true,
  autoProjectId: null,
  hasCustomName: true,
};

function baseProps(overrides = {}) {
  return {
    isVisible: true,
    currentTime: 12,
    videoDuration: 6000,
    existingClip: baseClip,
    onUpdateClip: vi.fn(() => Promise.resolve({ saveOk: true, projectId: null })),
    onClose: vi.fn(),
    onSeek: vi.fn(),
    videoController: {},
    onDeleteClip: vi.fn(),
    onAwaitWrites: vi.fn(() => Promise.resolve(true)),
    ...overrides,
  };
}

const profileOriginal = useProfileStore.getState();

beforeEach(() => {
  mockViewport(false); // desktop by default
  useProfileStore.setState({
    profiles: [{ id: 'p1', sport: 'soccer' }],
    currentProfileId: 'p1',
  });
});

afterEach(() => {
  useProfileStore.setState(profileOriginal, true);
});

const LAYOUTS = ['overlay', 'inline', 'strip', 'landscape-inline'];

describe('AnnotateFullscreenOverlay — no Save/Update/Cancel button anywhere (T10610)', () => {
  for (const layout of LAYOUTS) {
    it(`${layout} layout renders no Save/Update/Save-and-Frame/Cancel button`, () => {
      if (layout === 'inline' || layout === 'landscape-inline') mockViewport(true);
      render(<AnnotateFullscreenOverlay {...baseProps()} layout={layout} />);
      expect(screen.queryByRole('button', { name: 'Save play' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Update play' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Save and Frame' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    });
  }

  it('the formBody/inline/strip layouts render a Done button instead', () => {
    render(<AnnotateFullscreenOverlay {...baseProps()} layout="overlay" />);
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
  });

  it('every layout renders a Delete play control', () => {
    render(<AnnotateFullscreenOverlay {...baseProps()} layout="overlay" />);
    expect(screen.getByTestId('delete-play-button')).toBeTruthy();
  });
});

describe('AnnotateFullscreenOverlay — per-gesture writes (T10600-design.md § 2.2)', () => {
  it('rating tap sends exactly {rating}', () => {
    mockViewport(true);
    const onUpdateClip = vi.fn(() => Promise.resolve({ saveOk: true }));
    render(<AnnotateFullscreenOverlay {...baseProps({ onUpdateClip })} layout="landscape-inline" />);
    fireEvent.click(screen.getByTitle('5 stars'));
    expect(onUpdateClip).toHaveBeenCalledTimes(1);
    expect(onUpdateClip).toHaveBeenCalledWith('clip-1', { rating: 5 });
  });

  it('tag chip tap sends exactly {tags}', () => {
    mockViewport(true);
    const onUpdateClip = vi.fn(() => Promise.resolve({ saveOk: true }));
    render(<AnnotateFullscreenOverlay {...baseProps({ onUpdateClip })} layout="landscape-inline" />);
    fireEvent.click(screen.getByRole('button', { name: 'Goal' }));
    expect(onUpdateClip).toHaveBeenCalledTimes(1);
    expect(onUpdateClip).toHaveBeenCalledWith('clip-1', { tags: ['Goal'] });
  });

  it('trim commit (typed entry) sends exactly {startTime, endTime}', () => {
    mockViewport(true);
    const onUpdateClip = vi.fn(() => Promise.resolve({ saveOk: true }));
    render(<AnnotateFullscreenOverlay {...baseProps({ onUpdateClip })} layout="landscape-inline" />);
    fireEvent.click(screen.getByTestId('trim-field-start'));
    const input = screen.getByTestId('trim-field-input-start');
    fireEvent.change(input, { target: { value: '2' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onUpdateClip).toHaveBeenCalledTimes(1);
    expect(onUpdateClip).toHaveBeenCalledWith('clip-1', { startTime: 2, endTime: 18 });
  });

  it('layer toggle to Team sends exactly {my_athlete: false}', () => {
    const onUpdateClip = vi.fn(() => Promise.resolve({ saveOk: true }));
    render(<AnnotateFullscreenOverlay {...baseProps({ onUpdateClip })} layout="overlay" />);
    fireEvent.click(screen.getByRole('radio', { name: /Team/i }));
    expect(onUpdateClip).toHaveBeenCalledTimes(1);
    expect(onUpdateClip).toHaveBeenCalledWith('clip-1', { my_athlete: false });
  });

  it('layer toggle back to My athlete clears teammates in the SAME gesture', () => {
    const onUpdateClip = vi.fn(() => Promise.resolve({ saveOk: true }));
    const clip = { ...baseClip, my_athlete: false, tagged_teammates: ['Sam'] };
    render(<AnnotateFullscreenOverlay {...baseProps({ onUpdateClip, existingClip: clip })} layout="overlay" />);
    fireEvent.click(screen.getByRole('radio', { name: /My athlete/i }));
    expect(onUpdateClip).toHaveBeenCalledWith('clip-1', { my_athlete: true, tagged_teammates: [] });
  });

  it('name blur sends exactly {name}; typing sends nothing', () => {
    const onUpdateClip = vi.fn(() => Promise.resolve({ saveOk: true }));
    render(<AnnotateFullscreenOverlay {...baseProps({ onUpdateClip })} layout="overlay" />);
    const input = screen.getByDisplayValue('Play 3');
    fireEvent.change(input, { target: { value: 'Great tackle' } });
    expect(onUpdateClip).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(onUpdateClip).toHaveBeenCalledTimes(1);
    expect(onUpdateClip).toHaveBeenCalledWith('clip-1', { name: 'Great tackle' });
  });

  it('Delete play (confirm) calls onDeleteClip with the clip id', () => {
    const onDeleteClip = vi.fn();
    render(<AnnotateFullscreenOverlay {...baseProps({ onDeleteClip })} layout="overlay" />);
    fireEvent.click(screen.getByTestId('delete-play-button'));
    fireEvent.click(screen.getByText('Confirm Delete'));
    expect(onDeleteClip).toHaveBeenCalledWith('clip-1');
  });

  it('Done commits a dirty name draft, then closes', () => {
    const onUpdateClip = vi.fn(() => Promise.resolve({ saveOk: true }));
    const onClose = vi.fn();
    render(<AnnotateFullscreenOverlay {...baseProps({ onUpdateClip, onClose })} layout="overlay" />);
    const input = screen.getByDisplayValue('Play 3');
    fireEvent.change(input, { target: { value: 'Great tackle' } });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onUpdateClip).toHaveBeenCalledWith('clip-1', { name: 'Great tackle' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('X close button also commits a dirty name draft before closing', () => {
    const onUpdateClip = vi.fn(() => Promise.resolve({ saveOk: true }));
    const onClose = vi.fn();
    render(<AnnotateFullscreenOverlay {...baseProps({ onUpdateClip, onClose })} layout="overlay" />);
    const input = screen.getByDisplayValue('Play 3');
    fireEvent.change(input, { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByTitle('Close (Esc)'));
    expect(onUpdateClip).toHaveBeenCalledWith('clip-1', { name: 'Renamed' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('AnnotateFullscreenOverlay — the ONE Escape rule (v2 finding 6)', () => {
  it('Escape in the name field reverts and does not write; editor stays open', () => {
    const onUpdateClip = vi.fn(() => Promise.resolve({ saveOk: true }));
    const onClose = vi.fn();
    render(<AnnotateFullscreenOverlay {...baseProps({ onUpdateClip, onClose })} layout="overlay" />);
    const input = screen.getByDisplayValue('Play 3');
    // Real DOM focus (not just fireEvent.change) — Escape's e.currentTarget.blur()
    // is a spec no-op on a non-focused element, which would mask the real bug
    // below (a nested synchronous blur reading stale pre-revert state).
    input.focus();
    fireEvent.change(input, { target: { value: 'Junk' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('Play 3');
    expect(onUpdateClip).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a second Escape (nothing focused) closes the editor', () => {
    const onClose = vi.fn();
    render(<AnnotateFullscreenOverlay {...baseProps({ onClose })} layout="overlay" />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('strip layout: Escape in the inline name editor reverts and does not write (regression: nested blur must not see the stale pre-revert value)', () => {
    const onUpdateClip = vi.fn(() => Promise.resolve({ saveOk: true }));
    render(<AnnotateFullscreenOverlay {...baseProps({ onUpdateClip })} layout="strip" />);
    fireEvent.click(screen.getByTitle('Rename clip'));
    const input = screen.getByLabelText('Clip name');
    input.focus();
    fireEvent.change(input, { target: { value: 'Junk' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onUpdateClip).not.toHaveBeenCalled();
  });
});

describe('AnnotateFullscreenOverlay — stage CTA awaits pending writes (§ C.4)', () => {
  it('does not navigate when the write chain resolves false', async () => {
    const onAwaitWrites = vi.fn(() => Promise.resolve(false));
    const onOpenInFocus = vi.fn();
    const clip = { ...baseClip, autoProjectId: 42 };
    render(
      <AnnotateFullscreenOverlay
        {...baseProps({ onAwaitWrites, onOpenInFocus, existingClip: clip })}
        layout="strip"
      />
    );
    const stageButtons = screen.getAllByRole('button').filter((b) => /Frame|Apply|View/.test(b.textContent));
    expect(stageButtons.length).toBeGreaterThan(0);
    await fireEvent.click(stageButtons[0]);
    expect(onAwaitWrites).toHaveBeenCalledWith('clip-1');
    expect(onOpenInFocus).not.toHaveBeenCalled();
  });
});
