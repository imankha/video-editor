import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { X, Upload, Gamepad2, Calendar, MapPin, Trophy, ChevronDown, Coins, Link, HelpCircle, Loader2, AlertTriangle, CheckCircle } from 'lucide-react';
import { Button } from './shared/Button';
import { BuyCreditsModal } from './BuyCreditsModal';
import { toast } from './shared';
import { GameType, VideoMode } from '../constants/gameConstants';
import { useCreditStore } from '../stores/creditStore';
import { calculateUploadCost } from '../utils/storageCost';
import { API_BASE } from '../config';

const VEO_PATTERN = /https?:\/\/app\.veo\.co\/matches\/[^/?#]+/;
const TRACE_PATTERN = /https?:\/\/go\.traceup\.com\/traceid\/athlete\/[^/]+\/watch\/\d+/;

function detectPlatform(url) {
  if (VEO_PATTERN.test(url)) return 'veo';
  if (TRACE_PATTERN.test(url)) return 'trace';
  return null;
}

function formatBytes(bytes) {
  if (!bytes) return '';
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

const IMPORT_STATUS_MESSAGES = {
  resolving: 'Checking video...',
  checking_credits: 'Checking storage credits...',
  uploading: 'Uploading to storage...',
  creating_game: 'Setting up your game...',
};

export function GameDetailsModal({ isOpen, onClose, onCreateGame }) {
  const [opponentName, setOpponentName] = useState('');
  const [gameDate, setGameDate] = useState('');
  const [gameType, setGameType] = useState(GameType.HOME);
  const [tournamentName, setTournamentName] = useState('');
  const [existingTournaments, setExistingTournaments] = useState([]);
  const [showTournamentDropdown, setShowTournamentDropdown] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [videoMode, setVideoMode] = useState(VideoMode.PER_GAME);
  const [halfFiles, setHalfFiles] = useState([null, null]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [draggingHalfIndex, setDraggingHalfIndex] = useState(null);
  const [showBuyCredits, setShowBuyCredits] = useState(false);
  const fileInputRef = useRef(null);
  const creditBalance = useCreditStore(state => state.balance);
  const fetchCredits = useCreditStore(state => state.fetchCredits);
  const halfFileInputRefs = [useRef(null), useRef(null)];
  const tournamentInputRef = useRef(null);
  const dropdownRef = useRef(null);

  // Import state
  const [videoSource, setVideoSource] = useState('link');
  const [importUrl, setImportUrl] = useState('');
  const [importUrls, setImportUrls] = useState(['', '']);
  const [importState, setImportState] = useState(null);
  const [importError, setImportError] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const [helpTab, setHelpTab] = useState('veo');
  const navigatedRef = useRef(false);

  const isPerHalfLink = videoSource === 'link' && videoMode === VideoMode.PER_HALF;

  const detectedPlatform = useMemo(() => {
    if (isPerHalfLink) {
      const first = importUrls[0]?.trim();
      if (!first) return null;
      return detectPlatform(first);
    }
    if (!importUrl.trim()) return null;
    return detectPlatform(importUrl);
  }, [importUrl, importUrls, isPerHalfLink]);

  // Fetch existing tournaments when modal opens
  useEffect(() => {
    if (isOpen) {
      navigatedRef.current = false;
      fetch(`${API_BASE}/api/games/tournaments`, { credentials: 'include' })
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

  // WebSocket + polling fallback for import progress
  const importId = importState?.import_id;
  const importTerminal = !importState || importState.status === 'complete' || importState.status === 'error';

  useEffect(() => {
    if (!importId || importTerminal) return;

    let closed = false;
    let ws = null;
    let keepaliveInterval = null;
    let pollInterval = null;
    let reconnectTimeout = null;
    let reconnectAttempt = 0;

    function buildWsUrl() {
      const apiBase = import.meta.env.VITE_API_BASE;
      if (apiBase) {
        const url = new URL(apiBase);
        const proto = url.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${proto}//${url.host}/ws/import/${importId}`;
      }
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${proto}//${window.location.host}/ws/import/${importId}`;
    }

    let notFoundCount = 0;
    function startPolling() {
      pollInterval = setInterval(async () => {
        try {
          const res = await fetch(`${API_BASE}/api/games/imports/${importId}/progress`, { credentials: 'include' });
          if (res.status === 404) {
            notFoundCount++;
            if (notFoundCount >= 3 && !closed) {
              setImportState(prev => ({
                ...prev,
                status: 'error',
                error: 'Import lost — the server may have restarted. Please try again.',
              }));
              clearInterval(pollInterval);
            }
            return;
          }
          if (!res.ok) return;
          notFoundCount = 0;
          const data = await res.json();
          if (!closed) setImportState(data);
          if (data.status === 'complete' || data.status === 'error') {
            clearInterval(pollInterval);
          }
        } catch { /* polling failure is non-fatal */ }
      }, 3000);
    }

    function connectWs() {
      if (closed) return;
      try {
        ws = new WebSocket(buildWsUrl());
      } catch {
        startPolling();
        return;
      }

      ws.onopen = () => {
        reconnectAttempt = 0;
        keepaliveInterval = setInterval(() => {
          if (ws?.readyState === WebSocket.OPEN) {
            try { ws.send('ping'); } catch { /* send failure */ }
          }
        }, 30000);
      };

      ws.onmessage = (event) => {
        const raw = typeof event.data === 'string' ? event.data.trim() : '';
        if (!raw || raw === 'pong' || raw === '"pong"') return;
        try {
          const msg = JSON.parse(raw);
          if (msg.type === 'connected') return;
          if (!closed) setImportState(msg);
        } catch { /* parse failure */ }
      };

      ws.onerror = () => {};

      ws.onclose = () => {
        if (keepaliveInterval) clearInterval(keepaliveInterval);
        keepaliveInterval = null;
        if (closed) return;
        if (reconnectAttempt < 5) {
          const delay = Math.min(500 * Math.pow(2, reconnectAttempt), 10000);
          reconnectAttempt++;
          reconnectTimeout = setTimeout(connectWs, delay);
        } else {
          startPolling();
        }
      };
    }

    connectWs();

    return () => {
      closed = true;
      if (keepaliveInterval) clearInterval(keepaliveInterval);
      if (pollInterval) clearInterval(pollInterval);
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (ws?.readyState === WebSocket.OPEN) ws.close();
    };
  }, [importId, importTerminal]);

  // Auto-navigate on import complete
  useEffect(() => {
    if (importState?.status === 'complete' && importState?.game_id && !navigatedRef.current) {
      navigatedRef.current = true;
      const timer = setTimeout(() => {
        onCreateGame({ importComplete: true, gameId: importState.game_id });
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [importState?.status, importState?.game_id, onCreateGame]);

  // Toast on import error
  useEffect(() => {
    if (importState?.status === 'error') {
      const msg = importState.credits_refunded > 0
        ? `Import failed: ${importState.error}. ${importState.credits_refunded} credits refunded.`
        : `Import failed: ${importState.error || 'Please try again.'}`;
      toast.error(msg);
    }
  }, [importState?.status]);

  const filteredTournaments = existingTournaments.filter(t =>
    t.toLowerCase().includes(tournamentName.toLowerCase())
  );

  const handleFileSelect = useCallback((event) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  }, []);

  const handleHalfFileSelect = useCallback((index, event) => {
    const file = event.target.files?.[0];
    if (file) {
      setHalfFiles(prev => {
        const updated = [...prev];
        updated[index] = file;
        return updated;
      });
    }
  }, []);

  const ACCEPTED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];

  const getVideoFile = useCallback((dataTransfer) => {
    const file = dataTransfer.files?.[0];
    if (file && ACCEPTED_VIDEO_TYPES.includes(file.type)) return file;
    return null;
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragEnter = useCallback((e, halfIndex) => {
    e.preventDefault();
    e.stopPropagation();
    if (halfIndex !== undefined) {
      setDraggingHalfIndex(halfIndex);
    } else {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e, halfIndex) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget)) return;
    if (halfIndex !== undefined) {
      setDraggingHalfIndex(null);
    } else {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (isSubmitting) return;
    const file = getVideoFile(e.dataTransfer);
    if (file) setSelectedFile(file);
  }, [isSubmitting, getVideoFile]);

  const handleHalfDrop = useCallback((index, e) => {
    e.preventDefault();
    e.stopPropagation();
    setDraggingHalfIndex(null);
    if (isSubmitting) return;
    const file = getVideoFile(e.dataTransfer);
    if (file) {
      setHalfFiles(prev => {
        const updated = [...prev];
        updated[index] = file;
        return updated;
      });
    }
  }, [isSubmitting, getVideoFile]);

  const hasVideo = videoSource === 'link'
    ? (isPerHalfLink
        ? importUrls[0].trim().length > 0 && importUrls[1].trim().length > 0
        : importUrl.trim().length > 0)
    : (videoMode === VideoMode.PER_GAME ? selectedFile : (halfFiles[0] && halfFiles[1]));
  const isValid = opponentName.trim() && gameDate && hasVideo;

  const uploadCost = useMemo(() => {
    if (videoSource === 'link') return null;
    if (videoMode === VideoMode.PER_GAME && selectedFile) {
      return calculateUploadCost(selectedFile.size);
    }
    if (videoMode === VideoMode.PER_HALF && halfFiles[0] && halfFiles[1]) {
      return calculateUploadCost(halfFiles[0].size + halfFiles[1].size);
    }
    return null;
  }, [videoSource, videoMode, selectedFile, halfFiles]);

  const resetForm = useCallback(() => {
    setOpponentName('');
    setGameDate('');
    setGameType(GameType.HOME);
    setTournamentName('');
    setShowTournamentDropdown(false);
    setSelectedFile(null);
    setVideoMode(VideoMode.PER_GAME);
    setHalfFiles([null, null]);
    setImportUrl('');
    setImportUrls(['', '']);
    setImportState(null);
    setImportError('');
    setVideoSource('link');
    setShowHelp(false);
  }, []);

  const submitGame = useCallback(async () => {
    setIsSubmitting(true);
    try {
      if (videoSource === 'link') {
        const payload = {
          opponent_name: opponentName.trim(),
          game_date: gameDate,
          game_type: gameType,
        };
        if (isPerHalfLink) {
          payload.urls = importUrls.map(u => u.trim());
        } else {
          payload.url = importUrl.trim();
        }
        const res = await fetch(`${API_BASE}/api/games/import-url`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const error = await res.json().catch(() => ({}));
          const detail = error.detail || '';
          if (detail.toLowerCase().includes('already in progress')) {
            setImportError('You already have an import running. Wait for it to finish.');
          } else {
            setImportError("This URL isn't recognized. Paste a link from app.veo.co or go.traceup.com");
          }
          return;
        }

        const progress = await res.json();
        setImportState(progress);
        setImportError('');
      } else {
        const gameDetails = {
          opponentName: opponentName.trim(),
          gameDate,
          gameType,
          tournamentName: gameType === GameType.TOURNAMENT ? tournamentName.trim() : null,
          videoMode,
        };

        if (videoMode === VideoMode.PER_HALF) {
          gameDetails.files = halfFiles;
        } else {
          gameDetails.file = selectedFile;
        }

        await onCreateGame(gameDetails);
        resetForm();
        onClose();
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [videoSource, importUrl, importUrls, isPerHalfLink, opponentName, gameDate, gameType, tournamentName, selectedFile, videoMode, halfFiles, onCreateGame, onClose, resetForm]);

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    if (!isValid) return;

    if (videoSource === 'upload' && uploadCost !== null && creditBalance < uploadCost) {
      setShowBuyCredits(true);
      return;
    }

    await submitGame();
  }, [isValid, videoSource, uploadCost, creditBalance, submitGame]);

  const handlePaymentSuccess = useCallback(async () => {
    setShowBuyCredits(false);
    await fetchCredits();
    toast.success('Credits purchased! Creating your game...');
    await submitGame();
  }, [fetchCredits, submitGame]);

  const isImporting = importState && importState.status !== 'error' && importState.status !== 'complete';

  const handleClose = useCallback(() => {
    if (isSubmitting || isImporting) return;

    if (importState?.status === 'complete' && importState?.game_id) {
      onCreateGame({ importComplete: true, gameId: importState.game_id });
      return;
    }

    resetForm();
    onClose();
  }, [isSubmitting, isImporting, importState, onCreateGame, onClose, resetForm]);

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
            disabled={isSubmitting || isImporting}
            className="p-1 text-gray-400 hover:text-white rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            <X size={20} />
          </button>
        </div>

        {importState ? (
          /* Import Progress View */
          <div className="p-6">
            {importState.status === 'error' ? (
              importState.error_code === 'INGEST_EXHAUSTED' ? (
                /* Exhaustion error */
                <div className="text-center py-2">
                  <AlertTriangle size={32} className="mx-auto mb-3 text-yellow-400" />
                  <h3 className="text-lg font-semibold text-white mb-2">Import unavailable right now</h3>
                  <p className="text-gray-400 text-sm mb-6">
                    We tried 3 times but the video server is responding too slowly. This usually resolves on its own.
                  </p>
                  <div className="space-y-2">
                    <Button variant="success" size="lg" className="w-full" onClick={handleClose}>
                      Try Again Later
                    </Button>
                    <button
                      className="w-full text-sm text-gray-400 hover:text-white transition-colors py-2"
                      onClick={() => { setImportState(null); setImportError(''); setVideoSource('upload'); }}
                    >
                      Upload File Instead
                    </button>
                  </div>
                </div>
              ) : (
                /* Generic error */
                <div className="text-center py-2">
                  <AlertTriangle size={32} className="mx-auto mb-3 text-red-400" />
                  <h3 className="text-lg font-semibold text-white mb-2">Import failed</h3>
                  <p className="text-gray-400 text-sm mb-6">
                    {importState.error || 'Please try again or upload the file directly.'}
                  </p>
                  <div className="space-y-2">
                    <Button variant="success" size="lg" className="w-full" onClick={() => { setImportState(null); setImportError(''); }}>
                      Try Again
                    </Button>
                    <button
                      className="w-full text-sm text-gray-400 hover:text-white transition-colors py-2"
                      onClick={() => { setImportState(null); setImportError(''); setVideoSource('upload'); }}
                    >
                      Upload File Instead
                    </button>
                  </div>
                </div>
              )
            ) : importState.status === 'complete' ? (
              /* Complete */
              <div className="text-center py-8">
                <CheckCircle size={32} className="mx-auto mb-3 text-green-400" />
                <h3 className="text-lg font-semibold text-white">Game created!</h3>
                <p className="text-gray-400 text-sm mt-1">Opening game...</p>
              </div>
            ) : (
              /* In-progress */
              <div className="text-center py-4">
                <Loader2 size={32} className="mx-auto mb-3 text-green-400 animate-spin" />
                <h3 className="text-white font-medium mb-1">
                  {importState.status === 'downloading'
                    ? `Importing from ${importState.platform === 'veo' ? 'Veo' : 'Trace'}...`
                    : IMPORT_STATUS_MESSAGES[importState.status] || 'Processing...'}
                </h3>
                {importState.status === 'downloading' && (
                  <>
                    {importState.message && (
                      <p className={`text-sm mb-2 ${importState.message.includes('Retrying') ? 'text-yellow-400' : 'text-gray-400'}`}>
                        {importState.message}
                      </p>
                    )}
                    <div className="mt-2 h-2 bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-green-500 transition-all duration-500"
                        style={{ width: `${importState.progress_pct || 0}%` }}
                      />
                    </div>
                    <div className="flex justify-between mt-1 text-xs text-gray-500">
                      <span>
                        {importState.downloaded_bytes > 0 && importState.total_bytes > 0
                          ? `${formatBytes(importState.downloaded_bytes)} / ${formatBytes(importState.total_bytes)}`
                          : ''}
                      </span>
                      <span>{importState.progress_pct || 0}%</span>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        ) : (
          /* Form */
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

            {/* Video Format - hidden when Trace detected (halves resolved automatically) */}
            {!(videoSource === 'link' && detectedPlatform === 'trace') && (
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">
                  Video Format *
                </label>
                <div className="flex gap-2">
                  {[
                    { value: VideoMode.PER_GAME, label: 'Full Game' },
                    { value: VideoMode.PER_HALF, label: 'Per Half' },
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setVideoMode(option.value)}
                      disabled={isSubmitting}
                      className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                        videoMode === option.value
                          ? 'bg-green-600 text-white'
                          : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                      } disabled:opacity-50`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Video Source */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">
                {videoSource === 'link' ? 'Game Video *' : (videoMode === VideoMode.PER_HALF ? 'Game Videos *' : 'Game Video *')}
              </label>

              {/* Source Toggle */}
              <div className="flex gap-2 mb-3">
                <button
                  type="button"
                  onClick={() => { setVideoSource('link'); setShowHelp(false); }}
                  disabled={isSubmitting}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-1.5 ${
                    videoSource === 'link'
                      ? 'bg-green-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  } disabled:opacity-50`}
                >
                  <Link size={14} />
                  Paste Link
                </button>
                <button
                  type="button"
                  onClick={() => { setVideoSource('upload'); setShowHelp(false); }}
                  disabled={isSubmitting}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-1.5 ${
                    videoSource === 'upload'
                      ? 'bg-green-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  } disabled:opacity-50`}
                >
                  <Upload size={14} />
                  Upload File
                </button>
              </div>

              {videoSource === 'link' ? (
                /* Paste Link UI */
                <div>
                  {isPerHalfLink ? (
                    /* Per-half: two URL inputs */
                    <div className="space-y-2">
                      {['1st Half', '2nd Half'].map((label, index) => {
                        const val = importUrls[index] || '';
                        const plat = val.trim() ? detectPlatform(val) : null;
                        return (
                          <div key={label}>
                            <div className="relative">
                              <input
                                type="text"
                                value={val}
                                onChange={(e) => {
                                  setImportUrls(prev => {
                                    const updated = [...prev];
                                    updated[index] = e.target.value;
                                    return updated;
                                  });
                                  setImportError('');
                                }}
                                placeholder={`${label} — paste Veo link`}
                                className={`w-full px-3 py-2 pr-8 bg-gray-900 border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-1 ${
                                  importError
                                    ? 'border-red-500 focus:border-red-500 focus:ring-red-500'
                                    : plat
                                      ? 'border-green-500 focus:border-green-500 focus:ring-green-500'
                                      : 'border-gray-600 focus:border-green-500 focus:ring-green-500'
                                }`}
                                disabled={isSubmitting}
                              />
                              {index === 0 && (
                                <button
                                  type="button"
                                  onClick={() => setShowHelp(!showHelp)}
                                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full bg-gray-700 text-green-400 hover:bg-gray-600 hover:text-green-300 transition-colors"
                                >
                                  <HelpCircle size={18} />
                                </button>
                              )}
                            </div>
                            {plat && (
                              <p className="mt-1 text-xs text-green-400 flex items-center gap-1">
                                <CheckCircle size={12} />
                                {plat === 'veo' ? 'Veo match detected' : 'Trace game detected'}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    /* Single URL input */
                    <div className="relative">
                      <input
                        type="text"
                        value={importUrl}
                        onChange={(e) => { setImportUrl(e.target.value); setImportError(''); }}
                        placeholder="Paste a Veo or Trace game link"
                        className={`w-full px-3 py-2 pr-8 bg-gray-900 border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-1 ${
                          importError
                            ? 'border-red-500 focus:border-red-500 focus:ring-red-500'
                            : detectedPlatform
                              ? 'border-green-500 focus:border-green-500 focus:ring-green-500'
                              : 'border-gray-600 focus:border-green-500 focus:ring-green-500'
                        }`}
                        disabled={isSubmitting}
                      />
                      <button
                        type="button"
                        onClick={() => setShowHelp(!showHelp)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full bg-gray-700 text-green-400 hover:bg-gray-600 hover:text-green-300 transition-colors"
                      >
                        <HelpCircle size={18} />
                      </button>
                    </div>
                  )}

                  {/* Platform detection badge (single URL mode only) */}
                  {!isPerHalfLink && detectedPlatform && (
                    <p className="mt-1.5 text-xs text-green-400 flex items-center gap-1">
                      <CheckCircle size={12} />
                      {detectedPlatform === 'veo' ? 'Veo match detected' : 'Trace game detected'}
                    </p>
                  )}
                  {!isPerHalfLink && !detectedPlatform && importUrl.trim() && !importError && (
                    <p className="mt-1.5 text-xs text-gray-500">Supports Veo and Trace links</p>
                  )}

                  {/* Import error */}
                  {importError && (
                    <p className="mt-1.5 text-xs text-red-400">{importError}</p>
                  )}

                  {/* Help popover */}
                  {showHelp && (
                    <div className="mt-2 bg-gray-900 border border-gray-600 rounded-lg p-3">
                      <div className="flex gap-2 mb-2">
                        <button
                          type="button"
                          onClick={() => setHelpTab('veo')}
                          className={`px-2.5 py-1 text-xs rounded transition-colors ${
                            helpTab === 'veo' ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                          }`}
                        >
                          Veo
                        </button>
                        <button
                          type="button"
                          onClick={() => setHelpTab('trace')}
                          className={`px-2.5 py-1 text-xs rounded transition-colors ${
                            helpTab === 'trace' ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                          }`}
                        >
                          Trace
                        </button>
                      </div>
                      {helpTab === 'veo' ? (
                        <ol className="text-xs text-gray-400 space-y-1 list-decimal list-inside">
                          <li>Open your game on <span className="text-white">app.veo.co</span></li>
                          <li>Select the 3 dots for your game</li>
                          <li>Select <span className="text-white">Share</span></li>
                          <li>Click <span className="text-white">Copy link</span></li>
                          <li>Paste it above</li>
                        </ol>
                      ) : (
                        <ol className="text-xs text-gray-400 space-y-1 list-decimal list-inside">
                          <li>Open your game on <span className="text-white">go.traceup.com</span></li>
                          <li>Copy the URL from your browser's address bar</li>
                          <li>Paste it here</li>
                        </ol>
                      )}
                    </div>
                  )}
                </div>
              ) : videoMode === VideoMode.PER_GAME ? (
                /* Upload File - Full Game */
                <div
                  onDragOver={handleDragOver}
                  onDragEnter={(e) => handleDragEnter(e)}
                  onDragLeave={(e) => handleDragLeave(e)}
                  onDrop={handleDrop}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="video/mp4,video/quicktime,video/webm"
                    onChange={handleFileSelect}
                    className="hidden"
                    disabled={isSubmitting}
                  />
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => !isSubmitting && fileInputRef.current?.click()}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click(); } }}
                    className={`w-full px-4 py-3 border-2 border-dashed rounded-lg transition-colors cursor-pointer ${
                      isDragging
                        ? 'border-blue-400 bg-blue-900/30'
                        : selectedFile
                          ? 'border-green-500 bg-green-900/20'
                          : 'border-gray-600 hover:border-gray-500 bg-gray-900/50'
                    } ${isSubmitting ? 'opacity-50 pointer-events-none' : ''}`}
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
                        <p className="font-medium">{isDragging ? 'Drop video here' : 'Click or drag to upload video'}</p>
                        <p className="text-xs text-gray-500 mt-1">MP4, MOV, or WebM</p>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                /* Upload File - Per Half */
                <div className="grid grid-cols-2 gap-3">
                  {['First Half', 'Second Half'].map((label, index) => (
                    <div
                      key={label}
                      onDragOver={handleDragOver}
                      onDragEnter={(e) => handleDragEnter(e, index)}
                      onDragLeave={(e) => handleDragLeave(e, index)}
                      onDrop={(e) => handleHalfDrop(index, e)}
                    >
                      <input
                        ref={halfFileInputRefs[index]}
                        type="file"
                        accept="video/mp4,video/quicktime,video/webm"
                        onChange={(e) => handleHalfFileSelect(index, e)}
                        className="hidden"
                        disabled={isSubmitting}
                      />
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => !isSubmitting && halfFileInputRefs[index].current?.click()}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); halfFileInputRefs[index].current?.click(); } }}
                        className={`w-full px-3 py-3 border-2 border-dashed rounded-lg transition-colors cursor-pointer ${
                          draggingHalfIndex === index
                            ? 'border-blue-400 bg-blue-900/30'
                            : halfFiles[index]
                              ? 'border-green-500 bg-green-900/20'
                              : 'border-gray-600 hover:border-gray-500 bg-gray-900/50'
                        } ${isSubmitting ? 'opacity-50 pointer-events-none' : ''}`}
                      >
                        {halfFiles[index] ? (
                          <div className="text-center">
                            <p className="text-green-400 text-xs font-medium truncate">{halfFiles[index].name}</p>
                            <p className="text-xs text-gray-500 mt-0.5">
                              {(halfFiles[index].size / (1024 * 1024)).toFixed(1)} MB
                            </p>
                          </div>
                        ) : (
                          <div className="text-center text-gray-400">
                            <Upload size={18} className="mx-auto mb-1" />
                            <p className="text-xs font-medium">{draggingHalfIndex === index ? 'Drop here' : label}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Upload cost info */}
            {uploadCost !== null && (
              <div className="flex items-center justify-between px-3 py-2 rounded-lg text-sm bg-gray-700/50 text-gray-300">
                <div className="flex items-center gap-2">
                  <Coins size={14} className="text-yellow-400" />
                  <span>{uploadCost} credit{uploadCost !== 1 ? 's' : ''} for 30 days of storage</span>
                </div>
                <span className="font-medium text-white">Balance: {creditBalance}</span>
              </div>
            )}

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
        )}
      </div>

      {showBuyCredits && (
        <BuyCreditsModal
          onClose={() => setShowBuyCredits(false)}
          onPaymentSuccess={handlePaymentSuccess}
        />
      )}
    </div>
  );
}

export default GameDetailsModal;
