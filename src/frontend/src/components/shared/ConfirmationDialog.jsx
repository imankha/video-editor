import React, { useCallback, useEffect } from 'react';
import { Button } from './Button';

/**
 * ConfirmationDialog - Modal dialog with configurable buttons
 *
 * Props:
 * - isOpen: Whether dialog is visible
 * - title: Dialog title
 * - message: Dialog message/description
 * - buttons: Array of button configs [{ label, onClick, variant, disabled }]
 *   - variant: 'primary' (purple), 'danger' (red), 'secondary' (gray)
 * - onClose: Called when clicking outside or pressing Escape
 */
export function ConfirmationDialog({ isOpen, title, message, buttons = [], onClose }) {
  const handleBackdropClick = useCallback((e) => {
    if (e.target === e.currentTarget) {
      onClose?.();
    }
  }, [onClose]);

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

  // Early return AFTER hooks to maintain consistent hook order
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div className="bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4 border border-gray-700">
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
          <p className="text-gray-300 whitespace-pre-wrap">{message}</p>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-700 flex justify-end gap-3">
          {buttons.map((button, index) => (
            <Button
              key={index}
              variant={button.variant || 'secondary'}
              onClick={button.onClick}
              disabled={button.disabled}
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
