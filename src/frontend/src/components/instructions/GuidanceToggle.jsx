import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSettingsStore, useGuidanceSettings } from '../../stores/settingsStore';
import { useAuthStore } from '../../stores/authStore';
import { Z } from '../../constants/zLayers';

const SWITCH_CLASS = 'min-h-11 min-w-11 select-none justify-center rounded-lg border border-white/15 bg-gray-950/95 px-1.5 sm:px-3 shadow-lg shadow-black/30 flex items-center gap-1 sm:gap-2 text-xs font-semibold text-white';

function SwitchFace({ on }) {
  return <>
    <span className="pointer-events-none">Guidance</span>
    <span aria-hidden="true" className={`flex h-5 w-9 items-center rounded-full p-0.5 transition-colors ${on ? 'bg-violet-500' : 'bg-gray-600'}`}>
      <span className={`h-4 w-4 rounded-full bg-white transition-transform ${on ? 'translate-x-4' : ''}`} />
    </span>
    <span className="hidden sm:inline">{on ? 'On' : 'Off'}</span>
  </>;
}

/**
 * T11950: header chip (UnifiedHeader on editor screens, ProjectManager on Home). It holds its place in
 * the header with an invisible same-size slot; the real switch is drawn in a body-level layer pinned
 * over that slot, ABOVE every modal (a header can never out-stack a fixed modal backdrop), so the user
 * can always turn guidance off.
 */
export default function GuidanceToggle() {
  const authenticated = useAuthStore(s => s.isAuthenticated);
  const { coachEnabled } = useGuidanceSettings();
  const loaded = useSettingsStore(s => s.isInitialized);
  const save = useSettingsStore(s => s.setCoachEnabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const slotRef = useRef(null);
  const [box, setBox] = useState(null);
  useLayoutEffect(() => {
    const slot = slotRef.current;
    if (!slot) return undefined;
    let raf;
    const measure = () => {
      const r = slot.getBoundingClientRect();
      // T13700: a full-bleed surface that covers the header (landscape cockpit) marks itself
      // data-covers-header; the slot is then not a visible place, so the layer must not paint there.
      const covered = !!document.querySelector('[data-covers-header]');
      setBox(old => old && old.left === r.left && old.top === r.top && old.covered === covered ? old : { left: r.left, top: r.top, covered });
    };
    // T13460: the slot can move without resizing itself or its parent (a sibling mounts, a banner
    // clears, fonts load) and no resize/scroll event fires, so the fixed layer would sit over the
    // logo or icons beside it. Re-read the slot every frame; setBox bails out when nothing moved.
    const track = () => { measure(); raf = requestAnimationFrame(track); };
    track();
    return () => cancelAnimationFrame(raf);
  }, [authenticated]);
  if (!authenticated) return null;
  return <>
    <div ref={slotRef} aria-hidden="true" className={`invisible flex-shrink-0 ${SWITCH_CLASS}`}><SwitchFace on={coachEnabled} /></div>
    {createPortal(
      <div data-testid="guidance-toggle-layer" className={`fixed ${Z.TOAST}`} style={box && !box.covered ? { left: box.left, top: box.top } : { visibility: 'hidden' }}>
        <button type="button" role="switch" aria-label="Helpful instructions" aria-checked={coachEnabled}
          data-testid="guidance-toggle" disabled={saving || !loaded}
          className={`${SWITCH_CLASS} cursor-pointer hover:bg-gray-800 disabled:cursor-wait`}
          onClick={async () => {
            setSaving(true); setError('');
            try { await save(!coachEnabled); }
            catch { setError('Could not save guidance. Try again.'); }
            finally { setSaving(false); }
          }}>
          <SwitchFace on={coachEnabled} />
        </button>
        {error && <p role="alert" className="absolute right-0 top-full mt-1 w-52 rounded bg-red-950/90 px-2 py-1 text-xs text-red-200">{error}</p>}
      </div>,
      document.body,
    )}
  </>;
}
