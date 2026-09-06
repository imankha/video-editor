import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Upload } from 'lucide-react';
import { toast } from './shared';
import { useFootageIntake } from '../hooks/useFootageIntake';
import { pairProxies, isJunkFile } from '../utils/footageIntake';
import { FootageList } from './FootageList';
import {
  entriesFromDataTransfer,
  hasDirectoryEntry,
  collectFilesFromEntries,
} from '../utils/folderDrop';

// Approved microcopy (artifact screen A). Kept as literals next to use.
const COPY = {
  heading: 'Drop your whole game here',
  sub: "One video or all of them - we'll put them in order",
  mobileSub: 'Tap to choose videos - pick as many as you want',
  dragOver: 'Drop everything here',
  folderLink: 'or add a whole folder',
  formats: 'MP4, MOV, or WebM',
  checking: 'Checking your videos...',
  zeroAccepted:
    "We didn't find any game videos in there. Look for MP4 or MOV files from your camera.",
};

/**
 * How many uploadable videos a raw selection would yield — mirrors the exact gate
 * useFootageIntake.addFiles applies (pairProxies then isJunkFile), so we can (a)
 * detect a zero-accepted selection without waiting on the async probe and (b) size
 * the "checking" skeleton to the batch. Single source of truth stays in
 * footageIntake — this only counts, it does not re-filter what gets added.
 */
function acceptedVideoCount(fileList) {
  const list = Array.from(fileList || []);
  const { videos } = pairProxies(list);
  return videos.filter((f) => !isJunkFile(f)).length;
}

/**
 * T8810 — Universal footage dropzone. One intake for a single file, many files, or
 * a whole camera folder; ordering + junk/proxy filtering live in useFootageIntake
 * (T8800). Three states driven by that hook's `status`:
 *   empty    → dropzone + hidden inputs (multi-select + folder) + folder link
 *   checking → pulsing skeleton chips, one per accepted file
 *   ready    → single item shows today's green filename+size chip byte-for-byte;
 *              2+ items show the always-draggable confirm list (FootageList, T8822).
 *
 * Reports its value up via onFootageChange({ files:[{file,sequence,creationTime}],
 * totalBytes, proxies }) — sequence is the 1-based index into the inferred order,
 * creationTime is the item's embedded recording time (Date|null, from T8800's
 * intake probe) threaded through to the upload as recorded_at (T8870). This is a
 * memory-only lift of form state to the parent (NOT a store/backend write), so the
 * reactive-persistence ban does not apply.
 */
