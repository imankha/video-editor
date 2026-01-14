import React from 'react';
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
  if (!isOpen) return null;

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose?.();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      onClose?.();
    }
  };

  React.useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div className="bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4 border border-gray-700">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-700">
          <h3 className="text-lg font-semibold text-white">{title}</h3>
        </div>

        {/* Body */}
        <div className="px-6 py-4">
          <p className="text-gray-300">{message}</p>
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
