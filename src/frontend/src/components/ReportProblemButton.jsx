import { useState } from 'react';
import { API_BASE, ENABLE_PROBLEM_REPORT } from '../config';
import { useAuthStore } from '../stores/authStore';
import { getClientLogs, clearClientLogs } from '../utils/clientLogger';

/**
 * ReportProblemButton — sends captured console errors/warnings to admins.
 *
 * T1650: Gated by VITE_ENABLE_PROBLEM_REPORT env var (default: enabled).
 * Collects logs from the clientLogger ring buffer and POSTs them to
 * /api/auth/report-problem, which emails all admin_users.
 */
export function ReportProblemButton({ className = '' }) {
  const email = useAuthStore((s) => s.email);
  const [state, setState] = useState('idle'); // idle | sending | sent | error

  if (!ENABLE_PROBLEM_REPORT) return null;

  const handleReport = async () => {
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
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || `Failed (${res.status})`);
      }
      clearClientLogs();
      setState('sent');
      setTimeout(() => setState('idle'), 5000);
    } catch (err) {
      console.error('[ReportProblem] Failed to send report:', err.message);
      setState('error');
      setTimeout(() => setState('idle'), 5000);
    }
  };

  const label = {
    idle: 'Report a problem',
    sending: 'Sending...',
    sent: 'Report sent!',
    error: 'Failed to send',
  }[state];

  const color = {
    idle: 'text-gray-400 hover:text-gray-200',
    sending: 'text-gray-500',
    sent: 'text-green-400',
    error: 'text-red-400',
  }[state];

  return (
    <button
      type="button"
      onClick={handleReport}
      disabled={state === 'sending'}
      className={`text-xs ${color} disabled:cursor-wait ${className}`}
    >
      {label}
    </button>
  );
}
