import { Clipboard } from 'lucide-react';

/**
 * AspectRatioSelector component - Simple dropdown to select crop aspect ratio with paste button
 */
export default function AspectRatioSelector({ aspectRatio, onAspectRatioChange, copiedCrop, onPasteCrop }) {
  const aspectRatios = [
    { value: '16:9', label: '16:9 Landscape' },
    { value: '9:16', label: '9:16 Portrait' }
  ];

  return (
    <div className="inline-flex items-center gap-3">
      <div className="inline-block">
        <label className="text-sm text-gray-400 mr-2">Crop Aspect Ratio:</label>
        <select
          value={aspectRatio}
          onChange={(e) => onAspectRatioChange(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer hover:bg-gray-700 transition-colors"
        >
          {aspectRatios.map((ratio) => (
            <option key={ratio.value} value={ratio.value}>
              {ratio.label}
            </option>
          ))}
        </select>
      </div>

      {/* Paste Crop Button */}
      {onPasteCrop && (
        <button
          onClick={onPasteCrop}
          disabled={!copiedCrop}
          className={`inline-flex items-center gap-1.5 px-3 py-2 rounded text-sm font-medium transition-all ${
            copiedCrop
              ? 'bg-green-600 hover:bg-green-700 text-white cursor-pointer'
              : 'bg-gray-700 text-gray-500 cursor-not-allowed opacity-60'
          }`}
          title={copiedCrop ? 'Paste copied crop (Ctrl+V)' : 'No crop copied'}
        >
          <Clipboard size={14} />
          <span>Paste Crop</span>
        </button>
      )}
    </div>
  );
}
