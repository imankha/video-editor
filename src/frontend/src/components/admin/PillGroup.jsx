// Segmented pill group, same look as the T13990 dimension pills: one pressed button.
// T16850: moved out of JourneyTab so AdminScreen's Sport filter shares it.
export function PillGroup({ label, options, value, onChange }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1">
      <span className="text-gray-500 text-xs mr-1">{label}</span>
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
            value === o.value
              ? 'bg-purple-500/30 text-purple-300 border border-purple-500/40'
              : 'text-gray-400 hover:text-gray-300 border border-white/10 hover:border-white/20'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
