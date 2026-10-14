import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// T12790: group A dialogs each show one guide sentence and pulse their primary control.

vi.mock('../services/uploadManager', () => ({
  attachVideoToExistingGame: vi.fn(),
  UPLOAD_PHASE: {
    IDLE: 'idle', HASHING: 'hashing', PREPARING: 'preparing', UPLOADING: 'uploading',
    FINALIZING: 'finalizing', COMPLETE: 'complete', ERROR: 'error',
  },
}));
vi.mock('../utils/apiFetch', () => ({
  default: vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ tournaments: [] }) })),
}));

import { GUIDE } from '../config/displayNames';
import { useSettingsStore } from '../stores/settingsStore';
import { AttachVideoModal } from './AttachVideoModal';
import { ClipUploadNoticeModal } from './ClipUploadNoticeModal';
import { ClipUploadTooLargeModal } from './ClipUploadTooLargeModal';
import { ClipSizeLimitModal } from './ClipSizeLimitModal';
import { EditGameModal } from './EditGameModal';
import { LinkClipToGameModal } from './LinkClipToGameModal';
import { ExportTooLargeModal } from './ExportTooLargeModal';

const guideText = () => screen.getByTestId('modal-guide').textContent;
const pulsing = (id) => expect(screen.getByTestId(id).className).toContain('coach-target-pulse');

describe('group A dialog guides (T12790)', () => {
  beforeEach(() => {
    useSettingsStore.setState((st) => ({
      settings: { ...st.settings, guidance: { ...st.settings.guidance, coachEnabled: true } },
    }));
  });

  it('attach-video: choose, then submit pulses', () => {
    const { container } = render(
      <AttachVideoModal isOpen game={{ id: 1, name: 'G' }} onClose={vi.fn()} />
    );
    expect(guideText()).toBe(GUIDE.modal.attachVideoChoose);
    const file = new File([new Uint8Array(10)], 'a.mp4', { type: 'video/mp4' });
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [file] } });
    expect(guideText()).toBe(GUIDE.modal.attachVideoSubmit);
    pulsing('attach-video-submit');
  });

  it('clip-upload-notice', () => {
    render(<ClipUploadNoticeModal isOpen onCancel={vi.fn()} onContinue={vi.fn()} />);
    expect(guideText()).toBe(GUIDE.modal.clipUploadNotice);
    pulsing('clip-upload-notice-continue');
  });

  it('clip-upload-too-large', () => {
    render(<ClipUploadTooLargeModal isOpen names={['a.mp4']} maxBytes={500 * 1024 * 1024} onDismiss={vi.fn()} />);
    expect(guideText()).toBe(GUIDE.modal.clipUploadTooLarge);
    pulsing('clip-upload-too-large-ok');
  });

  it('clip-size-limit', () => {
    render(<ClipSizeLimitModal isOpen files={[{ name: 'a.mp4' }]} maxBytes={500 * 1024 * 1024} onAddGame={vi.fn()} onCancel={vi.fn()} />);
    expect(guideText()).toBe(GUIDE.modal.clipSizeLimit);
    pulsing('clip-size-limit-add-game');
  });

  it('edit-game', async () => {
    await act(async () => {
      render(
        <EditGameModal isOpen onClose={vi.fn()} game={{ id: 1, opponent_name: 'Rivals', game_date: '2026-01-01' }} />
      );
    });
    expect(guideText()).toBe(GUIDE.modal.editGame);
    pulsing('edit-game-save');
  });

  it('link-clip: pick and empty, no pulse', () => {
    const { unmount } = render(
      <LinkClipToGameModal isOpen games={[{ id: 1, name: 'G1' }]} onClose={vi.fn()} onLink={vi.fn()} />
    );
    expect(guideText()).toBe(GUIDE.modal.linkClip);
    unmount();
    render(<LinkClipToGameModal isOpen games={[]} onClose={vi.fn()} onLink={vi.fn()} />);
    expect(guideText()).toBe(GUIDE.modal.linkClipEmpty);
  });

  it('export-too-large', () => {
    render(<ExportTooLargeModal isOpen rejection={{ biggest_contributors: [] }} onDismiss={vi.fn()} />);
    expect(guideText()).toBe(GUIDE.modal.exportTooLarge);
    pulsing('export-too-large-dismiss');
  });
});
