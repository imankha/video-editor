import { useCallback, useState } from 'react';
import { ensureVideoInR2, uploadClipsBatch, UPLOAD_PHASE } from '../services/uploadManager';
import { useProjectsStore } from '../stores/projectsStore';

// Mirrors uploadStore.js's progressToPercent mapping (T8370 Slice E: "reuse the
// existing uploadStore shape") — a single continuous 0-100 bar per file, without
// pulling clip uploads into that store's game-creation-specific queue/toast logic.
function progressToPercent(progress) {
  if (progress.phase === UPLOAD_PHASE.HASHING) return Math.round(progress.percent * 0.15);
  if (progress.phase === UPLOAD_PHASE.PREPARING) return 15;
  if (progress.phase === UPLOAD_PHASE.UPLOADING) return 15 + Math.round(progress.percent * 0.83);
  if (progress.phase === UPLOAD_PHASE.FINALIZING) return 98;
  if (progress.phase === UPLOAD_PHASE.COMPLETE) return 100;
  return 0;
}

/**
 * T8370: batch pre-cut clip upload orchestration — the reusable CAPABILITY
 * this task ships. The entry point (button, consequence-notice UI) belongs to
 * T8380; this hook only does: hash -> prepare -> parts -> finalize per file
 * (kind='clip'), then ONE POST /api/clips/upload for the whole batch.
 *
 * Partial failure is first class: a file that fails to reach R2 is reported
 * per-file and does not block its siblings from batching.
 */
export function useClipUpload() {
  const [progressByFile, setProgressByFile] = useState({});
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState(null);

  const uploadClips = useCallback(async (files) => {
    setIsUploading(true);
    setError(null);
    setProgressByFile({});

    const landed = []; // items whose bytes are durable in R2, ready to batch
    const perFileErrors = [];

    for (const file of files) {
      try {
        const result = await ensureVideoInR2(file, (progress) => {
          setProgressByFile((prev) => ({
            ...prev,
            [file.name]: progressToPercent(progress),
          }));
        }, { kind: 'clip' });

        landed.push({
          blake3_hash: result.blake3_hash,
          file_size: result.file_size,
          original_filename: file.name,
        });
      } catch (err) {
        console.error('[useClipUpload] Failed to land clip source in R2:', file.name, err);
        perFileErrors.push({ original_filename: file.name, error: err.message });
        setProgressByFile((prev) => ({ ...prev, [file.name]: -1 }));
      }
    }

    if (landed.length === 0) {
      setIsUploading(false);
      const message = 'All clip uploads failed before reaching R2';
      setError(message);
      return { results: perFileErrors.map((e) => ({ ok: false, ...e })), charged: 0, balance: null };
    }

    try {
      const batchResult = await uploadClipsBatch(landed);

      // T8370 Slice E: reuse T8480's announceReelCreated CONTRACT (select the
      // new project + force-refresh the list, unlocking Focus) — without its
      // reel-specific toast copy, which belongs to T8380's entry point (it has
      // the full N-clips/partial-failure context to word correctly).
      const firstCreated = batchResult.results.find((r) => r.ok && r.project_id);
      if (firstCreated) {
        useProjectsStore.getState().selectProject(firstCreated.project_id);
        await useProjectsStore.getState().fetchProjects({ force: true });
      }

      return {
        ...batchResult,
        results: [...batchResult.results, ...perFileErrors.map((e) => ({ ok: false, ...e }))],
      };
    } catch (err) {
      console.error('[useClipUpload] Batch POST /api/clips/upload failed:', err);
      setError(err.message);
      return {
        results: [
          ...landed.map((item) => ({ ok: false, blake3_hash: item.blake3_hash, error: 'batch_failed' })),
          ...perFileErrors.map((e) => ({ ok: false, ...e })),
        ],
        charged: 0,
        balance: null,
      };
    } finally {
      setIsUploading(false);
    }
  }, []);

  return { uploadClips, progressByFile, isUploading, error };
}

export default useClipUpload;
