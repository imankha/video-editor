import { useState } from 'react';
import { useSettingsStore, useGuidanceSettings } from '../../stores/settingsStore';
import { useAuthStore } from '../../stores/authStore';

/** One app-level control, outside all transformed editor and coach containers. */
export default function GuidanceToggle() {
  const authenticated = useAuthStore(s => s.isAuthenticated);
  const { coachEnabled = true } = useGuidanceSettings();
  const save = useSettingsStore(s => s.setCoachEnabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  if (!authenticated) return null;
  return <div className="fixed inset-x-0 top-0 z-[150] flex min-h-12 justify-end bg-gray-950/95 px-4 border-b border-white/10">
    <button type="button" role="switch" aria-label="Helpful instructions" aria-checked={coachEnabled}
      data-testid="guidance-toggle" disabled={saving}
      className="flex min-h-11 items-center gap-2 text-xs font-semibold text-white"
      onClick={async () => {
        setSaving(true); setError('');
        try { await save(!coachEnabled); }
        catch { setError('Could not save guidance. Try again.'); }
        finally { setSaving(false); }
      }}>
      Guidance
      <span aria-hidden="true" className={`flex h-5 w-9 items-center rounded-full p-0.5 transition-colors ${coachEnabled ? 'bg-violet-500' : 'bg-gray-600'}`}>
        <span className={`h-4 w-4 rounded-full bg-white transition-transform ${coachEnabled ? 'translate-x-4' : ''}`} />
      </span>
      <span>{coachEnabled ? 'On' : 'Off'}</span>
    </button>
    {error && <p role="alert" className="max-w-52 text-xs text-red-200 pb-2">{error}</p>}
  </div>;
}
