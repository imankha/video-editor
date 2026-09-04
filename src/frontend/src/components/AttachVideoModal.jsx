import { useState, useRef, useCallback, useMemo, lazy, Suspense } from 'react';
import { X, Upload, Film, Coins } from 'lucide-react';
import { Button } from './shared/Button';
import { toast } from './shared';
import { useCreditStore } from '../stores/creditStore';
import { calculateUploadCost } from '../utils/storageCost';
import { attachVideoToExistingGame, UPLOAD_PHASE } from '../services/uploadManager';

const BuyCreditsModal = lazy(() => import('./BuyCreditsModal').then(m => ({ default: m.BuyCreditsModal })));

const ACCEPTED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];

/**
 * T8700: attach ANOTHER video (e.g. a second half) to an already-created,
 * `ready` game. The transport is uploadManager.attachVideoToExistingGame, which
 * reuses the create-time hash -> R2 -> POST /games/{id}/videos path and, on
 * success, re-loads the game so Annotate's virtual timeline picks up the new
 * half (single->multi transition). The backend charges credits + writes a
 * storage ref + appends the sequence server-side.
 *
 * Cost preview mirrors the create-time cost line (design Q5): the estimate shows
 * before the user confirms; the authoritative charge/affordability check is
 * server-side (prepare-upload's can_afford), surfaced here as a BuyCredits prompt.
 */
