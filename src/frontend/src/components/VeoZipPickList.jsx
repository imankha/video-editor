import { useEffect, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from './shared/Button';
import { GameDetailsFields } from './GameDetailsFields';
import { VEO_CLIP_IMPORT as T } from '../config/displayNames';
import { GameType } from '../constants/gameConstants';
import { API_BASE } from '../config';
import apiFetch from '../utils/apiFetch';
import { gameDisplayTitle } from '../utils/gameDisplayTitle';
import { useProfileStore } from '../stores/profileStore';
import {
  readZipEntries, extractEntry, isVeoHighlightsZip, parseEntries, readDurations,
  withDurations, mergeMoments, formatStamp, clipMetaForMoment, filterChips, veoGameTitle, veoGameDetails,
} from '../utils/veoHighlights';

/**
 * T13230: pick list for a Veo highlights zip (Path B, no game). Reads the zip locally,
 * lists merged moments (nothing selected by default, EPIC decision V2), and on confirm
 * extracts each chosen moment's primary entry and hands `(files, metaByFile)` to
 * `onUpload` (the existing useClipUpload path). Nothing is uploaded until that tap.
 *
 * T13245 `gameMode`: the same list, but the tap extracts each picked moment's uploaded entry and
 * hands ONE game payload to `onCreateGame` (one game video per pick, placed at that entry's own
 * Veo stamp, plus one open suggestion per video). Never creates clips.
 *
 * T13246: game mode also shows the Upload game dialog's "Game details (optional)" fields, prefilled
 * only from what the zip NAME says (opponent, a date written in the name). They ride the same
 * payload; nothing is written before the Create tap.
 */
export function VeoZipPickList({ zipFile, onUpload, gameMode = false, onCreateGame, onClose, note = null }) {
  const [state, setState] = useState({ status: 'reading', progress: null }); // reading | ready | error
  const [moments, setMoments] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [activeLabels, setActiveLabels] = useState(() => new Set());
  const [extracting, setExtracting] = useState(false);
  const [prepared, setPrepared] = useState(0);
  const currentProfile = useProfileStore(
    state => (state.profiles || []).find(p => p.id === state.currentProfileId) || null
  );
  const setIntroFact = useProfileStore(state => state.setIntroFact);
  // Read once from the zip name; later edits are the parent's.
  const [zipDetails] = useState(() => (gameMode ? veoGameDetails(zipFile.name, currentProfile?.team) : null));
  const [opponentName, setOpponentName] = useState(zipDetails?.opponentName || '');
  const [gameDate, setGameDate] = useState(zipDetails?.gameDate || '');
  const [gameType, setGameType] = useState(GameType.UNKNOWN);
  const [tournamentName, setTournamentName] = useState('');
  const [existingTournaments, setExistingTournaments] = useState([]);
  const [tournamentsLoaded, setTournamentsLoaded] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(!!(zipDetails?.opponentName || zipDetails?.gameDate));
  const zipTitle = veoGameTitle(zipFile.name);
  const details = { opponentName: opponentName.trim(), gameDate, gameType, tournamentName: tournamentName.trim() };

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const entries = await readZipEntries(zipFile);
        if (!isVeoHighlightsZip(entries)) {
          setState({ status: 'error', message: T.NOT_VEO });
          return;
        }
        const { parsed } = parseEntries(entries);
        const wanted = new Set(parsed.map((p) => p.name));
        const durations = await readDurations(zipFile, entries.filter((e) => wanted.has(e.name)), {
          signal: controller.signal,
          onProgress: (done, total) => setState({ status: 'reading', progress: { done, total } }),
        });
        const { moments: merged } = mergeMoments(withDurations(parsed, durations));
        setMoments(merged.map((m) => ({ ...m, entry: entries.find((e) => e.name === m.entries.find((x) => x.upload).name) })));
        setState({ status: 'ready' });
      } catch (err) {
        if (err.name === 'AbortError') return;
        console.error('[VeoZipPickList] read failed:', err);
        setState({ status: 'error', message: T.READ_FAILED });
      }
    })();
    return () => controller.abort();
  }, [zipFile]);

  const chips = useMemo(() => filterChips(moments), [moments]);
  const visible = useMemo(
    () => moments.map((m, i) => ({ m, i })).filter(({ m }) => activeLabels.size === 0 || m.labels.some((l) => activeLabels.has(l))),
    [moments, activeLabels],
  );

  const toggle = (set, setSet, key) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    setSet(next);
  };

  // Gesture: picking Tournament loads the existing tournaments for the dropdown (read-only GET).
  const handleGameType = (next) => {
    setGameType(next);
    if (next !== GameType.TOURNAMENT || tournamentsLoaded) return;
    setTournamentsLoaded(true);
    apiFetch(`${API_BASE}/api/games/tournaments`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => setExistingTournaments(data.tournaments || []))
      .catch((err) => {
        console.error('Failed to fetch tournaments:', err);
        setExistingTournaments([]);
      });
  };

  const handleCreateGame = async () => {
    setExtracting(true);
    setPrepared(0);
    try {
      // Placement comes from the UPLOADED entry's own stamp and length, not the merged group's.
      const picked = [...selected]
        .map((i) => ({ m: moments[i], up: moments[i].entries.find((e) => e.upload) }))
        .sort((a, b) => a.up.stamp_s - b.up.stamp_s);
      const files = [];
      for (const { m, up } of picked) {
        const file = await extractEntry(zipFile, m.entry);
        files.push({ file, sequence: files.length + 1, offset_seconds: up.stamp_s, durationS: up.durationS });
        setPrepared(files.length);
      }
      onCreateGame({
        name: zipTitle,
        opponentName: details.opponentName,
        gameDate,
        gameType,
        tournamentName: gameType === GameType.TOURNAMENT ? details.tournamentName : null,
        files,
        // Each moment spans its whole video; its end is that video's created duration, set
        // when the game is created (AnnotateContainer), so it is not repeated here.
        veoSuggestions: picked.map(({ m }, i) => ({ video_sequence: i + 1, start: 0, labels: m.labels })),
      });
      // Same rule as the Upload game dialog: confirm the zip's team onto a profile that has none.
      if (zipDetails?.ourTeamName && currentProfile && !currentProfile.team) {
        try {
          await setIntroFact(currentProfile.id, 'team', zipDetails.ourTeamName);
        } catch (err) {
          console.error('Failed to save team name to profile:', err);
        }
      }
    } catch (err) {
      console.error('[VeoZipPickList] extract failed:', err);
      setState({ status: 'error', message: T.READ_FAILED });
      setExtracting(false);
    }
  };

  const handleAdd = async () => {
    setExtracting(true);
    try {
      const files = [];
      const metaByFile = {};
      for (const i of [...selected].sort((a, b) => a - b)) {
        const m = moments[i];
        const file = await extractEntry(zipFile, m.entry);
        files.push(file);
        metaByFile[file.name] = clipMetaForMoment(m);
      }
      onUpload(files, metaByFile);
    } catch (err) {
      console.error('[VeoZipPickList] extract failed:', err);
      setState({ status: 'error', message: T.READ_FAILED });
      setExtracting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* No backdrop close: a stray tap must not drop the zip or the selection. */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="veo-pick-title"
        data-testid="veo-pick-list"
        className="relative bg-gray-800 rounded-xl shadow-2xl w-full max-w-md mx-4 border border-gray-700 flex flex-col max-h-[85vh]"
      >
        <h2 id="veo-pick-title" className="text-lg font-semibold text-white p-5 border-b border-gray-700">{gameMode ? T.GAME_TITLE : T.TITLE}</h2>

        <div className="p-4 overflow-y-auto flex-1 min-h-0">
          {note && <p className="text-sm text-gray-300 mb-3" data-testid="veo-pick-note">{note}</p>}
          {state.status === 'reading' && (
            <p className="text-sm text-gray-300" data-testid="veo-reading">
              {T.READING}{state.progress ? ` ${state.progress.done}/${state.progress.total}` : ''}
            </p>
          )}
          {state.status === 'error' && (
            <p role="alert" className="text-sm text-red-300" data-testid="veo-error">{state.message}</p>
          )}
          {state.status === 'ready' && (
            <>
              <div className="flex flex-wrap gap-2 mb-3">
                {chips.map(({ label, count }) => (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={activeLabels.has(label)}
                    onClick={() => toggle(activeLabels, setActiveLabels, label)}
                    className={`min-h-11 px-3 rounded-full text-sm ${activeLabels.has(label) ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-200'}`}
                  >
                    {label} {count}
                  </button>
                ))}
              </div>
              <div className="flex gap-3 mb-2 text-sm">
                <button type="button" className="min-h-11 text-blue-300"
                  onClick={() => setSelected(new Set([...selected, ...visible.map(({ i }) => i)]))}>{T.SELECT_ALL}</button>
                <button type="button" className="min-h-11 text-gray-300" onClick={() => setSelected(new Set())}>{T.CLEAR}</button>
              </div>
              <ul>
                {visible.map(({ m, i }) => (
                  <li key={i}>
                    <label className="flex items-center gap-3 min-h-11 text-sm text-gray-100 cursor-pointer">
                      <input type="checkbox" checked={selected.has(i)} onChange={() => toggle(selected, setSelected, i)} />
                      <span className="flex-1">{m.labels[0]}</span>
                      <span className="text-gray-300">{formatStamp(m.stamp_s)}</span>
                      <span className="text-gray-400 w-10 text-right">{T.durationLabel(m.duration_s)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        {gameMode && state.status === 'ready' && (
          <div className="px-4 pb-3 flex-shrink-0 max-h-[40vh] overflow-y-auto">
            <details
              data-testid="game-details-disclosure"
              className="group rounded-lg border border-gray-700 bg-gray-900/40"
              open={detailsOpen}
              onToggle={(e) => setDetailsOpen(e.currentTarget.open)}
            >
              <summary className="flex items-center justify-between cursor-pointer select-none px-3 py-2.5 text-sm font-medium text-gray-300 hover:text-white marker:content-['']">
                <span>{T.DETAILS_SUMMARY}</span>
                <ChevronDown size={16} className="text-gray-400 transition-transform group-open:rotate-180" />
              </summary>
              <div className="px-3 pb-3 pt-1 space-y-4">
                <p className="text-xs text-gray-500">{zipDetails ? T.DETAILS_FROM_ZIP : T.DETAILS_LATER}</p>
                <GameDetailsFields
                  opponentName={opponentName}
                  setOpponentName={setOpponentName}
                  gameDate={gameDate}
                  setGameDate={setGameDate}
                  gameType={gameType}
                  setGameType={handleGameType}
                  tournamentName={tournamentName}
                  setTournamentName={setTournamentName}
                  existingTournaments={existingTournaments}
                  disabled={extracting}
                />
                <p className="text-xs text-gray-400" data-testid="veo-title-preview">
                  {T.titlePreview(gameDisplayTitle(details, zipTitle))}
                </p>
              </div>
            </details>
          </div>
        )}

        <div className="p-4 border-t border-gray-700 flex gap-3 justify-end">
          <Button variant="secondary" size="md" onClick={onClose}>{T.CANCEL}</Button>
          {state.status === 'ready' && (
            <Button variant="success" size="md" disabled={selected.size === 0 || extracting} onClick={gameMode ? handleCreateGame : handleAdd} data-testid="veo-add">
              {extracting
                ? (gameMode ? T.extractingGame(prepared, selected.size) : T.EXTRACTING)
                : (selected.size === 0 ? T.NONE_SELECTED : (gameMode ? T.createGameButton(selected.size) : T.addButton(selected.size)))}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export default VeoZipPickList;
