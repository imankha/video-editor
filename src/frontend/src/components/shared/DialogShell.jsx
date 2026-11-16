import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Z } from '../../constants/zLayers';

/**
 * DialogShell - the one shared dialog shell (T4560).
 *
 * Owns everything a dialog needs besides its content, so a caller passes only its
 * title, body and buttons as children:
 * - a dimmed backdrop that NEVER closes the dialog on click (house rule)
 * - Escape calls `onClose`, only when the caller passes one
 * - the z-layer (`Z.MODAL` unless the caller names another rung)
 * - role=dialog + aria-modal on the panel; focus moves into the panel on open
 *   and returns to the element that had it on close
 * - a portal to document.body (clicks inside stop there, so they never reach the
 *   React parent that opened the dialog)
 * - variant 'center' (a card) or 'sheet' (bottom sheet on phones, card from sm up)
 *
 * Props:
 * - isOpen (default true), onClose, variant ('center' | 'sheet'), zLayer
 * - role ('dialog' | 'alertdialog'), ariaLabel, labelledBy
 * - inline: render in place instead of portaling. Only for a dialog whose callers
 *   rely on the stacking context they render it in (ConfirmationDialog: see the
 *   NESTED MODALS note in constants/zLayers.js).
 * - panelClassName / backdropClassName: replace the variant's default surface,
 *   for a dialog moved onto the shell that must keep its existing look.
 * - panelTestId / backdropTestId: data-testid hooks.
 */
const VARIANTS = {
  center: {
    root: 'items-center',
    backdrop: 'bg-black/60 backdrop-blur-sm',
    panel: 'bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4 border border-gray-700',
  },
  sheet: {
    root: 'items-end sm:items-center',
    backdrop: 'bg-black/60',
    panel: 'w-full sm:max-w-sm bg-gray-800 border border-gray-700 rounded-t-2xl sm:rounded-2xl p-5 shadow-xl',
  },
};

export function DialogShell({
  isOpen = true,
  onClose,
  variant = 'center',
  zLayer = Z.MODAL,
  role = 'dialog',
  ariaLabel,
  labelledBy,
  inline = false,
  panelClassName,
  backdropClassName,
  panelTestId,
  backdropTestId,
  children,
}) {
  const panelRef = useRef(null);
  const styles = VARIANTS[variant];

  useEffect(() => {
    if (!isOpen || !onClose) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement;
    const panel = panelRef.current;
    if (panel && !panel.contains(previous)) panel.focus();
    return () => {
      if (previous && previous !== document.body && document.contains(previous)) previous.focus();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const dialog = (
    <div
      className={`fixed inset-0 ${zLayer} flex ${styles.root} justify-center`}
      data-dialog-shell=""
      onClick={inline ? undefined : (e) => e.stopPropagation()}
    >
      <div
        className={`absolute inset-0 ${backdropClassName ?? styles.backdrop}`}
        data-dialog-backdrop=""
        data-testid={backdropTestId}
      />
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={`relative outline-none ${panelClassName ?? styles.panel}`}
        data-testid={panelTestId}
      >
        {children}
      </div>
    </div>
  );

  return inline ? dialog : createPortal(dialog, document.body);
}

export default DialogShell;
