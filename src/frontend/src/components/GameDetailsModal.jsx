import React, { useState, useRef, useCallback, useEffect } from 'react';
import { X, Upload, Gamepad2, Calendar, MapPin, Trophy, ChevronDown } from 'lucide-react';
import { Button } from './shared/Button';

const API_BASE = import.meta.env.VITE_API_URL || '';

/**
 * GameDetailsModal - Modal for entering game details before creating a game
 *
 * Collects:
 * - Opponent team name (required)
 * - Game date (required)
 * - Game type: home, away, or tournament
 * - Tournament name (if tournament) - with dropdown of existing tournaments
 * - Video file upload
 */
export function GameDetailsModal({ isOpen, onClose, onCreateGame }) {
  const [opponentName, setOpponentName] = useState('');
  const [gameDate, setGameDate] = useState('');
  const [gameType, setGameType] = useState('home'); // 'home', 'away', 'tournament'
  const [tournamentName, setTournamentName] = useState('');
  const [existingTournaments, setExistingTournaments] = useState([]);
  const [showTournamentDropdown, setShowTournamentDropdown] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef(null);
  const tournamentInputRef = useRef(null);
  const dropdownRef = useRef(null);

  // Fetch existing tournaments when modal opens
  useEffect(() => {
    if (isOpen) {
      fetch(`${API_BASE}/api/games/tournaments`)
        .then(res => res.json())
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

  // Filter tournaments based on input
  const filteredTournaments = existingTournaments.filter(t =>
    t.toLowerCase().includes(tournamentName.toLowerCase())
  );

  const handleFileSelect = useCallback((event) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  }, []);

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();

    if (!opponentName.trim() || !gameDate || !selectedFile) {
      return;
    }

    setIsSubmitting(true);

    try {
      await onCreateGame({
        opponentName: opponentName.trim(),
        gameDate,
        gameType,
        tournamentName: gameType === 'tournament' ? tournamentName.trim() : null,
        file: selectedFile,
      });

      // Reset form
      setOpponentName('');
      setGameDate('');
      setGameType('home');
      setTournamentName('');
      setShowTournamentDropdown(false);
      setSelectedFile(null);
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  }, [opponentName, gameDate, gameType, tournamentName, selectedFile, onCreateGame, onClose]);

  const handleClose = useCallback(() => {
    if (!isSubmitting) {
      setOpponentName('');
      setGameDate('');
      setGameType('home');
      setTournamentName('');
      setShowTournamentDropdown(false);
      setSelectedFile(null);
      onClose();
    }
  }, [isSubmitting, onClose]);

  const isValid = opponentName.trim() && gameDate && selectedFile;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="relative bg-gray-800 rounded-xl shadow-2xl w-full max-w-md mx-4 border border-gray-700">
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

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Opponent Name */}
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
              disabled={isSubmitting}
              autoFocus
            />
          </div>

          {/* Game Date */}
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
              disabled={isSubmitting}
            />
          </div>

          {/* Game Type */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              <MapPin size={14} className="inline mr-1.5" />
              Game Type *
            </label>
            <div className="flex gap-2">
              {[
                { value: 'home', label: 'Home' },
                { value: 'away', label: 'Away' },
                { value: 'tournament', label: 'Tournament' },
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
          {gameType === 'tournament' && (
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

          {/* Video Upload */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Game Video *
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/mp4,video/quicktime,video/webm"
              onChange={handleFileSelect}
              className="hidden"
              disabled={isSubmitting}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isSubmitting}
              className={`w-full px-4 py-3 border-2 border-dashed rounded-lg transition-colors ${
                selectedFile
                  ? 'border-green-500 bg-green-900/20'
                  : 'border-gray-600 hover:border-gray-500 bg-gray-900/50'
              } disabled:opacity-50`}
            >
              {selectedFile ? (
                <div className="text-center">
                  <p className="text-green-400 font-medium truncate">{selectedFile.name}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {(selectedFile.size / (1024 * 1024)).toFixed(1)} MB
                  </p>
                </div>
              ) : (
                <div className="text-center text-gray-400">
                  <Upload size={24} className="mx-auto mb-2" />
                  <p className="font-medium">Click to upload video</p>
                  <p className="text-xs text-gray-500 mt-1">MP4, MOV, or WebM</p>
                </div>
              )}
            </button>
          </div>

          {/* Submit Button */}
          <div className="pt-2">
            <Button
              type="submit"
              variant="success"
              size="lg"
              disabled={!isValid || isSubmitting}
              className="w-full"
            >
              {isSubmitting ? 'Creating Game...' : 'Create Game'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default GameDetailsModal;
