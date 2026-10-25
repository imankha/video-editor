import React, { useState, useRef, useEffect } from 'react';
import { Calendar, MapPin, Trophy, ChevronDown } from 'lucide-react';
import { GameType } from '../constants/gameConstants';

const GAME_TYPE_OPTIONS = [
  { value: GameType.UNKNOWN, label: 'Unknown' },
  { value: GameType.HOME, label: 'Home' },
  { value: GameType.AWAY, label: 'Away' },
  { value: GameType.TOURNAMENT, label: 'Tournament' },
];

// Presentational Opponent / Game Date / Game Type / Tournament block shared by
// GameDetailsModal (upload), EditGameModal and the Veo "make a game" pick list.
// The tournament dropdown's open/close state is local; values and the
// existing-tournaments list belong to the caller. `required` adds the `*` marks
// EditGameModal shows.
export function GameDetailsFields({
  opponentName,
  setOpponentName,
  gameDate,
  setGameDate,
  gameType,
  setGameType,
  tournamentName,
  setTournamentName,
  existingTournaments,
  disabled = false,
  required = false,
  autoFocusOpponent = false,
}) {
  const [showTournamentDropdown, setShowTournamentDropdown] = useState(false);
  const tournamentInputRef = useRef(null);
  const dropdownRef = useRef(null);
  const star = required ? ' *' : '';

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

  return (
    <>
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1.5">
          Opponent Team{star}
        </label>
        <input
          type="text"
          value={opponentName}
          onChange={(e) => setOpponentName(e.target.value)}
          placeholder="e.g., Carlsbad SC"
          className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500"
          disabled={disabled}
          autoFocus={autoFocusOpponent}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1.5">
          <Calendar size={14} className="inline mr-1.5" />
          Game Date{star}
        </label>
        <input
          type="date"
          value={gameDate}
          onChange={(e) => setGameDate(e.target.value)}
          className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500 [color-scheme:dark]"
          disabled={disabled}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1.5">
          <MapPin size={14} className="inline mr-1.5" />
          Game Type{star}
        </label>
        <div className="flex gap-2">
          {GAME_TYPE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setGameType(option.value)}
              disabled={disabled}
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
              disabled={disabled}
            />
            {existingTournaments.length > 0 && (
              <button
                type="button"
                onClick={() => setShowTournamentDropdown(!showTournamentDropdown)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                disabled={disabled}
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
    </>
  );
}

export default GameDetailsFields;
