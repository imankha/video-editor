import { Crop, X, Check } from 'lucide-react';

/**
 * CropControls component - UI controls for the crop tool
 * Includes aspect ratio selector and crop tool activation
 */
export default function CropControls({
  isCropActive,
  aspectRatio,
  onToggleCrop,
  onAspectRatioChange,
  onClearCrop,
  hasKeyframes
}) {
  const aspectRatios = [
    { value: '16:9', label: '16:9 (Landscape)' },
    { value: '9:16', label: '9:16 (Portrait)' },
    { value: '1:1', label: '1:1 (Square)' },
    { value: '4:3', label: '4:3 (Classic)' },
    { value: 'free', label: 'Free' }
  ];

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 mb-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-white font-medium flex items-center gap-2">
          <Crop size={18} />
          Crop Tool
        </h3>

        <div className="flex gap-2">
          {hasKeyframes && (
            <button
              onClick={onClearCrop}
              className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-sm flex items-center gap-1 transition-colors"
              title="Clear all crop keyframes"
            >
              <X size={14} />
              Clear
            </button>
          )}

          <button
            onClick={onToggleCrop}
            className={`px-4 py-1 rounded text-sm font-medium transition-colors flex items-center gap-1 ${
              isCropActive
                ? 'bg-blue-600 hover:bg-blue-700 text-white'
                : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
            }`}
          >
            {isCropActive ? (
              <>
                <Check size={14} />
                Active
              </>
            ) : (
              <>
                <Crop size={14} />
                Activate
              </>
            )}
          </button>
        </div>
      </div>

      {isCropActive && (
        <div className="space-y-3">
          <div>
            <label className="text-sm text-gray-400 mb-2 block">
              Aspect Ratio
            </label>
            <div className="flex flex-wrap gap-2">
              {aspectRatios.map((ratio) => (
                <button
                  key={ratio.value}
                  onClick={() => onAspectRatioChange(ratio.value)}
                  className={`px-3 py-2 rounded text-sm transition-colors ${
                    aspectRatio === ratio.value
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                  }`}
                >
                  {ratio.label}
                </button>
              ))}
            </div>
          </div>

          <div className="text-xs text-gray-500 bg-gray-900 p-3 rounded">
            <p className="mb-1">
              <strong>Tip:</strong> Move or resize the crop rectangle to create keyframes.
            </p>
            <p>
              The crop will animate smoothly between keyframes during export.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
