import React, { useState, useRef, useCallback, useEffect, useMemo, lazy, Suspense } from 'react';
import { X, Gamepad2, Calendar, MapPin, Trophy, ChevronDown, ChevronRight, Coins } from 'lucide-react';
import { Button } from './shared/Button';

const BuyCreditsModal = lazy(() => import('./BuyCreditsModal').then(m => ({ default: m.BuyCreditsModal })));
import { toast } from './shared';
import { GameType } from '../constants/gameConstants';
import { GameFootagePicker } from './GameFootagePicker';
import { useCreditStore } from '../stores/creditStore';
import { useQuestStore } from '../stores/questStore';
import { calculateUploadCost } from '../utils/storageCost';
import { API_BASE } from '../config';
import apiFetch from '../utils/apiFetch';

// Local calendar day as YYYY-MM-DD for the date input's default. NOT
// toISOString() - that is UTC and rolls to tomorrow/yesterday near midnight.
export function localTodayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Shown in the game tile name when the user submits without opening the
// details disclosure ("Vs Unnamed opponent Sep 3"); editable via Edit Game.
// An empty opponent would make the backend fall back to the bare "New Game".
const OPPONENT_PLACEHOLDER = 'Unnamed opponent';

export function GameDetailsModal({ isOpen, onClose, onCreateGame }) {
  const [opponentName, setOpponentName] = useState('');
  const [gameDate, setGameDate] = useState(localTodayISO);
  const [gameType, setGameType] = useState(GameType.UNKNOWN);
  const [tournamentName, setTournamentName] = useState('');
  const [existingTournaments, setExistingTournaments] = useState([]);
  const [showTournamentDropdown, setShowTournamentDropdown] = useState(false);
  // T8810: the universal footage picker reports its plan up here — an ordered,
  // uniform list ({file, sequence}) whether the user picked one file, many, or a
  // folder. `pickerKey` remounts the picker (and its useFootageIntake) to reset it.
  const [footage, setFootage] = useState({ files: [], totalBytes: 0, proxies: {} });
  const [pickerKey, setPickerKey] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showBuyCredits, setShowBuyCredits] = useState(false);
  const creditBalance = useCreditStore(state => state.balance);
  const creditsLoaded = useCreditStore(state => state.loaded);
  const fetchCredits = useCreditStore(state => state.fetchCredits);
  const tournamentInputRef = useRef(null);
  const dropdownRef = useRef(null);

  // Fetch existing tournaments when modal opens
  useEffect(() => {
    if (isOpen) {
      apiFetch(`${API_BASE}/api/games/tournaments`)
        .then(res => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .then(data => {
          setExistingTournaments(data.tournaments || []);
        })
        .catch(err => {
          console.error('Failed to fetch tournaments:', err);
          setExistingTournaments([]);
        });
    }
  }, [isOpen]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target) &&
          tournamentInputRef.current && !tournamentInputRef.current.contains(event.target)) {
        setShowTournamentDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredTournaments = existingTournaments.filter(t =>
    t.toLowerCase().includes(tournamentName.toLowerCase())
  );

  // T7890: pre-upload funnel beacon — the moment a file is actually chosen (input
  // or drop, single or multi), which is the gesture BEFORE the details form and the
  // prepare POST. Fired here (not at upload start) so a user who picks a file but
  // dies at the form / the T7590 short-viewport dead-end / navigation is
  // distinguishable from one who never picked a file (task acceptance criterion).
  // Fire-and-forget + session-deduped, so every path records "File Selected" once
  // and selection is never delayed. Not a quest step — analytics only.
  const recordFileSelected = useCallback(() => {
    useQuestStore.getState().recordAchievement('upload_file_selected');
  }, []);

  // T8810: the picker owns all selection paths (click, multi, folder pick/drag)
  // and reports the normalized plan here. Memory-only lift of form state — never a
  // store/backend write, so the reactive-persistence ban does not apply.
  const handleFootageChange = useCallback((next) => {
    setFootage(next);
  }, []);

  // T8500: only the video gates submit - every metadata field has a default.
  // T8810: any number of files ≥1 is valid (single file = 1-element list).
  const isValid = footage.files.length >= 1;

  const uploadCost = useMemo(() => {
    if (footage.files.length >= 1) {
      return calculateUploadCost(footage.totalBytes);
    }
    return null;
  }, [footage]);

  // Cost shown before a file is picked: calculateUploadCost(0) is the 1-credit
  // storage minimum + the auto-export surcharge (= 2 credits today). Once a
  // file is selected the real size-based cost replaces it.
  const displayCost = uploadCost ?? calculateUploadCost(0);

  const resetForm = useCallback(() => {
    setOpponentName('');
    setGameDate(localTodayISO());
    setGameType(GameType.UNKNOWN);
    setTournamentName('');
    setShowTournamentDropdown(false);
    setFootage({ files: [], totalBytes: 0, proxies: {} });
    setPickerKey(k => k + 1); // remount the picker to clear its intake state
  }, []);

  const submitGame = useCallback(async () => {
    setIsSubmitting(true);
    try {
      // T8810: uniform ordered list — a single file is a 1-element list. No videoMode.
      const gameDetails = {
        opponentName: opponentName.trim() || OPPONENT_PLACEHOLDER,
        gameDate,
        gameType,
        tournamentName: gameType === GameType.TOURNAMENT ? tournamentName.trim() : null,
        files: footage.files,
      };

      await onCreateGame(gameDetails);
      resetForm();
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  }, [opponentName, gameDate, gameType, tournamentName, footage, onCreateGame, onClose, resetForm]);

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    if (!isValid) return;

    // Only block optimistically once we actually know the balance. Before
    // credits load (default 0), defer to the authoritative backend check in
    // prepare-upload so a slow/cold load can't trigger a false paywall.
    if (creditsLoaded && uploadCost !== null && creditBalance < uploadCost) {
      setShowBuyCredits(true);
      return;
    }

    await submitGame();
  }, [isValid, uploadCost, creditBalance, submitGame]);

  const handlePaymentSuccess = useCallback(async () => {
    setShowBuyCredits(false);
    await fetchCredits();
    toast.success('Credits purchased! Creating your game...');
    await submitGame();
  }, [fetchCredits, submitGame]);

  const handleClose = useCallback(() => {
    if (isSubmitting) return;
    resetForm();
    onClose();
  }, [isSubmitting, onClose, resetForm]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop — no dismiss on click; use X button instead */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      {/* Modal — max-h + internal scroll so the tall form's header (close X) and
          submit button stay reachable on short mobile viewports. Without this the
          panel is fixed-centered and taller than a ~500px iPhone screen, clipping
          both ends off-screen with nothing to scroll (T7590). */}
      <div className="relative bg-gray-800 rounded-xl shadow-2xl w-full max-w-md mx-4 border border-gray-700 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-600/20 rounded-lg">
              <Gamepad2 size={20} className="text-green-400" />
            </div>
            <h2 className="text-lg font-semibold text-white">Add New Game</h2>
          </div>
          <button
            onClick={handleClose}
            disabled={isSubmitting}
            className="p-1 text-gray-400 hover:text-white rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            <X size={20} />
          </button>
        </div>

        {/* Form - video-first (T8500): cost up top, dropzone as the hero,
            every metadata field defaulted inside a collapsed disclosure so an
            upload takes two gestures (pick file, submit). */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Upload cost - visible BEFORE any file is selected (the first
              mention of credits/expiry a new user sees). */}
          <div className="flex items-center justify-between px-3 py-2 rounded-lg text-sm bg-gray-700/50 text-gray-300">
            <div className="flex items-center gap-2">
              <Coins size={14} className="text-yellow-400 shrink-0" />
              <span>{displayCost} credit{displayCost !== 1 ? 's' : ''} - keeps your video for 30 days</span>
            </div>
            <span className="font-medium text-white">Balance: {creditsLoaded ? creditBalance : '…'}</span>
          </div>

          {/* T8810: universal footage picker — one dropzone for a single file, many
              files, or a whole camera folder. Replaces the old Per Game / Per Half
              toggle and its twin dropzones. */}
          <GameFootagePicker
            key={pickerKey}
            onFootageChange={handleFootageChange}
            onFileSelected={recordFileSelected}
            isSubmitting={isSubmitting}
          />

          {/* T8700: Opponent + Date are surfaced as first-class fields (out of
              the old collapsed "optional" disclosure) — live-testing feedback was
              that these feel wanted at creation, not skippable. Still non-blocking:
              both carry defaults (placeholder opponent, today) so submit is gated
              on the video alone (T8500). */}
          <div className="space-y-4">
            {/* Opponent Name */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">
                Opponent Team
              </label>
              <input
                type="text"
                value={opponentName}
                onChange={(e) => setOpponentName(e.target.value)}
                placeholder="e.g., Carlsbad SC"
                className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500"
                disabled={isSubmitting}
              />
            </div>

            {/* Game Date */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">
                <Calendar size={14} className="inline mr-1.5" />
                Game Date
              </label>
              <input
                type="date"
                value={gameDate}
                onChange={(e) => setGameDate(e.target.value)}
                className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500 [color-scheme:dark]"
                disabled={isSubmitting}
              />
            </div>
          </div>

          {/* More options - the truly-advanced create-time settings stay in a
              collapsed disclosure so the two-gesture upload (T8500) survives. */}
          <details className="group rounded-lg border border-gray-700 bg-gray-900/30" data-testid="game-details-disclosure">
            <summary className="flex items-center gap-2 px-3 py-2 text-sm text-gray-300 cursor-pointer select-none list-none hover:text-white [&::-webkit-details-marker]:hidden">
              <ChevronRight size={16} className="text-gray-400 shrink-0 transition-transform group-open:rotate-90" />
              More options
            </summary>
            <div className="px-3 pb-3 pt-1 space-y-4">

              {/* Game Type */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">
                  <MapPin size={14} className="inline mr-1.5" />
                  Game Type
                </label>
                <div className="flex gap-2">
                  {[
                    { value: GameType.UNKNOWN, label: 'Unknown' },
                    { value: GameType.HOME, label: 'Home' },
                    { value: GameType.AWAY, label: 'Away' },
                    { value: GameType.TOURNAMENT, label: 'Tournament' },
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setGameType(option.value)}
                      disabled={isSubmitting}
                      className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                        gameType === option.value
                          ? 'bg-green-600 text-white'
                          : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                      } disabled:opacity-50`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tournament Name (conditional) */}
              {gameType === GameType.TOURNAMENT && (
                <div className="relative">
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">
                    <Trophy size={14} className="inline mr-1.5" />
                    Tournament Name
                  </label>
                  <div className="relative">
                    <input
                      ref={tournamentInputRef}
                      type="text"
                      value={tournamentName}
                      onChange={(e) => {
                        setTournamentName(e.target.value);
                        setShowTournamentDropdown(true);
                      }}
                      onFocus={() => setShowTournamentDropdown(true)}
                      placeholder={existingTournaments.length > 0 ? "Select or type new tournament" : "e.g., West Coast Tournament"}
                      className="w-full px-3 py-2 pr-8 bg-gray-900 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500"
                      disabled={isSubmitting}
                    />
                    {existingTournaments.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowTournamentDropdown(!showTournamentDropdown)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                        disabled={isSubmitting}
                      >
                        <ChevronDown size={18} className={`transition-transform ${showTournamentDropdown ? 'rotate-180' : ''}`} />
                      </button>
                    )}
                  </div>

                  {/* Tournament dropdown */}
                  {showTournamentDropdown && filteredTournaments.length > 0 && (
                    <div
                      ref={dropdownRef}
                      className="absolute z-10 w-full mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-xl max-h-48 overflow-y-auto"
                    >
                      {filteredTournaments.map((tournament) => (
                        <button
                          key={tournament}
                          type="button"
                          onClick={() => {
                            setTournamentName(tournament);
                            setShowTournamentDropdown(false);
                          }}
                          className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-700 transition-colors ${
                            tournamentName === tournament ? 'bg-green-600/20 text-green-400' : 'text-gray-200'
                          }`}
                        >
                          {tournament}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Show hint if there are existing tournaments but none match */}
                  {showTournamentDropdown && tournamentName && filteredTournaments.length === 0 && existingTournaments.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-xl p-2">
                      <p className="text-xs text-gray-400">
                        Press Enter to create new tournament: <span className="text-green-400">{tournamentName}</span>
                      </p>
                    </div>
                  )}
                </div>
              )}

            </div>
          </details>

          {/* Submit Button */}
          <div className="pt-2">
            <Button
              type="submit"
              variant="success"
              size="lg"
              disabled={!isValid || isSubmitting}
              className="w-full"
            >
              {isSubmitting ? 'Adding Game...' : 'Add Game'}
            </Button>
          </div>
        </form>
      </div>

      {showBuyCredits && (
        <Suspense fallback={null}>
          <BuyCreditsModal
            onClose={() => setShowBuyCredits(false)}
            onPaymentSuccess={handlePaymentSuccess}
          />
        </Suspense>
      )}
    </div>
  );
}

export default GameDetailsModal;
