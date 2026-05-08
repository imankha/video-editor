import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { API_BASE } from '../config';

export function AgeConfirmationModal() {
  const needsAgeConfirmation = useAuthStore(state => state.needsAgeConfirmation);
  const [submitting, setSubmitting] = useState(false);

  if (!needsAgeConfirmation) return null;

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      const resp = await fetch(`${API_BASE}/api/auth/accept-terms`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ terms_version: '2026-05-07' }),
      });
      if (resp.ok) {
        useAuthStore.setState({ needsAgeConfirmation: false });
      }
    } catch {
      // Retry on next interaction
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[100]">
      <div className="bg-gray-800 rounded-lg border border-gray-700 max-w-md w-full mx-4 p-6">
        <div className="flex items-center gap-3 mb-4">
          <ShieldCheck size={24} className="text-purple-400" />
          <h2 className="text-lg font-semibold text-white">Before You Continue</h2>
        </div>

        <p className="text-sm text-gray-300 mb-4">
          By continuing, you confirm that you are{' '}
          <strong className="text-white">18 years of age or older</strong> and
          that you agree to our{' '}
          <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
            Privacy Policy
          </a>{' '}
          and{' '}
          <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
            Terms of Service
          </a>.
        </p>

        <p className="text-xs text-gray-500 mb-6">
          Reel Ballers is designed for parents, guardians, and coaches. Children
          do not create accounts.
        </p>

        <button
          onClick={handleConfirm}
          disabled={submitting}
          className="w-full py-2.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
        >
          {submitting ? 'Confirming...' : 'I Confirm, I am 18+'}
        </button>
      </div>
    </div>
  );
}
