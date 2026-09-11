import { RotateCw } from 'lucide-react';
import AspectRatioSelector from '../AspectRatioSelector';
import ZoomControls from '../ZoomControls';
import { Toggle } from '../shared';
import SettingRow from './SettingRow';
import SettingsPanel from './SettingsPanel';
import { ratioWithName } from '../../constants/aspectRatios';

/**
 * FocusSettingsPanel (T9270) — the Focus "Settings" tab body. Re-homes the controls
 * that used to live in the above-video toolbar (aspect selector, audio, straighten,
 * background dim, zoom) into the shared SettingRow / SettingsPanel anatomy, grouped
 * by WHAT EACH CONTROL CHANGES:
 *
 *   Reel      — applies to every clip (aspect ratio, include audio)
 *   This clip — straighten (level tilted footage)
 *   View only — background dim, zoom (never persisted, desktop-only)
 *
 * View-only controls (dim, zoom) and the straighten line-drag tool stay DESKTOP-ONLY
 * exactly as they were gated in the old toolbar: `desktopOnly` is false in the mobile
 * drawer, which drops the View-only group and the straighten tool entirely (Step 4).
 * One accent: blue-600.
 */
export default function FocusSettingsPanel({
  globalAspectRatio,
  onAspectRatioChange,
  includeAudio,
  onIncludeAudioChange,
  straightenVisible,
  onToggleStraighten,
  dimOpacity,
  onToggleDim,
  zoom,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  minZoom,
  maxZoom,
  desktopOnly = true,
}) {
  return (
    <>
      <SettingsPanel title="Reel">
        <SettingRow label="Aspect ratio" value={ratioWithName(globalAspectRatio)}>
          <AspectRatioSelector
            aspectRatio={globalAspectRatio}
            onAspectRatioChange={onAspectRatioChange}
          />
        </SettingRow>
        <SettingRow label="Include audio" value={includeAudio ? 'On' : 'Off'}>
          <Toggle checked={includeAudio} onChange={onIncludeAudioChange} />
        </SettingRow>
      </SettingsPanel>

      {/* This clip — straighten. The line-drag TOOL is desktop-only (precision
          pointer); the toggle only reveals it, and hiding it never clears the angle. */}
      {desktopOnly && (
        <SettingsPanel title="This clip">
          <SettingRow
            label="Straighten"
            value="Level tilted footage by dragging along the horizon"
          >
            <button
              type="button"
              onClick={onToggleStraighten}
              aria-pressed={straightenVisible}
              title="Straighten: level tilted footage by dragging along the horizon (or a vertical)"
              className={`flex items-center gap-1.5 border rounded-lg px-3 py-2 text-sm font-medium transition-colors coarse-pointer:min-h-11 ${
                straightenVisible
                  ? 'bg-blue-600 border-blue-500 text-white'
                  : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
              }`}
            >
              <RotateCw size={14} aria-hidden="true" />
              {straightenVisible ? 'On' : 'Off'}
            </button>
          </SettingRow>
        </SettingsPanel>
      )}

      {/* View only — dim + zoom. Never persisted, desktop-only (a phone has no
          pillarbox to dim and pinch handles zoom). */}
      {desktopOnly && (
        <SettingsPanel title="View only">
          <SettingRow label="Background" value={dimOpacity === 0.7 ? 'Dark' : 'Dim'}>
            <button
              onClick={onToggleDim}
              className="relative w-8 h-4 rounded-full transition-colors coarse-pointer:min-h-11"
              style={{ backgroundColor: dimOpacity === 0.7 ? '#2563eb' : '#4b5563' }}
              aria-label="Toggle background darkness"
              aria-pressed={dimOpacity === 0.7}
            >
              <span
                className="absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform"
                style={{ transform: dimOpacity === 0.7 ? 'translateX(16px)' : 'translateX(0)' }}
              />
            </button>
          </SettingRow>
          <SettingRow label="Zoom" value={`${Math.round((zoom ?? 1) * 100)}%`}>
            <ZoomControls
              zoom={zoom}
              onZoomIn={onZoomIn}
              onZoomOut={onZoomOut}
              onResetZoom={onResetZoom}
              minZoom={minZoom}
              maxZoom={maxZoom}
            />
          </SettingRow>
        </SettingsPanel>
      )}
    </>
  );
}
