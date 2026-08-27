import { useState, useRef, useEffect } from 'react';
import { Loader2, Upload, X, AlertTriangle, RefreshCw, Trash2 } from 'lucide-react';
import { useProfileStore } from '../stores';
import { sportEmojiOrNull } from '../modes/annotate/constants/tagRegistry';
import { Logo } from './Logo';
import { GAME } from '../config/themeColors';
import { UPLOAD_STATUS } from '../stores/uploadStore';
import { UPLOAD_PHASE } from '../services/uploadManager';

/**
 * UploadingGameTile - an in-flight upload rendered as a REAL game tile (T7820).
 *
 * Replaces the old ActiveUploadCard / PendingUploadCard banner rows in the Games
 * tab's "Uploading" rail. Same 16:9 anatomy as GameTile (T5681): media area,
 * bottom name scrim with a meta line, top-left state chip — plus a thin (4px)
 * bottom-edge progress bar whose COLOR carries the state, matching the bars it
 * replaces exactly:
 *
 *   - uploading (green, GAME.progressBar): live %, ETA in the meta line, thumbnail
 *     captured locally from the File (uploadStore entry.previewFrame). Finalizing
 *     (100% transferred, server processing) shows an indeterminate shimmer.
 *   - queued (dimmed, no bar fill): waiting behind the active upload.
 *   - resume (yellow-600, frozen at progress_percent): a server-side pending_uploads
 *     session whose page closed mid-upload. The browser LOST the File handle, so no
 *     local frame can exist — always the branded sport-ball fallback, never a fake
 *     thumbnail. Tile click reopens the file picker (onResume).
 *   - failed (rose, frozen at the failure point): mirrors the T7490 upload_failed
 *     GameTile skin (rose chip + scrim, persistent Retry/Discard bar). Not GameTile
 *     itself: that component fetches /api/games/{id}/poster.jpg and needs a game
 *     row, which a client-side errored entry doesn't have.
 *
 * Accepts EITHER an uploadStore entry (`upload`) OR a server pending_uploads
 * session row (`session`) — the two sources stay separate stores by design.
 * The preview frame is runtime-only state; nothing here persists anything.
 */

// Tile view-state, derived per render from whichever source prop is present.
const TILE_STATE = {
  UPLOADING: 'uploading',
  QUEUED: 'queued',
  RESUME: 'resume',
  FAILED: 'failed',
};

// Naive but honest ETA: extrapolate the remaining time from the elapsed time and
// overall progress. Derived at render (progress ticks re-render the tile), never
// stored. Hidden until progress is meaningful and once finalizing takes over.
function formatEta(startedAt, progress) {
  if (!startedAt || !progress || progress <= 5 || progress >= 98) return null;
  const elapsedMs = Date.now() - new Date(startedAt).getTime();
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return null;
  const seconds = Math.round((elapsedMs * (100 - progress)) / progress / 1000);
  if (seconds < 60) return `~${seconds}s left`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `~${minutes}m left`;
  return `~${Math.round(minutes / 60)}h left`;
}

const BORDER_BY_STATE = {
  [TILE_STATE.UPLOADING]: 'border-green-600/50 hover:border-green-500 cursor-pointer',
  [TILE_STATE.QUEUED]: 'border-gray-700 hover:border-gray-500 cursor-pointer',
  [TILE_STATE.RESUME]: 'border-yellow-800/40 hover:border-yellow-500 cursor-pointer',
  [TILE_STATE.FAILED]: 'border-rose-800/60 ring-1 ring-inset ring-rose-900/40 cursor-default',
};

