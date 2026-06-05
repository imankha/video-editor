import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, Gamepad2, Calendar, MapPin, Trophy, ChevronDown } from 'lucide-react';
import { Button } from './shared/Button';
import { toast } from './shared';
import { GameType } from '../constants/gameConstants';
import { API_BASE } from '../config';
import apiFetch from '../utils/apiFetch';
import { useGamesDataStore } from '../stores/gamesDataStore';

export function EditGameModal({ isOpen, onClose, game }) {
  const [opponentName, setOpponentName] = useState('');
  const [gameDate, setGameDate] = useState('');
  const [gameType, setGameType] = useState(GameType.HOME);
  const [tournamentName, setTournamentName] = useState('');
  const [existingTournaments, setExistingTournaments] = useState([]);
  const [showTournamentDropdown, setShowTournamentDropdown] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const tournamentInputRef = useRef(null);
  const dropdownRef = useRef(null);

  const updateGame = useGamesDataStore(state => state.updateGame);

  useEffect(() => {
    if (isOpen && game) {
      setOpponentName(game.opponent_name || '');
      setGameDate(game.game_date || '');
      setGameType(game.game_type || GameType.HOME);
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

  if (!isOpen || !game) return null;

  return (
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
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Opponent Team *
            </label>
            <input
              type="text"
              value={opponentName}
              onChange={(e) => setOpponentName(e.target.value)}
              placeholder="e.g., Carlsbad SC"
              className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500"
              disabled={isSaving}
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              <Calendar size={14} className="inline mr-1.5" />
              Game Date *
            </label>
            <input
              type="date"
              value={gameDate}
              onChange={(e) => setGameDate(e.target.value)}
              className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500 [color-scheme:dark]"
              disabled={isSaving}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              <MapPin size={14} className="inline mr-1.5" />
              Game Type *
            </label>
            <div className="flex gap-2">
              {[
                { value: GameType.HOME, label: 'Home' },
                { value: GameType.AWAY, label: 'Away' },
                { value: GameType.TOURNAMENT, label: 'Tournament' },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setGameType(option.value)}
                  disabled={isSaving}
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
                  disabled={isSaving}
                />
                {existingTournaments.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowTournamentDropdown(!showTournamentDropdown)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                    disabled={isSaving}
                  >
                    <ChevronDown size={18} className={`transition-transform ${showTournamentDropdown ? 'rotate-180' : ''}`} />
                  </button>
                )}
              </div>

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

              {showTournamentDropdown && tournamentName && filteredTournaments.length === 0 && existingTournaments.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-xl p-2">
                  <p className="text-xs text-gray-400">
                    Press Enter to create new tournament: <span className="text-green-400">{tournamentName}</span>
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="pt-2">
            <Button
              type="submit"
              variant="success"
              size="lg"
              disabled={!isValid || isSaving}
              className="w-full"
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
