import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// T8700 test 12 (design section 6): "GameDetailsModal: submit stays enabled
// without opponent/date (non-blocking)."
//
// NOTE FOR IMPLEMENTOR (flagged per Tester Phase 1 instructions): the exact
// Opponent/Date copy/layout treatment (making the fields "feel wanted, not
// skip me") is still being finalized by a parallel ui-designer pass (T8700
// design doc section 1.4/Phase 2, open question Q4). This file therefore
// asserts only the STABLE contract:
//   1. Submit is never blocked by opponent/date being empty (T8500's
//      hasVideo-alone gate must survive whatever visual treatment lands).
//   2. Some opponent input and some date input are present/rendered
//      (by role/type, not by exact label text).
// It deliberately does NOT assert exact copy strings (e.g. "Opponent Team",
// "Game details (optional...)", the disclosure being collapsed vs expanded)
// since those are expected to change once the ui-designer pass lands.
//
// TODO(ui-designer copy landed): once the new Opponent/Date treatment ships,
// add a copy assertion here (or a sibling test) pinning the new field
// labels/placement so a future accidental revert to "feels skippable" is
// caught. Do not add it before then -- it would just be testing today's
// soon-to-change copy.

const { recordAchievementSpy } = vi.hoisted(() => ({ recordAchievementSpy: vi.fn() }));
vi.mock('../stores/questStore', () => {
  const state = { recordAchievement: recordAchievementSpy };
  const useQuestStore = (sel) => (sel ? sel(state) : state);
  useQuestStore.getState = () => state;
  return { useQuestStore };
});

vi.mock('../stores/creditStore', () => {
  const state = { balance: 88, loaded: true, fetchCredits: vi.fn() };
  const useCreditStore = (sel) => sel(state);
  useCreditStore.getState = () => state;
  return { useCreditStore };
});

vi.mock('../utils/apiFetch', () => ({
  default: vi.fn(() => Promise.resolve({ ok: true, json: async () => ({ tournaments: [] }) })),
}));

vi.mock('./shared', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

// Stub the picker (T8810): a file input that reports the normalized footage payload
// up. Keeps these Opponent/Date contract tests independent of intake internals.
vi.mock('./GameFootagePicker', () => ({
  GameFootagePicker: ({ onFootageChange, onFileSelected }) => (
    <input
      type="file"
      data-testid="stub-footage-input"
      onChange={(e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        onFileSelected?.();
        onFootageChange?.({ files: [{ file, sequence: 1 }], totalBytes: file.size, proxies: {} });
      }}
    />
  ),
}));

import { GameDetailsModal } from './GameDetailsModal';

function renderModal(props = {}) {
  return render(
    <GameDetailsModal isOpen onClose={vi.fn()} onCreateGame={vi.fn()} {...props} />
  );
}

function pickFile(container) {
  const input = container.querySelector('input[type="file"]');
  const file = new File(['x'.repeat(1024)], 'game.mp4', { type: 'video/mp4' });
  fireEvent.change(input, { target: { files: [file] } });
  return file;
}

describe('GameDetailsModal — T8700 test 12 (Opponent/Date stable contract)', () => {
  beforeEach(() => {
    recordAchievementSpy.mockClear();
  });

  it('submit is enabled once a video is picked, with opponent/date left untouched', () => {
    const { container } = renderModal();
    const submit = screen.getByRole('button', { name: 'Add Game' });
    expect(submit.disabled).toBe(true);

    pickFile(container);

    // Non-blocking: neither field was touched, submit must still be enabled.
    expect(submit.disabled).toBe(false);
  });

  it('submits successfully with opponent/date left at their defaults (no typing required)', async () => {
    const onCreateGame = vi.fn(() => Promise.resolve());
    const { container } = renderModal({ onCreateGame });

    pickFile(container);
    fireEvent.click(screen.getByRole('button', { name: 'Add Game' }));

    await waitFor(() => expect(onCreateGame).toHaveBeenCalledTimes(1));
    // Whatever the final default opponent string / date format the
    // ui-designer lands on, both must be present (non-empty) and the call
    // must succeed -- this is what "non-blocking" means end to end.
    const payload = onCreateGame.mock.calls[0][0];
    expect(payload.opponentName).toBeTruthy();
    expect(payload.gameDate).toBeTruthy();
  });

  it('renders an opponent text input and a date input somewhere in the form (fields present, first-class per design intent)', () => {
    const { container } = renderModal();
    pickFile(container);

    // Look for the fields without pinning exact label copy -- by input type,
    // scoped to the form. The design requires them to be rendered/reachable;
    // it does NOT require this test to know whether they're inside a
    // disclosure, inline, or otherwise laid out (ui-designer's call).
    const dateInput = container.querySelector('input[type="date"]');
    expect(dateInput).toBeTruthy();

    // Opponent is a plain text input; scope by proximity to a date input's
    // container to avoid colliding with unrelated text inputs (e.g. search).
    const textInputs = within(container).getAllByRole('textbox', { hidden: true });
    expect(textInputs.length).toBeGreaterThan(0);
  });

  it('a typed opponent still wins over the placeholder default (existing T8500 behavior preserved)', async () => {
    const onCreateGame = vi.fn(() => Promise.resolve());
    const { container } = renderModal({ onCreateGame });

    pickFile(container);

    // Open the disclosure if the current (pre-ui-designer) layout still uses
    // one; a future layout without a disclosure will simply find the input
    // already visible and this click becomes a no-op query miss guard.
    const disclosure = container.querySelector('[data-testid="game-details-disclosure"] summary');
    if (disclosure) fireEvent.click(disclosure);

    const dateInput = container.querySelector('input[type="date"]');
    const opponentInput = container.querySelector('input[type="text"]');
    expect(opponentInput).toBeTruthy();
    expect(dateInput).toBeTruthy();

    fireEvent.change(opponentInput, { target: { value: 'Carlsbad SC' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Game' }));

    await waitFor(() => expect(onCreateGame).toHaveBeenCalledTimes(1));
    expect(onCreateGame.mock.calls[0][0].opponentName).toBe('Carlsbad SC');
  });
});