export function AttachVideoModal({ isOpen, game, onClose, onAttached }) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState(null); // { phase, percent, message }
  const [showBuyCredits, setShowBuyCredits] = useState(false);
  const fileInputRef = useRef(null);
  const creditBalance = useCreditStore(state => state.balance);
  const creditsLoaded = useCreditStore(state => state.loaded);

  const isAttaching = progress !== null && progress.phase !== UPLOAD_PHASE.ERROR;

  const uploadCost = useMemo(
    () => (selectedFile ? calculateUploadCost(selectedFile.size) : null),
    [selectedFile]
  );
  // Before a file is picked, show the storage minimum (same basis as the create
  // modal's pre-selection cost line).
  const displayCost = uploadCost ?? calculateUploadCost(0);

  const getVideoFile = useCallback((dataTransfer) => {
    const file = dataTransfer.files?.[0];
    if (file && ACCEPTED_VIDEO_TYPES.includes(file.type)) return file;
    return null;
  }, []);

  const handleFileSelect = useCallback((event) => {
    const file = event.target.files?.[0];
    if (file) setSelectedFile(file);
  }, []);

  const handleDragOver = useCallback((e) => { e.preventDefault(); e.stopPropagation(); }, []);
  const handleDragEnter = useCallback((e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); }, []);
  const handleDragLeave = useCallback((e) => {
    e.preventDefault(); e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setIsDragging(false);
  }, []);
  const handleDrop = useCallback((e) => {
    e.preventDefault(); e.stopPropagation();
    setIsDragging(false);
    if (isAttaching) return;
    const file = getVideoFile(e.dataTransfer);
    if (file) setSelectedFile(file);
  }, [isAttaching, getVideoFile]);

  const resetAndClose = useCallback(() => {
    if (isAttaching) return; // don't drop an in-flight upload
    setSelectedFile(null);
    setProgress(null);
    setIsDragging(false);
    onClose();
  }, [isAttaching, onClose]);

  const handleAttach = useCallback(async () => {
    if (!selectedFile || !game || isAttaching) return;

    // Optimistic affordability pre-check (mirrors GameDetailsModal): only block
    // once the balance is actually known; otherwise defer to the backend check.
    if (creditsLoaded && uploadCost !== null && creditBalance < uploadCost) {
      setShowBuyCredits(true);
      return;
    }

    setProgress({ phase: UPLOAD_PHASE.HASHING, percent: 0, message: 'Preparing…' });
    try {
      await attachVideoToExistingGame(game.id, selectedFile, (p) => setProgress(p));
      toast.success('Video added to game');
      setSelectedFile(null);
      setProgress(null);
      onAttached?.(game.id);
      onClose();
    } catch (err) {
      if (err?.insufficientCredits) {
        setProgress(null);
        setShowBuyCredits(true);
        return;
      }
      setProgress({ phase: UPLOAD_PHASE.ERROR, percent: 0, message: err?.message || 'Upload failed' });
      toast.error(err?.message || 'Failed to add video');
    }
  }, [selectedFile, game, isAttaching, creditsLoaded, uploadCost, creditBalance, onAttached, onClose]);

  if (!isOpen || !game) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      <div className="relative bg-gray-800 rounded-xl shadow-2xl w-full max-w-md mx-4 border border-gray-700 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-600/20 rounded-lg">
              <Film size={20} className="text-green-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Add a video</h2>
              <p className="text-xs text-gray-400 truncate max-w-[16rem]">to {game.name}</p>
            </div>
          </div>
          <button
            onClick={resetAndClose}
            disabled={isAttaching}
            className="p-1 text-gray-400 hover:text-white rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-50"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <p className="text-sm text-gray-400">
            Attach another half or angle. It appends to this game&apos;s timeline in Annotate —
            your existing clips stay exactly where they are.
          </p>

          {/* Cost line — mirrors the create-time modal. */}
          <div className="flex items-center justify-between px-3 py-2 rounded-lg text-sm bg-gray-700/50 text-gray-300">
            <div className="flex items-center gap-2">
              <Coins size={14} className="text-yellow-400 shrink-0" />
              <span>{displayCost} credit{displayCost !== 1 ? 's' : ''} - keeps this video for 30 days</span>
            </div>
            <span className="font-medium text-white">Balance: {creditsLoaded ? creditBalance : '…'}</span>
          </div>

          {/* Dropzone */}
          <div
            onDragOver={handleDragOver}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="video/mp4,video/quicktime,video/webm"
              onChange={handleFileSelect}
              className="hidden"
              disabled={isAttaching}
            />
            <div
              role="button"
              tabIndex={0}
              onClick={() => !isAttaching && fileInputRef.current?.click()}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click(); } }}
              className={`w-full px-4 py-3 border-2 border-dashed rounded-lg transition-colors cursor-pointer ${
                isDragging
                  ? 'border-blue-400 bg-blue-900/30'
                  : selectedFile
                    ? 'border-green-500 bg-green-900/20'
                    : 'border-gray-600 hover:border-gray-500 bg-gray-900/50'
              } ${isAttaching ? 'opacity-50 pointer-events-none' : ''}`}
            >
              {selectedFile ? (
                <div className="text-center">
                  <p className="text-green-400 font-medium truncate">{selectedFile.name}</p>
                  <p className="text-xs text-gray-500 mt-1">{(selectedFile.size / (1024 * 1024)).toFixed(1)} MB</p>
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

          {/* Progress */}
          {progress && progress.phase !== UPLOAD_PHASE.ERROR && (
            <div>
              <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
                <span>{progress.message || 'Uploading…'}</span>
                <span>{Math.round(progress.percent || 0)}%</span>
              </div>
              <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-500 transition-[width] duration-200"
                  style={{ width: `${Math.round(progress.percent || 0)}%` }}
                />
              </div>
            </div>
          )}

          {/* Submit */}
          <div className="pt-1">
            <Button
              type="button"
              variant="success"
              size="lg"
              onClick={handleAttach}
              disabled={!selectedFile || isAttaching}
              className="w-full"
            >
              {isAttaching ? 'Adding Video…' : 'Add Video'}
            </Button>
          </div>
        </div>
      </div>

      {showBuyCredits && (
        <Suspense fallback={null}>
          <BuyCreditsModal
            onClose={() => setShowBuyCredits(false)}
            onPaymentSuccess={() => setShowBuyCredits(false)}
          />
        </Suspense>
      )}
    </div>
  );
}

export default AttachVideoModal;
