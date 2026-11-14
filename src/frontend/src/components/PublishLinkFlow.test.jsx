import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// T10180: PublishLinkFlow is a NEW presentational component (design doc §3.2) that
// renders into CollectionPlayer's `actionBar` slot, one branch per `phase`. It owns
// NO state/fetching -- all data (phase, reelName, shareUrl, copied, isMobile) and
// gestures (onPublishClick/onCancel/onConfirm/onCopy/onNativeShare) are props from
// DraftReelPreviewInner. This file also exercises the shared LinkReadyCard leaf
// (selectable readonly input + Copy) through the 'ready' phase render.
import { PublishLinkFlow } from './PublishLinkFlow';

const baseProps = {
  reelName: 'Brilliant Dribble',
  shareUrl: null,
  isMobile: false,
  copied: false,
  onPublishClick: vi.fn(),
  onCancel: vi.fn(),
  onConfirm: vi.fn(),
  onCopy: vi.fn(),
  onNativeShare: vi.fn(),
};

function renderFlow(phase, overrides = {}) {
  return render(<PublishLinkFlow phase={phase} {...baseProps} {...overrides} />);
}

describe('PublishLinkFlow (T10180)', () => {
  beforeEach(() => {
    Object.values(baseProps).forEach((v) => { if (typeof v === 'function') v.mockClear?.(); });
  });

  it('idle phase renders the "Get link" primary action', () => {
    renderFlow('idle');
    const btn = screen.getByRole('button', { name: 'Get link' });
    fireEvent.click(btn);
    expect(baseProps.onPublishClick).toHaveBeenCalledTimes(1);
  });

  it('review phase renders the confirm card with title/body/Cancel/Confirm', () => {
    renderFlow('review');
    expect(screen.getByText('Share "Brilliant Dribble"?')).toBeTruthy();
    expect(screen.getByText(
      'Anyone with the link can watch. Creating a link does not send it.'
    )).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(baseProps.onCancel).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Create link' }));
    expect(baseProps.onConfirm).toHaveBeenCalledTimes(1);
  });

  it('publishing phase shows a busy indicator and no actionable buttons', () => {
    renderFlow('publishing');
    expect(screen.getByText('Creating link...')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create link' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  // Test 7: Copy awaits clipboard success before toasting (dedupKey 'copy-link');
  // selectable readonly input present (onFocus selects); coarse pointer shows
  // "Share link...".
  it('ready phase (fine pointer) shows a selectable readonly input and a Copy control that awaits onCopy', async () => {
    let resolveCopy;
    const onCopy = vi.fn(() => new Promise((res) => { resolveCopy = res; }));
    renderFlow('ready', {
      shareUrl: 'https://reelballers.com/shared/tok123',
      onCopy,
      isMobile: false,
    });

    expect(screen.getByText('Link ready')).toBeTruthy();
    const input = screen.getByDisplayValue('https://reelballers.com/shared/tok123');
    expect(input.tagName).toBe('INPUT');
    expect(input).toHaveProperty('readOnly', true);

    // onFocus selects the whole value (selectable readonly input contract).
    const selectSpy = vi.fn();
    input.select = selectSpy;
    fireEvent.focus(input);
    expect(selectSpy).toHaveBeenCalled();

    const copyBtn = screen.getByRole('button', { name: /copy link/i });
    fireEvent.click(copyBtn);
    expect(onCopy).toHaveBeenCalledTimes(1);

    // Copy resolves asynchronously -- the component must not report "copied"
    // before onCopy's promise settles (false-success guard, R7).
    await act(async () => { resolveCopy(); await Promise.resolve(); });
  });

  // T11510 (D6): LINK_ONLY (canShareFile false, the default) collapses to a
  // single full-width "Share link" button -- no "Share video" sits beside it
  // since the device can't share a file. The link card (LinkReadyCard) also
  // shows on mobile now, not just the native share button.
  it('ready phase (coarse pointer, LINK_ONLY) shows the link card and a single "Share link" button, no "Share video"', () => {
    renderFlow('ready', {
      shareUrl: 'https://reelballers.com/shared/tok123',
      isMobile: true,
      canShareFile: false,
    });

    expect(screen.getByDisplayValue('https://reelballers.com/shared/tok123')).toBeTruthy();
    const shareBtn = screen.getByRole('button', { name: 'Share link' });
    fireEvent.click(shareBtn);
    expect(baseProps.onNativeShare).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Share video' })).toBeNull();
  });

  // T11510 (D6, AC): a FULL-capability coarse pointer gets BOTH actions side
  // by side, each wired to its own intent-named handler -- a file share and a
  // link share are never the same button under two different labels.
  it('ready phase (coarse pointer, FULL) shows Share link and Share video side by side, each firing its own handler', () => {
    const onShareVideo = vi.fn();
    renderFlow('ready', {
      shareUrl: 'https://reelballers.com/shared/tok123',
      isMobile: true,
      canShareFile: true,
      onShareVideo,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Share link' }));
    expect(baseProps.onNativeShare).toHaveBeenCalledTimes(1);
    expect(onShareVideo).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Share video' }));
    expect(onShareVideo).toHaveBeenCalledTimes(1);
    expect(baseProps.onNativeShare).toHaveBeenCalledTimes(1);
  });

  // T11510 (D6): the 'ready-capable' case (alreadyPublished, no link minted
  // yet) renders the same layout minus the link card -- Share video works at
  // once with no token.
  it('ready phase (coarse pointer) with a null shareUrl shows no link card but still shows Share link/Share video', () => {
    renderFlow('ready', {
      shareUrl: null,
      isMobile: true,
      canShareFile: true,
    });

    expect(screen.queryByDisplayValue(/reelballers\.com/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Share link' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Share video' })).toBeTruthy();
  });

  // T12190: 'Link ready' must not sit over a 'Get Link' button (qa-32).
  it('T12190:C1 ready phase with a null shareUrl does not claim "Link ready"', () => {
    const onGetLink = vi.fn();
    renderFlow('ready', { shareUrl: null, isMobile: false, onGetLink });

    expect(screen.queryByText('Link ready')).toBeNull();
    expect(screen.queryByText('Get Link')).toBeNull();
    expect(screen.getByText('Share this highlight')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Get link' }));
    expect(onGetLink).toHaveBeenCalledTimes(1);
  });

  it('failed phase renders no link-ready UI (link never created on failure)', () => {
    renderFlow('failed');
    expect(screen.queryByText('Link ready')).toBeNull();
    expect(screen.queryByRole('button', { name: /copy link/i })).toBeNull();
  });
});
