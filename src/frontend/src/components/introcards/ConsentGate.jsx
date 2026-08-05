// T5205 — the parental-consent gate. A card cannot be edited/saved until the
// profile records consent (epic compliance posture; T5215 also reads it before
// letting a card attach). Consent lives on the PROFILE (T5190), so this ticks
// the same attestation ProfileIntroSection uses — one consent record per profile.

import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';

export function ConsentGate({ onBack, onConsent, error }) {
  const [busy, setBusy] = useState(false);

  const handleToggle = async (e) => {
    if (!e.target.checked) return;
    setBusy(true);
    try {
      await onConsent();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 text-sm text-gray-300 hover:text-white mb-4 self-start"
      >
        <ArrowLeft size={16} /> Cards
      </button>
      <div className="max-w-md mx-auto my-auto bg-gray-800 border border-gray-700 rounded-lg p-6 text-center">
        <h3 className="text-base font-semibold text-white mb-2">Consent required</h3>
        <p className="text-sm text-gray-300 mb-4">
          An intro card shows a player&apos;s photo and can be seen by anyone you share a
          link with. Confirm you have permission before you build one.
        </p>
        <label className="flex items-start gap-2.5 text-left cursor-pointer">
          <input
            type="checkbox"
            checked={false}
            disabled={busy}
            onChange={handleToggle}
            className="mt-0.5 w-4 h-4 flex-shrink-0 accent-blue-500 cursor-pointer"
          />
          <span className="text-xs text-gray-300 leading-relaxed">
            I am the parent or guardian, I consent to using this player&apos;s likeness, and I
            understand it becomes publicly visible to anyone I share a link with.
          </span>
        </label>
        {error && <p className="text-red-400 text-xs mt-3">{error}</p>}
      </div>
    </div>
  );
}

export default ConsentGate;