export function UploadingGameTile({
  upload,        // uploadStore entry (uploading | queued | error)
  session,       // server pending_uploads row (the RESUME state)
  onClick,       // active/queued tile tap -> annotate-during-upload navigation (T1540)
  onCancel,      // X (double-tap confirm): cancel this upload / pending session
  onResume,      // resume tile tap -> reopen the file picker
  onRetry,       // failed: re-run this errored entry
  onDiscard,     // failed: dismiss this errored entry (double-tap confirm)
}) {
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const cancelTimerRef = useRef(null);
  useEffect(() => () => clearTimeout(cancelTimerRef.current), []);

  // Same sport-aware fallback GameTile uses: current profile's ball, else the logo.
  const profiles = useProfileStore((state) => state.profiles);
  const currentProfileId = useProfileStore((state) => state.currentProfileId);
  const currentProfile = profiles.find((p) => p.id === currentProfileId);
  const sportGlyph = sportEmojiOrNull(currentProfile?.sport);

  const state = session
    ? TILE_STATE.RESUME
    : upload.status === UPLOAD_STATUS.ERROR
      ? TILE_STATE.FAILED
      : upload.status === UPLOAD_STATUS.QUEUED
        ? TILE_STATE.QUEUED
        : TILE_STATE.UPLOADING;

  const name = session ? session.original_filename : (upload.gameName || upload.fileName);
  // A resume session CANNOT have a local frame (the File handle died with the page).
  const previewFrame = session ? null : upload.previewFrame;
  const isDimmed = state === TILE_STATE.QUEUED;
  const isFinalizing = state === TILE_STATE.UPLOADING && upload.phase === UPLOAD_PHASE.FINALIZING;

  // Bottom-edge bar: fill color + frozen/live width per state; queued has NO fill.
  const barFill =
    state === TILE_STATE.UPLOADING ? { className: GAME.progressBar, width: upload.progress || 0 }
    : state === TILE_STATE.RESUME ? { className: 'bg-yellow-600', width: session.progress_percent || 0 }
    : state === TILE_STATE.FAILED ? { className: 'bg-rose-600', width: upload.progress || 0 }
    : null;

  const eta = state === TILE_STATE.UPLOADING ? formatEta(upload.startedAt, upload.progress) : null;

  const handleActivate = () => {
    // Failed is inert like the T7490 tile — its only actions are Retry/Discard below.
    if (state === TILE_STATE.FAILED) return;
    if (state === TILE_STATE.RESUME) onResume?.();
    else onClick?.(); // uploading AND queued keep the annotate-during-upload jump
  };

  const handleClick = (e) => {
    if (e.target.closest('button')) return; // cancel X / action bar own their taps
    handleActivate();
  };

  const handleKeyDown = (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (e.target.closest('button')) return;
    e.preventDefault();
    handleActivate();
  };

  // X cancel: same double-tap confirm the PendingUploadCard used (3s auto-reset).
  const handleCancelClick = () => {
    if (confirmCancel) {
      clearTimeout(cancelTimerRef.current);
      setConfirmCancel(false);
      onCancel?.();
    } else {
      setConfirmCancel(true);
      clearTimeout(cancelTimerRef.current);
      cancelTimerRef.current = setTimeout(() => setConfirmCancel(false), 3000);
    }
  };

  return (
    <div
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      data-testid="uploading-game-tile"
      data-tile-state={state}
      aria-label={
        state === TILE_STATE.FAILED ? `${name} — upload failed`
        : state === TILE_STATE.RESUME ? `${name} — tap to resume upload`
        : state === TILE_STATE.QUEUED ? `${name} — queued for upload`
        : `${name} — uploading`
      }
      className={`relative group aspect-video bg-gray-800 rounded-lg overflow-hidden border transition-all duration-150 outline-none
        focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 focus-visible:z-10 focus-visible:ring-cyan-400 ${BORDER_BY_STATE[state]}`}
    >
      {/* Media: locally-captured frame when we have one, else the branded fallback. */}
      {previewFrame ? (
        <img
          src={previewFrame}
          alt={name}
          data-testid="upload-tile-thumb"
          className={`w-full h-full object-cover ${isDimmed ? 'opacity-50' : ''}`}
        />
      ) : (
        <div
          data-testid="upload-tile-fallback"
          className={`absolute inset-0 bg-gradient-to-br from-gray-800 to-gray-900 flex flex-col items-center justify-center ${isDimmed ? 'opacity-50' : ''}`}
        >
          <div className="text-center px-4">
            {sportGlyph ? (
              <div className="text-2xl mb-2" aria-hidden>{sportGlyph}</div>
            ) : (
              <div className="mb-2 flex justify-center" aria-hidden>
                <Logo size={28} />
              </div>
            )}
            <p className="text-xs text-gray-400">ReelBallers</p>
          </div>
        </div>
      )}

      {/* Failed: rose scrim dimming the media, mirroring the T7490 GameTile skin. */}
      {state === TILE_STATE.FAILED && (
        <div className="absolute inset-0 z-[5] bg-gradient-to-b from-rose-950/50 via-black/45 to-black/80" aria-hidden />
      )}

      {/* Bottom scrim: name + meta line, same typography slots as GameTile. */}
      <div className={`absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/95 via-black/55 to-transparent px-2 pt-6 ${state === TILE_STATE.FAILED ? 'pb-9' : 'pb-2.5'}`}>
        <h3 className="text-white text-xs sm:text-sm font-medium truncate drop-shadow" title={name}>
          {name}
        </h3>
        {state === TILE_STATE.FAILED ? (
          <p className="mt-0.5 text-[11px] text-rose-200/90 leading-snug">
            Upload didn't finish. Retry to resume, or discard.
          </p>
        ) : (
          <div className="mt-0.5 flex items-center justify-between gap-2 text-xs">
            {state === TILE_STATE.UPLOADING && (
              <>
                <span className="text-gray-300 flex-shrink-0">{upload.progress || 0}%</span>
                <span className="text-gray-400 truncate">
                  {isFinalizing ? 'Processing...' : (eta || upload.message || 'Uploading...')}
                </span>
              </>
            )}
            {state === TILE_STATE.QUEUED && (
              <span className="text-gray-400">Queued</span>
            )}
            {state === TILE_STATE.RESUME && (
              <>
                <span className="text-yellow-300 flex-shrink-0">
                  {session.completed_parts} / {session.total_parts} parts
                </span>
                <span className="text-gray-400 truncate">Tap to resume</span>
              </>
            )}
          </div>
        )}
      </div>

      {/* Top-left state chip (same slot as GameTile's expiry / T7490 chips). */}
      {state === TILE_STATE.UPLOADING && (
        <div className="absolute top-1.5 left-1.5 z-20 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-900/70 text-green-300">
          <Loader2 size={10} className="animate-spin" />
          Uploading
        </div>
      )}
      {state === TILE_STATE.QUEUED && (
        <div className="absolute top-1.5 left-1.5 z-20 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-800/80 text-gray-300 ring-1 ring-gray-600/60">
          <Upload size={10} />
          Queued
        </div>
      )}
      {state === TILE_STATE.RESUME && (
        <div className="absolute top-1.5 left-1.5 z-20 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-yellow-900/70 text-yellow-300">
          <Upload size={10} />
          Resume
        </div>
      )}
      {state === TILE_STATE.FAILED && (
        <div className="absolute top-1.5 left-1.5 z-20 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-900/80 text-rose-200 ring-1 ring-rose-500/40">
          <AlertTriangle size={10} />
          Upload incomplete
        </div>
      )}

      {/* X cancel (double-tap confirm) — uploading/queued/resume. Failed uses the
          Retry/Discard bar below instead, exactly like the T7490 tile. */}
      {state !== TILE_STATE.FAILED && onCancel && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); handleCancelClick(); }}
          title={confirmCancel ? 'Tap again to confirm' : 'Cancel upload'}
          aria-label={confirmCancel ? `Confirm cancel of ${name}` : `Cancel upload of ${name}`}
          className={`absolute top-1.5 right-1.5 z-30 inline-flex items-center justify-center min-h-[32px] min-w-[32px] rounded-full backdrop-blur-sm transition-colors ${
            confirmCancel
              ? 'bg-red-600 text-white'
              : 'bg-black/60 text-white hover:bg-black/80 hover:text-red-300'
          }`}
        >
          <X size={16} />
        </button>
      )}

      {/* Failed: persistent Retry/Discard bar, mirroring GameTile's T7490 bar. */}
      {state === TILE_STATE.FAILED && (
        <div
          className="absolute inset-x-0 bottom-0 z-30 flex items-stretch gap-1 p-1.5"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setConfirmDiscard(false); onRetry?.(); }}
            className="flex-1 inline-flex items-center justify-center gap-1.5 min-h-[36px] px-2 rounded-md
                       bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 transition-colors"
            aria-label={`Retry upload of ${name}`}
          >
            <RefreshCw size={14} className="flex-shrink-0" />
            Retry
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (confirmDiscard) { onDiscard?.(); }
              else { setConfirmDiscard(true); }
            }}
            className={`inline-flex items-center justify-center gap-1.5 min-h-[36px] px-2 rounded-md text-xs font-semibold
                        focus-visible:outline-none focus-visible:ring-2 transition-colors ${
              confirmDiscard
                ? 'flex-[1.6] bg-red-600 hover:bg-red-500 text-white focus-visible:ring-red-300'
                : 'flex-none bg-black/60 hover:bg-red-900/50 text-rose-300 ring-1 ring-rose-800/60 focus-visible:ring-red-400'
            }`}
            aria-label={confirmDiscard ? `Confirm discard of ${name}` : `Discard ${name}`}
          >
            <Trash2 size={14} className="flex-shrink-0" />
            {confirmDiscard ? 'Discard for good?' : 'Discard'}
          </button>
        </div>
      )}

      {/* Bottom-edge progress bar (4px). The color IS the state; queued shows the
          empty track only. Finalizing shimmers indeterminately at full width. */}
      <div className="absolute inset-x-0 bottom-0 z-20 h-1 bg-black/50" data-testid="upload-tile-bar" aria-hidden>
        {barFill && (
          <div
            data-testid="upload-tile-bar-fill"
            className={`h-full ${barFill.className} ${isFinalizing ? 'animate-pulse' : ''} transition-all duration-300`}
            style={{ width: `${isFinalizing ? 100 : barFill.width}%` }}
          />
        )}
      </div>
    </div>
  );
}
