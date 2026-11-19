import { useState } from 'react';
import { RotateCw } from 'lucide-react';
import AspectRatioSelector from '../AspectRatioSelector';
import ShapeSwitchConfirm from '../../modes/focus/ShapeSwitchConfirm';
import { Toggle } from '../shared';
import SettingRow from './SettingRow';
import SettingsPanel from './SettingsPanel';
import { ratioWithName } from '../../constants/aspectRatios';
import { EDITOR_PANELS, FRAME_COPY } from '../../config/displayNames';

/**
 * FocusSettingsPanel (T9270) — the Focus "Settings" tab body. Re-homes the controls
 * that used to live in the above-video toolbar (aspect selector, audio, straighten)
 * into the shared SettingRow / SettingsPanel anatomy:
 *
 *   Highlight          - applies to every clip (shape, include audio). T17230: the
 *                        Shape row is the one lasting shape control; with box
 *                        positions placed (`hasPositions`) a switch asks first.
 *   Fix a tilted camera - the straighten tool, plain label (T12180). T17870: shown
 *                        directly (the panel has room; no 'More options' disclosure)
 *                        and the dim setting is removed (Preview shows the framed
 *                        result). T10395: zoom lives on the video's own Controls bar.
 *
 * The straighten line-drag tool stays DESKTOP-ONLY exactly as it was gated in the
 * old toolbar: `desktopOnly` is false in the mobile drawer, which drops the
 * straighten row entirely (Step 4). One accent: blue-600.
 */
export default function FocusSettingsPanel({
  globalAspectRatio,
  onAspectRatioChange,
  hasPositions = false,
  includeAudio,
  onIncludeAudioChange,
  straightenVisible,
  onToggleStraighten,
  desktopOnly = true,
}) {
  const [pendingRatio, setPendingRatio] = useState(null);
  const chooseShape = (ratio) => {
    if (ratio === globalAspectRatio) return;
    if (hasPositions) {
      setPendingRatio(ratio);
      return;
    }
    onAspectRatioChange(ratio);
  };
  const confirmShape = () => {
    const ratio = pendingRatio;
    setPendingRatio(null);
    onAspectRatioChange(ratio);
  };
  return (
    <>
      <SettingsPanel title={FRAME_COPY.SETTINGS_TITLE}>
        <SettingRow label={FRAME_COPY.SHAPE_LABEL} value={ratioWithName(globalAspectRatio)}>
          <AspectRatioSelector
            aspectRatio={globalAspectRatio}
            onAspectRatioChange={chooseShape}
          />
        </SettingRow>
        {pendingRatio && (
          <ShapeSwitchConfirm
            fromRatio={globalAspectRatio}
            toRatio={pendingRatio}
            onConfirm={confirmShape}
            onKeep={() => setPendingRatio(null)}
          />
        )}
        <SettingRow label="Include audio" value={includeAudio ? 'On' : 'Off'}>
          {/* T10820 (known-failures row 32): this Toggle renders on mobile too (not
              gated by desktopOnly), and its default h-7 track (28px) sits under the
              44px coarse-pointer touch floor. `min-height` is set on the same element
              that paints the track, so `coarse-pointer:min-h-11` grows the track itself
              to 44px tall on touch (the pill reads taller there; the thumb stays
              centred) — it does nothing on a fine pointer, where the 28px track ships
              unchanged. Same pattern as the straighten button below. */}
          <Toggle
            checked={includeAudio}
            onChange={onIncludeAudioChange}
            title={FRAME_COPY.AUDIO_HINT}
            className="coarse-pointer:min-h-11"
          />
        </SettingRow>
      </SettingsPanel>

      {/* T17870: Fix a tilted camera shows directly (no disclosure). The line-drag
          straighten TOOL stays desktop-only exactly as before. */}
      {desktopOnly && (
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
      )}
    </>
  );
}
