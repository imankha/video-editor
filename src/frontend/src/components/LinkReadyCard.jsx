import { Check, Copy, Loader } from 'lucide-react';
import { RESULT_PUBLISH } from '../config/displayNames';

/**
 * LinkReadyCard (T10180 design §2.3) - the small stateless presentational leaf
 * extracted from CollectionShareModal's inline get-link-then-copy fragment
 * (`:212-238` pre-extraction): `creating ? <spinner> : link ? <selectable
 * readonly input + Copy> : <Get Link button>`.
 *
 * Deliberately holds NO state and makes NO API calls -- the caller (each of
 * CollectionShareModal and PublishLinkFlow/DraftReelPreview) owns which
 * gesture/API mints the link; only the render of "does a link exist yet" is
 * shared (design §2.3: extract the leaf, not the machine).
 *
 * @param {string|null} link     - the share URL, or null before creation
 * @param {Function=}   onGetLink - () => void; shown as the "Get Link" trigger
 *                                   when `link` is null. Omit to suppress the
 *                                   trigger (PublishLinkFlow's ready phase
 *                                   always has a link by the time this renders).
 * @param {boolean=}    creating - shows a spinner in place of either state
 * @param {boolean=}    copied   - swaps the Copy icon for a check for 2s (caller-timed)
 * @param {Function}    onCopy   - () => void|Promise; the copy gesture
 */
export function LinkReadyCard({ link, onGetLink, creating = false, copied = false, onCopy }) {
  if (creating) {
    return (
      <div className="flex items-center gap-2 bg-gray-700/50 rounded-lg px-3 py-2">
        <Loader size={14} className="text-gray-400 animate-spin" />
      </div>
    );
  }

  if (!link) {
    return (
      <div className="flex items-center gap-2 bg-gray-700/50 rounded-lg px-3 py-2">
        <button
          type="button"
          onClick={onGetLink}
          className="text-sm text-cyan-400 hover:text-cyan-300 font-medium transition-colors"
        >
          Get Link
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 bg-gray-700/50 rounded-lg px-3 py-2">
      <input
        type="text"
        readOnly
        value={link}
        className="flex-1 bg-transparent text-sm text-gray-300 outline-none truncate"
        onFocus={(e) => e.target.select()}
      />
      <button
        type="button"
        onClick={onCopy}
        aria-label={RESULT_PUBLISH.COPY_LINK}
        title={RESULT_PUBLISH.COPY_LINK}
        className="text-gray-400 hover:text-white transition-colors p-1 flex-shrink-0"
      >
        {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
      </button>
    </div>
  );
}

export default LinkReadyCard;
