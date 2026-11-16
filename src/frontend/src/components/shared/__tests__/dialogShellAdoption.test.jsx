import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ConfirmationDialog } from '../ConfirmationDialog';
import { PlaysOnlyConfirmSheet } from '../../PlaysOnlyConfirmSheet';
import { ClipUploadNoticeModal } from '../../ClipUploadNoticeModal';
import { ClipUploadTooLargeModal } from '../../ClipUploadTooLargeModal';
import { ClipSizeLimitModal } from '../../ClipSizeLimitModal';
import { CreditHistoryModal } from '../../CreditHistoryModal';

vi.mock('../../../utils/uiTelemetry', () => ({ recordUiImpression: vi.fn() }));
// CreditHistoryModal loads its rows on mount; keep that request pending.
vi.mock('../../../utils/apiFetch', () => ({ default: vi.fn(() => new Promise(() => {})) }));

// T4560: the six dialogs moved onto DialogShell. For each: it renders through the
// shell, a backdrop click closes nothing, and Escape behaves as it did before the
// move (ConfirmationDialog closed on Escape; the other five had no Escape handling).
const shellRoot = () => document.querySelector('[data-dialog-shell]');
// The backdrop as a user sees it: the shell's backdrop layer, or (before the move)
// the dialog's own full-screen layer, so the pre-move behavior is observable too.
const backdrop = () => document.querySelector('[data-dialog-backdrop]')
  || document.querySelector('.fixed.inset-0 > .absolute.inset-0')
  || document.querySelector('.fixed.inset-0');

const CASES = [
  {
    name: 'ConfirmationDialog',
    // Pre-move look (classes copied from the dialog before T4560).
    look: { z: 'z-50', align: 'items-center', backdrop: 'bg-black/60 backdrop-blur-sm', panel: 'bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4 border border-gray-700' },
    escapeCloses: true,
    render: (close) => (
      <ConfirmationDialog isOpen title="t" message="m" onClose={close}
        buttons={[{ label: 'Cancel', onClick: close }]} />
    ),
  },
  {
    name: 'PlaysOnlyConfirmSheet',
    // Pre-move look (classes copied from the dialog before T4560).
    look: { z: 'z-[70]', align: 'items-end sm:items-center', backdrop: 'bg-black/60', panel: 'w-full sm:max-w-sm bg-gray-800 border border-gray-700 rounded-t-2xl sm:rounded-2xl p-5 shadow-xl' },
    escapeCloses: false,
    render: (close) => (
      <PlaysOnlyConfirmSheet title="t" body="b" confirmLabel="Go" onCancel={close} onConfirm={close} />
    ),
  },
  {
    name: 'ClipUploadNoticeModal',
    // Pre-move look (classes copied from the dialog before T4560).
    look: { z: 'z-50', align: 'items-center', backdrop: 'bg-black/70 backdrop-blur-sm', panel: 'bg-gray-800 rounded-xl shadow-2xl w-full max-w-md mx-4 border border-gray-700' },
    escapeCloses: false,
    render: (close) => <ClipUploadNoticeModal isOpen onCancel={close} onContinue={close} />,
  },
  {
    name: 'ClipUploadTooLargeModal',
    // Pre-move look (classes copied from the dialog before T4560).
    look: { z: 'z-50', align: 'items-center', backdrop: 'bg-black/70 backdrop-blur-sm', panel: 'bg-gray-800 rounded-xl shadow-2xl w-full max-w-md mx-4 border border-gray-700' },
    escapeCloses: false,
    render: (close) => <ClipUploadTooLargeModal isOpen names={['a.mp4']} maxBytes={500 * 1024 * 1024} onDismiss={close} />,
  },
  {
    name: 'ClipSizeLimitModal',
    // Pre-move look (classes copied from the dialog before T4560).
    look: { z: 'z-50', align: 'items-center', backdrop: 'bg-black/70 backdrop-blur-sm', panel: 'bg-gray-800 rounded-xl shadow-2xl w-full max-w-md mx-4 border border-gray-700' },
    escapeCloses: false,
    render: (close) => (
      <ClipSizeLimitModal isOpen files={[{ name: 'a.mp4' }]} maxBytes={500 * 1024 * 1024} onAddGame={close} onCancel={close} />
    ),
  },
  {
    name: 'CreditHistoryModal',
    // Pre-move look (classes copied from the dialog before T4560).
    look: { z: 'z-[60]', align: 'items-center', backdrop: 'bg-black/60', panel: 'bg-gray-800 rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl border border-white/10 max-h-[85vh] flex flex-col' },
    escapeCloses: false,
    render: (close) => <CreditHistoryModal onClose={close} />,
  },
];

const tokens = (el) => new Set(el.className.split(/\s+/).filter(Boolean));
const hasAll = (el, classes) => classes.split(' ').every((c) => tokens(el).has(c));

describe.each(CASES)('$name on DialogShell (T4560)', ({ render: ui, escapeCloses, look }) => {
  // T4560:C3 proxy: the shell renders the same z-layer, alignment, backdrop and
  // panel surface the dialog drew itself (pixel screenshots are in qa/T4560-shots).
  it('keeps its pre-move look', () => {
    render(ui(vi.fn()));
    const root = shellRoot();
    expect(hasAll(root, `fixed inset-0 flex justify-center ${look.z} ${look.align}`)).toBe(true);
    expect(hasAll(document.querySelector('[data-dialog-backdrop]'), look.backdrop)).toBe(true);
    const panel = root.querySelector('[role=dialog],[role=alertdialog]');
    expect(hasAll(panel, look.panel)).toBe(true);
  });

  it('renders through the shared shell', () => {
    render(ui(vi.fn()));
    expect(shellRoot()).toBeTruthy();
  });

  it('a backdrop click closes nothing', () => {
    const close = vi.fn();
    render(ui(close));
    fireEvent.click(backdrop());
    expect(close).not.toHaveBeenCalled();
  });

  it(`Escape ${escapeCloses ? 'closes, as before' : 'does nothing, as before'}`, () => {
    const close = vi.fn();
    render(ui(close));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(close).toHaveBeenCalledTimes(escapeCloses ? 1 : 0);
  });
});
