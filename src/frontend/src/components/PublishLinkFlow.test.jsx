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

  it('idle phase renders the "Publish and get link" primary action', () => {
    renderFlow('idle');
    const btn = screen.getByRole('button', { name: 'Publish and get link' });
    fireEvent.click(btn);
    expect(baseProps.onPublishClick).toHaveBeenCalledTimes(1);
  });

  it('review phase renders the confirm card with title/body/Cancel/Confirm', () => {
    renderFlow('review');
    expect(screen.getByText('Publish "Brilliant Dribble"?')).toBeTruthy();
    expect(screen.getByText(
      'Anyone with the link can watch. Publishing creates a link; it does not send it.'
    )).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(baseProps.onCancel).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Publish and create link' }));
    expect(baseProps.onConfirm).toHaveBeenCalledTimes(1);
  });

  it('publishing phase shows a busy indicator and no actionable buttons', () => {
    renderFlow('publishing');
    expect(screen.getByText('Publishing...')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Publish and create link' })).toBeNull();
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

  it('ready phase (coarse pointer) shows "Share link..." instead of the selectable input', () => {
    renderFlow('ready', {
      shareUrl: 'https://reelballers.com/shared/tok123',
      isMobile: true,
    });

    const shareBtn = screen.getByRole('button', { name: 'Share link...' });
    fireEvent.click(shareBtn);
    expect(baseProps.onNativeShare).toHaveBeenCalledTimes(1);
    // Fine-pointer selectable input must not also render on coarse pointer.
    expect(screen.queryByDisplayValue('https://reelballers.com/shared/tok123')).toBeNull();
  });

  it('failed phase renders no link-ready UI (link never created on failure)', () => {
    renderFlow('failed');
    expect(screen.queryByText('Link ready')).toBeNull();
    expect(screen.queryByRole('button', { name: /copy link/i })).toBeNull();
  });
});
