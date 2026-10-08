import { useState } from 'react';
import { useSettingsStore, useGuidanceSettings } from '../../stores/settingsStore';
import { useAuthStore } from '../../stores/authStore';

/** T11950: in-flow header chip (UnifiedHeader on editor screens, ProjectManager on Home). Never floats over content. */
export default function GuidanceToggle() {
  const authenticated = useAuthStore(s => s.isAuthenticated);
  const { coachEnabled = true } = useGuidanceSettings();
  const save = useSettingsStore(s => s.setCoachEnabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  if (!authenticated) return null;
  return <div className="relative flex-shrink-0">
    <button type="button" role="switch" aria-label="Helpful instructions" aria-checked={coachEnabled}
      data-testid="guidance-toggle" disabled={saving}
      className="min-h-11 min-w-11 justify-center rounded-lg border border-white/15 bg-gray-950/95 px-3 shadow-lg shadow-black/30 flex items-center gap-2 text-xs font-semibold text-white"
      onClick={async () => {
        setSaving(true); setError('');
        try { await save(!coachEnabled); }
        catch { setError('Could not save guidance. Try again.'); }
        finally { setSaving(false); }
      }}>
      <span className="hidden sm:inline">Guidance</span>
      <span aria-hidden="true" className={`flex h-5 w-9 items-center rounded-full p-0.5 transition-colors ${coachEnabled ? 'bg-violet-500' : 'bg-gray-600'}`}>
        <span className={`h-4 w-4 rounded-full bg-white transition-transform ${coachEnabled ? 'translate-x-4' : ''}`} />
      </span>
      <span>{coachEnabled ? 'On' : 'Off'}</span>
    </button>
    {error && <p role="alert" className="absolute right-0 top-full z-30 mt-1 w-52 rounded bg-red-950/90 px-2 py-1 text-xs text-red-200">{error}</p>}
  </div>;
}
