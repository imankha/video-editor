import { Button } from '../../../components/shared/Button';
import { VEO_SUGGESTIONS as T } from '../../../config/displayNames';
import { SuggestedPlaysList } from './SuggestedPlaysList';
import { VeoImportSheet } from './VeoImportSheet';

/**
 * T13220: the suggested-plays surface under the Annotate player: import sheet (modal), the
 * one-time alignment card ("Does the play start here?"), and the rate-to-keep list. `suggested`
 * is the bundle from useAnnotateSuggestions; renders nothing until there is something to show.
 */
export function SuggestedPlaysPanel({ suggested }) {
  if (!suggested) return null;
  const { sheet, align, list } = suggested;
  return (
    <>
      {sheet && <VeoImportSheet {...sheet} />}
      {align && (
        <div data-testid="veo-align-card" className="rounded-lg border border-fuchsia-500/40 bg-fuchsia-950/30 p-3 space-y-2">
          <p className="text-sm font-medium text-white">{T.ALIGN_QUESTION}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="md" onClick={() => align.onShift(-1)}>{T.EARLIER}</Button>
            <Button variant="secondary" size="md" onClick={() => align.onShift(1)}>{T.LATER}</Button>
            <Button variant="success" size="md" onClick={align.onDone}>{T.LOOKS_RIGHT}</Button>
          </div>
          <button type="button" onClick={align.onRemove} className="min-h-11 text-sm text-gray-300 underline">
            {T.REMOVE_IMPORT}
          </button>
        </div>
      )}
      {list.suggestions.length > 0 && <SuggestedPlaysList {...list} />}
    </>
  );
}

export default SuggestedPlaysPanel;
