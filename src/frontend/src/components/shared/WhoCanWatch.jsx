import { Globe, Lock } from 'lucide-react';
import { SHARE_VISIBILITY } from '../../config/displayNames';

const OPTION_BASE = 'flex-1 min-h-[40px] rounded-md text-sm flex items-center justify-center gap-1.5 transition-colors';

/**
 * WhoCanWatch (T12210) - the labelled two-option visibility control shared by
 * ShareModal and CollectionShareModal. Presentational: `isPublic` and
 * `onChange(nextIsPublic)` come from the owning modal, which keeps its own
 * handler semantics (this only reports a click on the option not selected).
 */
export function WhoCanWatch({ isPublic, onChange }) {
  const option = (value, label, Icon) => {
    const selected = isPublic === value;
    return (
      <button
        type="button"
        aria-pressed={selected}
        onClick={() => { if (!selected) onChange(value); }}
        className={`${OPTION_BASE} ${selected ? 'bg-blue-600 text-white' : 'text-gray-300 hover:text-white'}`}
      >
        <Icon size={14} />
        <span>{label}</span>
      </button>
    );
  };

  return (
    <div className="space-y-1.5">
      <span className="block text-sm text-gray-400">{SHARE_VISIBILITY.LABEL}</span>
      <div className="flex gap-1 bg-gray-700/50 rounded-lg p-1">
        {option(false, SHARE_VISIBILITY.RESTRICTED, Lock)}
        {option(true, SHARE_VISIBILITY.PUBLIC, Globe)}
      </div>
      <p className="text-xs text-gray-400">
        {isPublic ? SHARE_VISIBILITY.PUBLIC_HELP : SHARE_VISIBILITY.RESTRICTED_HELP}
      </p>
    </div>
  );
}

export default WhoCanWatch;
