import { useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { ShieldCheck } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { Toggle } from './shared';
import { Z } from '../constants/zLayers';
import { POLICY_NOTICE_COPY } from '../config/displayNames';

/**
 * T18040: "Use my videos to help test and improve ReelBallers". Shown in the policy notice
 * and under "Your privacy rights" in Account settings. Each tap is one write; the switch
 * shows the new value only once the server has it, and says so when it could not.
 */
export function TestingConsentSwitch() {
  const useForTesting = useAuthStore(s => s.useForTesting);
  const setUseForTesting = useAuthStore(s => s.setUseForTesting);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const labelId = useId();

  const handleChange = async (next) => {
    setSaving(true);
    setError(false);
    try {
      await setUseForTesting(next);
    } catch (e) {
      console.error('[PolicyNotice] testing consent change failed', e);
      setError(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="px-3 py-2 bg-white/5 rounded-lg space-y-1">
      <div className="flex items-center justify-between gap-3">
        <span id={labelId} className="text-sm text-gray-300">{POLICY_NOTICE_COPY.TESTING_LABEL}</span>
        <Toggle
          size="sm"
          checked={useForTesting === true}
          onChange={handleChange}
          disabled={saving}
          aria-labelledby={labelId}
          data-testid="testing-consent-switch"
          className="flex-shrink-0"
        />
      </div>
      <p className="text-xs text-gray-500">{POLICY_NOTICE_COPY.TESTING_HINT}</p>
      {error && <p className="text-xs text-red-400">{POLICY_NOTICE_COPY.TESTING_ERROR}</p>}
    </div>
  );
}

/**
 * T18040: one-time notice that the privacy policy changed (policy section 10 promises an
 * in-app notice). Shown while /me says the account has not acknowledged the current version;
 * only "Got it" closes it (no backdrop or Escape close), and that records the acknowledgement.
 */
export function PolicyNotice() {
  const policyNoticeVersion = useAuthStore(s => s.policyNoticeVersion);
  const acknowledgePolicy = useAuthStore(s => s.acknowledgePolicy);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  if (!policyNoticeVersion) return null;

  const handleGotIt = async () => {
    setSaving(true);
    setError(false);
    try {
      await acknowledgePolicy();
    } catch (e) {
      console.error('[PolicyNotice] acknowledge failed', e);
      setError(true);
      setSaving(false);
    }
  };

  return createPortal(
    <div
      data-testid="policy-notice-backdrop"
      className={`fixed inset-0 bg-black/60 flex items-center justify-center ${Z.ALERT}`}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="policy-notice-title"
        data-testid="policy-notice"
        className="bg-gray-800 rounded-lg border border-gray-700 max-w-sm w-full mx-4 p-4 space-y-3"
      >
        <h2 id="policy-notice-title" className="text-lg font-semibold text-white flex items-center gap-2">
          <ShieldCheck size={18} className="text-gray-400" />
          {POLICY_NOTICE_COPY.TITLE}
        </h2>
        <p className="text-sm text-gray-300">{POLICY_NOTICE_COPY.WHAT_CHANGED_AI}</p>
        <p className="text-sm text-gray-300">{POLICY_NOTICE_COPY.WHAT_CHANGED_TESTING}</p>
        <a href="/privacy" target="_blank" rel="noopener noreferrer" className="inline-block text-sm text-blue-400 hover:underline">
          {POLICY_NOTICE_COPY.READ_POLICY}
        </a>
        <TestingConsentSwitch />
        {error && <p className="text-sm text-red-400">{POLICY_NOTICE_COPY.ACKNOWLEDGE_ERROR}</p>}
        <button
          type="button"
          onClick={handleGotIt}
          disabled={saving}
          className="w-full px-4 py-2.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded-lg text-sm text-white font-medium transition-colors"
        >
          {POLICY_NOTICE_COPY.GOT_IT}
        </button>
      </div>
    </div>,
    document.body,
  );
}
