import { useEffect, useMemo, useState } from 'react';
import { Button } from './shared/Button';
import { VeoZipPickList } from './VeoZipPickList';
import { VEO_ROUTING as T } from '../config/displayNames';
import { inspectVeoZip, rankCandidateGames } from '../utils/veoHighlights';

/**
 * T13240: a dropped/picked Veo highlights zip chooses its path. Candidate games (long enough
 * for the last moment, opponent match first) get "Add as suggested plays to {game}" (Path A)
 * ahead of "Upload as clips" (Path B). No candidate: straight to the Path B pick list with a
 * note. Never creates a game. An unreadable / non-Veo zip falls through to the pick list,
 * which reports it.
 *
 * @param {{zipFile: File, games: object[], onSuggest: (game:object, zip:File)=>void,
 *          onUploadClips: (files:File[], meta:object)=>void, onClose: ()=>void}} props
 */
export function VeoZipRouter({ zipFile, games, onSuggest, onUploadClips, onClose }) {
  const [probe, setProbe] = useState({ status: 'checking' }); // checking | done | failed
  const [clips, setClips] = useState(false);

  useEffect(() => {
    let live = true;
    inspectVeoZip(zipFile)
      .then((r) => live && setProbe(r ? { status: 'done', minLengthS: r.minLengthS } : { status: 'failed' }))
      .catch((err) => {
        console.error('[VeoZipRouter] inspect failed:', err);
        if (live) setProbe({ status: 'failed' });
      });
    return () => { live = false; };
  }, [zipFile]);

  const candidates = useMemo(
    () => (probe.status === 'done' ? rankCandidateGames(zipFile.name, probe.minLengthS, games) : []),
    [probe, zipFile, games],
  );

  if (probe.status === 'failed' || clips || (probe.status === 'done' && candidates.length === 0)) {
    return (
      <VeoZipPickList
        zipFile={zipFile}
        onUpload={onUploadClips}
        onClose={onClose}
        note={probe.status === 'done' && !clips ? T.NO_GAME_NOTE : null}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* No backdrop close: a stray tap must not drop the zip or the selection. */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="veo-route-title"
        data-testid="veo-route"
        className="relative bg-gray-800 rounded-xl shadow-2xl w-full max-w-md mx-4 border border-gray-700"
      >
        <h2 id="veo-route-title" className="text-lg font-semibold text-white p-5 border-b border-gray-700">{T.TITLE}</h2>
        <div className="p-4 space-y-3">
          {probe.status === 'checking' && <p className="text-sm text-gray-300" data-testid="veo-route-checking">{T.READING}</p>}
          {candidates.slice(0, 3).map((g, i) => (
            <Button
              key={g.id}
              variant={i === 0 ? 'primary' : 'secondary'}
              size="md"
              className="w-full"
              data-testid="veo-route-suggest"
              onClick={() => onSuggest(g, zipFile)}
            >
              {T.addAsPlays(T.gameLabel(g))}
            </Button>
          ))}
          {probe.status === 'done' && (
            <Button variant="secondary" size="md" className="w-full" data-testid="veo-route-clips" onClick={() => setClips(true)}>
              {T.UPLOAD_AS_CLIPS}
            </Button>
          )}
        </div>
        <div className="p-4 border-t border-gray-700 flex justify-end">
          <Button variant="secondary" size="md" onClick={onClose}>{T.CANCEL}</Button>
        </div>
      </div>
    </div>
  );
}

export default VeoZipRouter;
