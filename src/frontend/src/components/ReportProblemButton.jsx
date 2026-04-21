import { useState, useRef, useEffect } from 'react';
import { X } from 'lucide-react';
import { API_BASE, ENABLE_PROBLEM_REPORT } from '../config';
import { useAuthStore } from '../stores/authStore';
import { getClientLogs, clearClientLogs } from '../utils/clientLogger';

/**
 * Capture a full-page screenshot as a base64 JPEG via html2canvas.
 * Sent silently with the report (not shown to user).
 * Returns a Promise<string|null>.
 */
async function captureScreenshot() {
  try {
    const mod = await import('html2canvas');
    const html2canvas = mod.default || mod;
    const canvas = await html2canvas(document.body, {
      scale: 0.75,
      useCORS: true,
      logging: false,
      backgroundColor: '#111827',
    });
    return canvas.toDataURL('image/jpeg', 0.6);
  } catch (err) {
    console.warn('[ReportProblem] Screenshot capture failed:', err?.message || err);
    return null;
  }
}

/**
 * ReportProblemButton -- opens a small modal for the user to describe
 * their problem. Auto-captures a screenshot and console logs, sends
 * everything to admins silently.
 *
 * T1650: Gated by VITE_ENABLE_PROBLEM_REPORT env var (default: enabled).
 */
export function ReportProblemButton({ className = '' }) {
  const email = useAuthStore((s) => s.email);
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [state, setState] = useState('idle'); // idle | sending | sent | error
  const screenshotRef = useRef(null);
  const textareaRef = useRef(null);

  if (!ENABLE_PROBLEM_REPORT) return null;

  const handleOpen = async () => {
    // Capture screenshot before modal opens (so modal isn't in the shot)
    screenshotRef.current = await captureScreenshot();
    setDescription('');
    setState('idle');
    setOpen(true);
  };

  const handleClose = () => {
    setOpen(false);
    setDescription('');
    screenshotRef.current = null;
    setState('idle');
  };

  const handleSend = async () => {
    setState('sending');
    try {
      const logs = getClientLogs();
      const res = await fetch(`${API_BASE}/api/auth/report-problem`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          logs,
          user_agent: navigator.userAgent,
          page_url: window.location.href,
          email: email || null,
          description: description.trim() || null,
          screenshot: screenshotRef.current,
          build: typeof __COMMIT_HASH__ !== 'undefined' ? __COMMIT_HASH__ : null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || `Failed (${res.status})`);
      }
      clearClientLogs();
      setState('sent');
    } catch (err) {
      console.error('[ReportProblem] Failed to send report:', err.message);
      setState('error');
    }
  };

  // Focus textarea when modal opens
  useEffect(() => {
    if (open && textareaRef.current) {
      const timer = setTimeout(() => textareaRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [open]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={handleOpen}
        className={`text-xs text-gray-400 hover:text-gray-200 ${className}`}
      >
        Report a problem
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50" onClick={handleClose}>
      <div
        className="bg-gray-800 border border-gray-600 rounded-xl w-full max-w-md mx-4 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
          <h3 className="text-sm font-semibold text-white">Report a problem</h3>
          <button onClick={handleClose} className="text-gray-400 hover:text-white">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-3">
          {state === 'sent' ? (
            <div className="text-center py-6">
              <p className="text-green-400 font-medium mb-1">Report sent!</p>
              <p className="text-gray-400 text-sm">Thanks -- we'll look into it.</p>
              <button
                onClick={handleClose}
                className="mt-4 px-4 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg"
              >
                Close
              </button>
            </div>
          ) : state === 'error' ? (
            <div className="text-center py-6">
              <p className="text-red-400 font-medium mb-1">Failed to send report</p>
              <p className="text-gray-400 text-sm">Please try again.</p>
              <button
                onClick={() => setState('idle')}
                className="mt-4 px-4 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg"
              >
                Try again
              </button>
            </div>
          ) : (
            <>
              <textarea
                ref={textareaRef}
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="What went wrong? Describe what you were doing..."
                rows={4}
                disabled={state === 'sending'}
                className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none resize-none disabled:opacity-50"
              />

              <div className="flex items-center justify-between">
                <span className="text-[11px] text-gray-500">
                  A screenshot and logs are included automatically
                </span>
                <button
                  onClick={handleSend}
                  disabled={state === 'sending'}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-wait text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {state === 'sending' ? 'Sending...' : 'Send report'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
