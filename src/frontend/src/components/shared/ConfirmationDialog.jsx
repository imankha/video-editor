import React, { useEffect } from 'react';
import { Button } from './Button';
import { Z } from '../../constants/zLayers';
import { recordUiImpression } from '../../utils/uiTelemetry';

/**
 * ConfirmationDialog - Modal dialog with configurable buttons
 *
 * Props:
 * - isOpen: Whether dialog is visible
 * - title: Dialog title
 * - message: Dialog message/description
 * - buttons: Array of button configs [{ label, onClick, variant, disabled, icon }]
 *   - variant: 'primary' (purple), 'danger' (red), 'secondary' (gray), 'cyan' (reel accent)
 *   - icon: optional lucide component rendered inside the button
 * - onClose: Called when clicking outside or pressing Escape
 * - impressionKey: Optional STABLE enum-like id (e.g. 'tag_not_submitted') that
 *   opts this dialog into T7515 frustration impression counting. Never the title.
 * - illustration: Optional ReactNode rendered in the body ABOVE the message,
 *   inside a fixed-aspect box so the card never reflows while it loads.
 * - panelTestId: Optional data-testid applied to the inner panel div (for tests).
 */
export function ConfirmationDialog({ isOpen, title, message, buttons = [], onClose, impressionKey, illustration, panelTestId }) {
  // Effect for Escape key - runs regardless of isOpen to avoid hook order issues
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose?.();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // T7515 tier 3: count this blocking-dialog impression from its SHOW event —
  // ConfirmationDialog is the single shared blocking-dialog primitive, so the
  // open transition IS the "surface rendered to the user" gesture the frustration
  // signal measures. This is telemetry-on-show (fire-and-forget, no app-state
  // write-back), NOT the banned reactive-persistence pattern. Keyed on the open
  // transition so it fires once per show.
  //
  // Counts ONLY when the caller pins a STABLE `impressionKey`. The title is
  // display text — routinely runtime-interpolated with PII (names, emails, raw
  // error strings) — so it must NEVER become the analytics key: that would leak
  // PII into the shared user_actions aggregate and explode its cardinality (one
  // singleton row per distinct message). Keys are literals, exactly like
  // record_milestone's closed FLOW_EVENTS vocabulary.
  useEffect(() => {
    if (isOpen && impressionKey) recordUiImpression('dialog', impressionKey);
  }, [isOpen, impressionKey]);

  // Early return AFTER hooks to maintain consistent hook order
  if (!isOpen) return null;

  return (
    <div
      className={`fixed inset-0 ${Z.MODAL} flex items-center justify-center bg-black/60 backdrop-blur-sm`}
    >
      <div
        className="bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4 border border-gray-700"
        data-testid={panelTestId}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-700 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          {onClose && (
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white transition-colors p-1 -mr-1"
              aria-label="Close dialog"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Body */}
        <div className="px-6 py-4">
          {illustration && (
            <div className="mb-4 aspect-video w-full overflow-hidden rounded-lg">
              {illustration}
            </div>
          )}
          <p className="text-gray-300 whitespace-pre-wrap">{message}</p>
        </div>

        {/* Footer — stacks full-width below sm (primary lowest via col-reverse),
            right-aligned row at sm+ (primary rightmost). Order the buttons array
            with the primary LAST. */}
        <div className="px-6 py-4 border-t border-gray-700 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
          {buttons.map((button, index) => (
            <Button
              key={index}
              variant={button.variant || 'secondary'}
              onClick={button.onClick}
              disabled={button.disabled}
              icon={button.icon}
              className="w-full sm:w-auto"
            >
              {button.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default ConfirmationDialog;
