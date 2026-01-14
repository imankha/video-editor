import React, { useEffect, useState } from 'react';
import { X, CheckCircle, AlertCircle, Info, ExternalLink } from 'lucide-react';
import { create } from 'zustand';

/**
 * Toast Store - Global state for toast notifications
 */
export const useToastStore = create((set, get) => ({
  toasts: [],

  /**
   * Add a toast notification
   * @param {Object} toast - Toast configuration
   * @param {string} toast.type - 'success' | 'error' | 'info'
   * @param {string} toast.title - Main message
   * @param {string} [toast.message] - Optional secondary message
   * @param {Object} [toast.action] - Optional action button { label, onClick }
   * @param {number} [toast.duration] - Auto-dismiss duration in ms (0 = no auto-dismiss)
   */
  addToast: (toast) => {
    const id = Date.now() + Math.random();
    const newToast = {
      id,
      type: 'success',
      duration: 5000,
      ...toast,
    };

    set((state) => ({
      toasts: [...state.toasts, newToast],
    }));

    // Auto-dismiss
    if (newToast.duration > 0) {
      setTimeout(() => {
        get().removeToast(id);
      }, newToast.duration);
    }

    return id;
  },

  removeToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },

  clearAll: () => {
    set({ toasts: [] });
  },
}));

/**
 * Helper function to show toasts without hooks
 */
export const toast = {
  success: (title, options = {}) =>
    useToastStore.getState().addToast({ type: 'success', title, ...options }),
  error: (title, options = {}) =>
    useToastStore.getState().addToast({ type: 'error', title, duration: 8000, ...options }),
  info: (title, options = {}) =>
    useToastStore.getState().addToast({ type: 'info', title, ...options }),
};

/**
 * Individual Toast Component
 */
function ToastItem({ toast, onDismiss }) {
  const [isExiting, setIsExiting] = useState(false);

  const handleDismiss = () => {
    setIsExiting(true);
    setTimeout(() => onDismiss(toast.id), 200);
  };

  const icons = {
    success: <CheckCircle size={20} className="text-green-400" />,
    error: <AlertCircle size={20} className="text-red-400" />,
    info: <Info size={20} className="text-blue-400" />,
  };

  const borderColors = {
    success: 'border-l-green-500',
    error: 'border-l-red-500',
    info: 'border-l-blue-500',
  };

  return (
    <div
      className={`
        flex items-start gap-3 p-4 bg-gray-800 border border-gray-700 rounded-lg shadow-xl
        border-l-4 ${borderColors[toast.type]}
        transform transition-all duration-200 ease-out
        ${isExiting ? 'opacity-0 translate-x-4' : 'opacity-100 translate-x-0'}
      `}
      role="alert"
    >
      {/* Icon */}
      <div className="flex-shrink-0 mt-0.5">
        {icons[toast.type]}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-white font-medium">{toast.title}</p>
        {toast.message && (
          <p className="text-sm text-gray-400 mt-1">{toast.message}</p>
        )}
        {toast.action && (
          <button
            onClick={() => {
              toast.action.onClick?.();
              handleDismiss();
            }}
            className="mt-2 inline-flex items-center gap-1 text-sm text-purple-400 hover:text-purple-300 transition-colors"
          >
            {toast.action.label}
            <ExternalLink size={14} />
          </button>
        )}
      </div>

      {/* Dismiss button */}
      <button
        onClick={handleDismiss}
        className="flex-shrink-0 p-1 text-gray-500 hover:text-white rounded transition-colors"
      >
        <X size={16} />
      </button>
    </div>
  );
}

/**
 * Toast Container - Renders all active toasts
 * Place this component once at the app root level
 */
export function ToastContainer() {
  const toasts = useToastStore((state) => state.toasts);
  const removeToast = useToastStore((state) => state.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <ToastItem toast={t} onDismiss={removeToast} />
        </div>
      ))}
    </div>
  );
}

/**
 * Hook for using toasts in components
 */
export function useToast() {
  const addToast = useToastStore((state) => state.addToast);
  const removeToast = useToastStore((state) => state.removeToast);

  return {
    success: (title, options = {}) => addToast({ type: 'success', title, ...options }),
    error: (title, options = {}) => addToast({ type: 'error', title, duration: 8000, ...options }),
    info: (title, options = {}) => addToast({ type: 'info', title, ...options }),
    dismiss: removeToast,
  };
}

export default ToastContainer;
