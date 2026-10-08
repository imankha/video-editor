import { useState } from 'react';
import { RotateCw, ChevronDown } from 'lucide-react';
import AspectRatioSelector from '../AspectRatioSelector';
import { Toggle } from '../shared';
import SettingRow from './SettingRow';
import SettingsPanel from './SettingsPanel';
import { ratioWithName } from '../../constants/aspectRatios';
import { EDITOR_PANELS } from '../../config/displayNames';

/**
 * FocusSettingsPanel (T9270) — the Focus "Settings" tab body. Re-homes the controls
 * that used to live in the above-video toolbar (aspect selector, audio, straighten,
 * background dim) into the shared SettingRow / SettingsPanel anatomy, grouped
 * by WHAT EACH CONTROL CHANGES:
 *
 *   Highlight          - applies to every clip (aspect ratio, include audio)
 *   More options       - Fix a tilted camera (straighten) + Darken outside the
 *                        box (dim), T12180: one collapsed disclosure, plain labels.
 *                        T10395: zoom lives on the video's own Controls bar.
 *
 * The dim toggle and the straighten line-drag tool stay DESKTOP-ONLY exactly as
 * they were gated in the old toolbar: `desktopOnly` is false in the mobile
 * drawer, which drops the More options group and the straighten tool entirely
 * (Step 4). One accent: blue-600.
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
  desktopOnly = true,
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  return (
    <>
      <SettingsPanel title="Highlight">
        <SettingRow label="Aspect ratio" value={ratioWithName(globalAspectRatio)}>
          <AspectRatioSelector
            aspectRatio={globalAspectRatio}
            onAspectRatioChange={onAspectRatioChange}
          />
        </SettingRow>
        <SettingRow label="Include audio" value={includeAudio ? 'On' : 'Off'}>
          {/* T10820 (known-failures row 32): this Toggle renders on mobile too (not
              gated by desktopOnly), and its default h-7 track (28px) sits under the
              44px coarse-pointer touch floor. `min-height` is set on the same element
              that paints the track, so `coarse-pointer:min-h-11` grows the track itself
              to 44px tall on touch (the pill reads taller there; the thumb stays
              centred) — it does nothing on a fine pointer, where the 28px track ships
              unchanged. Same pattern as the straighten/dim buttons below. */}
          <Toggle
            checked={includeAudio}
            onChange={onIncludeAudioChange}
            title="Include the highlight's original audio in the generated video"
            className="coarse-pointer:min-h-11"
          />
        </SettingRow>
      </SettingsPanel>

      {/* T12180: straighten + dim sit behind one collapsed 'More options' disclosure
          (memory-only state). The line-drag straighten TOOL and dim stay desktop-only
          exactly as before (a phone has no pillarbox to dim). */}
      {desktopOnly && (
        <section className="space-y-3">
          <button
            type="button"
            onClick={() => setMoreOpen((o) => !o)}
            aria-expanded={moreOpen}
            className="flex items-center gap-1.5 text-sm font-medium text-gray-300 hover:text-white transition-colors coarse-pointer:min-h-11"
          >
            <ChevronDown
              size={14}
              aria-hidden="true"
              className={`transition-transform ${moreOpen ? 'rotate-180' : ''}`}
            />
            {EDITOR_PANELS.MORE_OPTIONS}
          </button>
          {moreOpen && (
            <div className="space-y-4">
              <SettingRow label={EDITOR_PANELS.FIX_TILT} value={EDITOR_PANELS.FIX_TILT_HELP}>
                <button
                  type="button"
                  onClick={onToggleStraighten}
                  aria-pressed={straightenVisible}
                  aria-label={EDITOR_PANELS.FIX_TILT}
                  title={EDITOR_PANELS.FIX_TILT_HELP}
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

              <SettingRow label={EDITOR_PANELS.DARKEN_OUTSIDE} value={EDITOR_PANELS.DARKEN_OUTSIDE_HELP}>
                <button
                  onClick={onToggleDim}
                  className="relative w-8 h-4 rounded-full transition-colors coarse-pointer:min-h-11"
                  style={{ backgroundColor: dimOpacity === 0.7 ? '#2563eb' : '#4b5563' }}
                  aria-label={EDITOR_PANELS.DARKEN_OUTSIDE}
                  title={EDITOR_PANELS.DARKEN_OUTSIDE_HELP}
                  aria-pressed={dimOpacity === 0.7}
                >
                  <span
                    className="absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform"
                    style={{ transform: dimOpacity === 0.7 ? 'translateX(16px)' : 'translateX(0)' }}
                  />
                </button>
              </SettingRow>
            </div>
          )}
        </section>
      )}
    </>
  );
}
