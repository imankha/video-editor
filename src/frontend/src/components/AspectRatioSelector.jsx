/**
 * AspectRatioSelector component - Simple dropdown to select crop aspect ratio
 */
export default function AspectRatioSelector({ aspectRatio, onAspectRatioChange }) {
  const aspectRatios = [
    { value: '16:9', label: '16:9 Landscape' },
    { value: '9:16', label: '9:16 Portrait' }
  ];

  return (
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
  );
}
