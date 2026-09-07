import { useState, useCallback, useEffect, useRef, useMemo, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { X, FilePlus, Coins } from 'lucide-react';
import { Button } from '../../components/shared/Button';
import { toast } from '../../components/shared';
import { GameFootagePicker } from '../../components/GameFootagePicker';
import { useCreditStore } from '../../stores/creditStore';
import { calculateUploadCost } from '../../utils/storageCost';
import { attachVideoToExistingGame, UPLOAD_PHASE } from '../../services/uploadManager';
import {
  entriesFromDataTransfer,
  hasDirectoryEntry,
  collectFilesFromEntries,
} from '../../utils/folderDrop';

const BuyCreditsModal = lazy(() =>
  import('../../components/BuyCreditsModal').then((m) => ({ default: m.BuyCreditsModal }))
);

// Approved microcopy (artifact section 09). Literals next to use.
const COPY = {
  label: 'Add footage',
  title: 'Add footage to this game',
  modalHeading: 'Add footage',
  intro:
    "Add another half, a sideline angle, or a clip you got later. It's placed by when it was filmed and appends to this game — your existing plays stay put.",
  primary: 'Add to this game',
  primaryBusy: 'Adding…',
  dropTarget: "Drop your footage here. We'll place it by when it was filmed.",
};

// A recorded time is only sent as evidence when the picker's placement model
// trusts it (creationTime is already null otherwise, T8824). Convert here.
function toRecordedAt(creationTime) {
  return creationTime instanceof Date && !Number.isNaN(creationTime.getTime())
    ? creationTime.toISOString()
    : null;
}

/**
 * AddFootageButton (T8910) — the "Add footage" entry point that lives WITH the
 * Annotate timeline (not UnifiedHeader), plus the window-level drag-drop target
 * that opens the same flow. Both paths open the universal picker in `attachMode`
 * and upload to the CURRENT game via the existing T8700 attach endpoint
 * (generalized to N files with per-file recorded_at). The endpoint charges
 * credits server-side; the cost line here is display only (never a client charge).
 *
 * On success it does NOT itself refetch/recompute — it hands `onFootageAttached`
 * the count of added videos so AnnotateContainer's completion handler can run the
 * existing load path and produce the landing feedback (gesture-based, not
 * reactive). This component owns only picker/modal/drop UI state.
 */
export function AddFootageButton({ gameId, disabled = false, onFootageAttached }) {
  const [isOpen, setIsOpen] = useState(false);
  // Files handed to the picker from a window-level drop (null for a click-open).
  const [droppedFiles, setDroppedFiles] = useState(null);
  const [footage, setFootage] = useState({ files: [], totalBytes: 0, proxies: {} });
  const [progress, setProgress] = useState(null); // { phase, percent, message }
  const [showBuyCredits, setShowBuyCredits] = useState(false);
  // Window-level drag target shown while a file is dragged over Annotate.
  const [isFileDragging, setIsFileDragging] = useState(false);
  const dragDepth = useRef(0);
  const [pickerKey, setPickerKey] = useState(0);

  const creditBalance = useCreditStore((s) => s.balance);
  const creditsLoaded = useCreditStore((s) => s.loaded);

  const isAttaching = progress !== null && progress.phase !== UPLOAD_PHASE.ERROR;

  const uploadCost = useMemo(
    () => (footage.files.length >= 1 ? calculateUploadCost(footage.totalBytes) : null),
    [footage]
  );
  const displayCost = uploadCost ?? calculateUploadCost(0);

  const openModal = useCallback((files = null) => {
    setDroppedFiles(files);
    setFootage({ files: [], totalBytes: 0, proxies: {} });
    setProgress(null);
    setPickerKey((k) => k + 1); // fresh picker intake per open
    setIsOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    if (isAttaching) return; // don't drop an in-flight upload
    setIsOpen(false);
    setDroppedFiles(null);
    setFootage({ files: [], totalBytes: 0, proxies: {} });
    setProgress(null);
  }, [isAttaching]);

  // ---- Window-level drag-drop target (whole Annotate surface = one target) ----
  // Placement is decided by recorded time, never by where the file landed, so
  // there is exactly one dashed target rather than per-lane drop zones.
  useEffect(() => {
    if (disabled || !gameId) return undefined;
    const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');

    const onDragEnter = (e) => {
      if (isOpen || !hasFiles(e)) return; // picker owns drops while the modal is open
      e.preventDefault();
      dragDepth.current += 1;
      setIsFileDragging(true);
    };
    const onDragOver = (e) => {
      if (isOpen || !hasFiles(e)) return;
      e.preventDefault();
    };
    const onDragLeave = (e) => {
      if (isOpen || !hasFiles(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setIsFileDragging(false);
    };
    const onDrop = (e) => {
      if (isOpen || !hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setIsFileDragging(false);
      // Collect entries synchronously (the item list empties after the event),
      // then walk any folder before handing files to the picker.
      const entries = entriesFromDataTransfer(e.dataTransfer);
      const plainFiles = Array.from(e.dataTransfer?.files || []);
      if (hasDirectoryEntry(entries)) {
        collectFilesFromEntries(entries).then((files) => openModal(files));
      } else {
        openModal(plainFiles);
      }
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [disabled, gameId, isOpen, openModal]);

  const handleSubmit = useCallback(async () => {
    if (!gameId || footage.files.length < 1 || isAttaching) return;

    // Optimistic affordability pre-check (mirrors AttachVideoModal); defer to the
    // authoritative server charge when the balance isn't known yet.
    if (creditsLoaded && uploadCost !== null && creditBalance < uploadCost) {
      setShowBuyCredits(true);
      return;
    }

    const entries = footage.files.map((f) => ({
      file: f.file,
      recorded_at: toRecordedAt(f.creationTime),
    }));

    setProgress({ phase: UPLOAD_PHASE.HASHING, percent: 0, message: 'Preparing…' });
    try {
      const result = await attachVideoToExistingGame(gameId, entries, (p) => setProgress(p));
      // Landing feedback (recompute + toast/pulse) is the container's job — hand
      // it the count + the authoritative post-attach video list the endpoint
      // already returned (server-computed offsets), so it needn't re-fetch.
      onFootageAttached?.(entries.length, result?.videos);
      setIsOpen(false);
      setDroppedFiles(null);
      setFootage({ files: [], totalBytes: 0, proxies: {} });
      setProgress(null);
    } catch (err) {
      if (err?.insufficientCredits) {
        setProgress(null);
        setShowBuyCredits(true);
        return;
      }
      setProgress({ phase: UPLOAD_PHASE.ERROR, percent: 0, message: err?.message || 'Upload failed' });
      toast.error(err?.message || 'Failed to add footage');
    }
  }, [gameId, footage, isAttaching, creditsLoaded, uploadCost, creditBalance, onFootageAttached]);

  const dropOverlay =
    isFileDragging && !isOpen
      ? createPortal(
          <div
            className="fixed inset-0 z-40 flex items-center justify-center bg-gray-950/70 backdrop-blur-sm pointer-events-none"
            data-testid="add-footage-drop-target"
          >
            <div className="mx-6 max-w-md rounded-2xl border-2 border-dashed border-violet-400 bg-violet-950/40 px-8 py-10 text-center">
              <FilePlus size={40} className="mx-auto mb-3 text-violet-300" />
              <p className="text-base font-medium text-violet-100">{COPY.dropTarget}</p>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <button
        type="button"
        data-testid="add-footage-button"
        onClick={() => openModal(null)}
        disabled={disabled || !gameId}
        title={COPY.title}
        aria-label={COPY.title}
        className="inline-flex items-center gap-1.5 rounded-lg bg-gray-700 px-2.5 py-1.5 text-sm font-medium text-gray-200 transition-colors hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <FilePlus size={16} className="shrink-0" />
        <span className="hidden lg:inline">{COPY.label}</span>
      </button>

      {dropOverlay}

      {isOpen &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
            <div className="relative mx-4 max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-gray-700 bg-gray-800 shadow-2xl">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-gray-700 p-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-violet-600/20 p-2">
                    <FilePlus size={20} className="text-violet-300" />
                  </div>
                  <h2 className="text-lg font-semibold text-white">{COPY.modalHeading}</h2>
                </div>
                <button
                  onClick={closeModal}
                  disabled={isAttaching}
                  className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-700 hover:text-white disabled:opacity-50"
                  aria-label="Close"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-4 p-4">
                <p className="text-sm text-gray-400">{COPY.intro}</p>

                {/* Cost line — display only; the attach endpoint charges server-side. */}
                <div className="flex items-center justify-between rounded-lg bg-gray-700/50 px-3 py-2 text-sm text-gray-300">
                  <div className="flex items-center gap-2">
                    <Coins size={14} className="shrink-0 text-yellow-400" />
                    <span>
                      {displayCost} credit{displayCost !== 1 ? 's' : ''} - keeps this footage for 30 days
                    </span>
                  </div>
                  <span className="font-medium text-white">
                    Balance: {creditsLoaded ? creditBalance : '…'}
                  </span>
                </div>

                {/* Picker + strip only (attachMode hides game-metadata concerns). */}
                <GameFootagePicker
                  key={pickerKey}
                  attachMode
                  initialFiles={droppedFiles}
                  onFootageChange={setFootage}
                  isSubmitting={isAttaching}
                />

                {/* Progress */}
                {progress && progress.phase !== UPLOAD_PHASE.ERROR && (
                  <div>
                    <div className="mb-1 flex items-center justify-between text-xs text-gray-400">
                      <span>{progress.message || 'Uploading…'}</span>
                      <span>{Math.round(progress.percent || 0)}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-gray-700">
                      <div
                        className="h-full bg-violet-500 transition-[width] duration-200"
                        style={{ width: `${Math.round(progress.percent || 0)}%` }}
                      />
                    </div>
                  </div>
                )}

                <Button
                  type="button"
                  variant="primary"
                  size="lg"
                  onClick={handleSubmit}
                  disabled={footage.files.length < 1 || isAttaching}
                  className="w-full"
                  data-testid="add-footage-submit"
                >
                  {isAttaching ? COPY.primaryBusy : COPY.primary}
                </Button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {showBuyCredits && (
        <Suspense fallback={null}>
          <BuyCreditsModal
            onClose={() => setShowBuyCredits(false)}
            onPaymentSuccess={() => setShowBuyCredits(false)}
          />
        </Suspense>
      )}
    </>
  );
}

export default AddFootageButton;