export function GameFootagePicker({ onFootageChange, onFileSelected, isSubmitting = false }) {
  const { status, items, order, confidence, gaps, skipped, proxies, addFiles, removeItem, setManualOrder } =
    useFootageIntake();
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState(false);
  const [flashError, setFlashError] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);

  // Report the current footage plan upward whenever the inferred order changes.
  // order carries only successfully-probed videos, already in play sequence.
  useEffect(() => {
    if (!onFootageChange) return;
    const files = order.map((it, i) => ({
      file: it.file,
      sequence: i + 1,
      // T8870: carry the embedded recording time so the upload can send it as
      // recorded_at (evidence for overlap placement); null when the intake probe
      // found none — never a fabricated time.
      creationTime: it.creationTime instanceof Date ? it.creationTime : null,
    }));
    const totalBytes = order.reduce((sum, it) => sum + (it.size || 0), 0);
    onFootageChange({ files, totalBytes, proxies });
  }, [order, proxies, onFootageChange]);

  // Accept a raw selection from ANY path (click, multi-select, folder pick/drag).
  const ingest = useCallback(
    async (fileList) => {
      const list = Array.from(fileList || []);
      if (list.length === 0) return;
      const accepted = acceptedVideoCount(list);
      if (accepted === 0) {
        // Nothing uploadable (only junk/proxies) — stay on the dropzone, flash red.
        setError(true);
        setFlashError(true);
        setTimeout(() => setFlashError(false), 600);
        return;
      }
      setError(false);
      setPendingCount(accepted);
      // T7890 beacon: fire on the first accepted selection of every path. The
      // downstream milestone bridge is session-deduped, so per-call is safe.
      onFileSelected?.();
      const { duplicates } = await addFiles(list);
      for (const name of duplicates) {
        toast.info('Already added', { message: name });
      }
    },
    [addFiles, onFileSelected]
  );

  const handleInputChange = useCallback(
    (e) => {
      ingest(e.target.files);
      e.target.value = ''; // allow re-selecting the same file
    },
    [ingest]
  );

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      if (isSubmitting) return;
      // Collect entries SYNCHRONOUSLY (the item list is emptied after the event),
      // then walk any folder asynchronously before handing files to the hook.
      const entries = entriesFromDataTransfer(e.dataTransfer);
      const plainFiles = Array.from(e.dataTransfer?.files || []);
      if (hasDirectoryEntry(entries)) {
        collectFilesFromEntries(entries).then((files) => ingest(files));
      } else {
        ingest(plainFiles);
      }
    },
    [isSubmitting, ingest]
  );

  const openFilePicker = useCallback(() => {
    if (!isSubmitting) fileInputRef.current?.click();
  }, [isSubmitting]);

  const openFolderPicker = useCallback(() => {
    if (!isSubmitting) folderInputRef.current?.click();
  }, [isSubmitting]);

  const isChecking = status === 'checking';
  const acceptedItems = order; // ordered, probe-successful videos
  const isReady = !isChecking && acceptedItems.length >= 1;
  const skeletonCount = Math.max(items.length, pendingCount, 1);

  // Hidden inputs are always mounted so every state can trigger a pick.
  const hiddenInputs = (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/webm,video/*"
        multiple
        onChange={handleInputChange}
        className="hidden"
        data-testid="footage-file-input"
        disabled={isSubmitting}
      />
      <input
        ref={folderInputRef}
        type="file"
        webkitdirectory=""
        onChange={handleInputChange}
        className="hidden"
        data-testid="footage-folder-input"
        disabled={isSubmitting}
      />
    </>
  );

  if (isChecking) {
    return (
      <div data-testid="footage-picker-checking">
        {hiddenInputs}
        <div className="w-full px-4 py-3 border-2 border-dashed border-gray-600 rounded-lg bg-gray-900/50">
          <p className="text-sm text-gray-300 mb-2">{COPY.checking}</p>
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: skeletonCount }).map((_, i) => (
              <div
                key={i}
                data-testid="footage-skeleton-chip"
                className="h-6 w-24 rounded bg-gray-700 animate-pulse"
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (isReady && acceptedItems.length === 1) {
    // Single file: today's exact green chip, byte-for-byte.
    const only = acceptedItems[0];
    return (
      <div data-testid="footage-picker-ready-single">
        {hiddenInputs}
        <div
          role="button"
          tabIndex={0}
          onClick={openFilePicker}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              openFilePicker();
            }
          }}
          onDragOver={handleDragOver}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`w-full px-4 py-3 border-2 border-dashed rounded-lg transition-colors cursor-pointer border-green-500 bg-green-900/20 ${
            isSubmitting ? 'opacity-50 pointer-events-none' : ''
          }`}
        >
          <div className="text-center">
            <p className="text-green-400 font-medium truncate">{only.name}</p>
            <p className="text-xs text-gray-500 mt-1">
              {(only.size / (1024 * 1024)).toFixed(1)} MB
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (isReady) {
    // 2+ files: the always-draggable confirm list (T8822 — one list, not a strip
    // plus a separate reorder editor).
    return (
      <div data-testid="footage-picker-ready-multi">
        {hiddenInputs}
        {/* The list container stays a drop target so more files merge via addFiles. */}
        <div
          onDragOver={handleDragOver}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={isSubmitting ? 'opacity-50 pointer-events-none' : ''}
        >
          <FootageList
            order={order}
            items={items}
            confidence={confidence}
            gaps={gaps}
            skipped={skipped}
            onReorder={setManualOrder}
            onRemove={removeItem}
            onAddMore={openFilePicker}
          />
        </div>
        {/* A junk-only "add more" selection must still surface feedback here. */}
        {error && (
          <p className="text-sm text-red-400 mt-2" data-testid="footage-error">
            {COPY.zeroAccepted}
          </p>
        )}
      </div>
    );
  }

  // empty (also the zero-accepted error case — stays on the dropzone)
  return (
    <div data-testid="footage-picker-empty">
      {hiddenInputs}
      <div
        role="button"
        tabIndex={0}
        onClick={openFilePicker}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openFilePicker();
          }
        }}
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`w-full px-4 py-6 border-2 border-dashed rounded-lg transition-colors cursor-pointer ${
          flashError
            ? 'border-red-500 bg-red-900/20'
            : isDragging
              ? 'border-blue-400 bg-blue-900/30'
              : 'border-gray-600 hover:border-gray-500 bg-gray-900/50'
        } ${isSubmitting ? 'opacity-50 pointer-events-none' : ''}`}
      >
        <div className="text-center text-gray-400">
          <Upload size={24} className="mx-auto mb-2" />
          <p className="font-medium text-gray-200">
            {isDragging ? COPY.dragOver : COPY.heading}
          </p>
          {/* Desktop vs. touch sub-copy — coarse pointers can't drag files. */}
          <p className="text-xs text-gray-500 mt-1 hidden fine-pointer:block">{COPY.sub}</p>
          <p className="text-xs text-gray-500 mt-1 fine-pointer:hidden">{COPY.mobileSub}</p>
          <p className="text-xs text-gray-600 mt-1">{COPY.formats}</p>
        </div>
      </div>

      {/* Folder pick is desktop-only (webkitdirectory has no coarse-pointer UX). */}
      <button
        type="button"
        onClick={openFolderPicker}
        disabled={isSubmitting}
        className="hidden fine-pointer:block mt-2 text-xs text-blue-400 hover:text-blue-300 disabled:opacity-50"
        data-testid="footage-folder-link"
      >
        {COPY.folderLink}
      </button>

      {error && (
        <p className="text-sm text-red-400 mt-2" data-testid="footage-error">
          {COPY.zeroAccepted}
        </p>
      )}
    </div>
  );
}

export default GameFootagePicker;
