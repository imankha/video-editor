import React, { useState, useEffect, useCallback } from 'react';
import { X, Gamepad2 } from 'lucide-react';
import { Button } from './shared/Button';
import { GameDetailsFields } from './GameDetailsFields';
import { toast } from './shared';
import { GameType } from '../constants/gameConstants';
import { API_BASE } from '../config';
import apiFetch from '../utils/apiFetch';
import { useGamesDataStore } from '../stores/gamesDataStore';
import Guide from './instructions/Guide';
import { resolveGuide } from './instructions/resolveGuide';
import { GuideScope } from './instructions/GuideScope';
import { GUIDE_PULSE } from './instructions/guideTargets';

export function EditGameModal({ isOpen, onClose, game }) {
  const [opponentName, setOpponentName] = useState('');
  const [gameDate, setGameDate] = useState('');
  const [gameType, setGameType] = useState(GameType.UNKNOWN);
  const [tournamentName, setTournamentName] = useState('');
  const [existingTournaments, setExistingTournaments] = useState([]);
  const [isSaving, setIsSaving] = useState(false);

  const updateGame = useGamesDataStore(state => state.updateGame);

  useEffect(() => {
    if (isOpen && game) {
      setOpponentName(game.opponent_name || '');
      setGameDate(game.game_date || '');
      setGameType(game.game_type || GameType.UNKNOWN);
      setTournamentName(game.tournament_name || '');

      apiFetch(`${API_BASE}/api/games/tournaments`)
        .then(res => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .then(data => setExistingTournaments(data.tournaments || []))
        .catch(() => setExistingTournaments([]));
    }
  }, [isOpen, game]);

  const isValid = opponentName.trim() && gameDate;

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    if (!isValid || !game) return;

    setIsSaving(true);
    try {
      await updateGame(game.id, {
        opponent_name: opponentName.trim(),
        game_date: gameDate,
        game_type: gameType,
        tournament_name: gameType === GameType.TOURNAMENT ? tournamentName.trim() : '',
      });
      toast.success('Game updated');
      onClose();
    } catch (err) {
      toast.error(err.message || 'Failed to update game');
    } finally {
      setIsSaving(false);
    }
  }, [isValid, game, opponentName, gameDate, gameType, tournamentName, updateGame, onClose]);

  const handleClose = useCallback(() => {
    if (isSaving) return;
    onClose();
  }, [isSaving, onClose]);

  // T12690: Escape closes like the X / Cancel (no-op mid-save), same contract as GameDetailsModal.
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (e) => { if (e.key === 'Escape') handleClose(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, handleClose]);

  if (!isOpen || !game) return null;

  const guide = resolveGuide({ screen: 'modal', local: { modal: 'edit-game' } });

  return (
    <GuideScope guides={[guide]}>
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      <div className="relative bg-gray-800 rounded-xl shadow-2xl w-full max-w-md mx-4 border border-gray-700">
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-600/20 rounded-lg">
              <Gamepad2 size={20} className="text-green-400" />
            </div>
            <h2 className="text-lg font-semibold text-white">Edit Game Details</h2>
          </div>
          <button
            onClick={handleClose}
            disabled={isSaving}
            className="p-1 text-gray-400 hover:text-white rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <Guide guide={guide} inline testId="modal-guide" />
          <GameDetailsFields
            opponentName={opponentName}
            setOpponentName={setOpponentName}
            gameDate={gameDate}
            setGameDate={setGameDate}
            gameType={gameType}
            setGameType={setGameType}
            tournamentName={tournamentName}
            setTournamentName={setTournamentName}
            existingTournaments={existingTournaments}
            disabled={isSaving}
            required
            autoFocusOpponent
          />

          <div className="pt-2">
            <Button
              type="submit"
              variant="success"
              size="lg"
              disabled={!isValid || isSaving}
              className="w-full"
              data-testid={GUIDE_PULSE.EDIT_GAME_SAVE}
              guideTarget={GUIDE_PULSE.EDIT_GAME_SAVE}
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </div>
    </div>
    </GuideScope>
  );
}
