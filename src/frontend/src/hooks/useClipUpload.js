import { useCallback, useState } from 'react';
import { ensureVideoInR2, uploadClipsBatch, UPLOAD_PHASE } from '../services/uploadManager';
import { useProjectsStore } from '../stores/projectsStore';

// Mirrors uploadStore.js's progressToPercent mapping (T8370 Slice E: "reuse the
// existing uploadStore shape") — a single continuous 0-100 bar per file, without
// pulling clip uploads into that store's game-creation-specific queue/toast logic.
//
// T10260 honest progress: a file's R2 bytes being durable (UPLOAD_PHASE.COMPLETE)
// is NOT the clip being ready — the clip row + auto-project only exist after the
// batch POST /api/clips/upload lands and fetchProjects resolves. So COMPLETE caps
// at 99 ("Creating your clip..."); only uploadClips itself pushes 100 once the
// project is actually in the store. The bar never reads 100% before the tile exists.
export const CLIP_UPLOAD_CREATING_PCT = 99;
export function progressToPercent(progress) {
  if (progress.phase === UPLOAD_PHASE.HASHING) return Math.round(progress.percent * 0.15);
  if (progress.phase === UPLOAD_PHASE.PREPARING) return 15;
  if (progress.phase === UPLOAD_PHASE.UPLOADING) return 15 + Math.round(progress.percent * 0.83);
  if (progress.phase === UPLOAD_PHASE.FINALIZING) return 98;
  if (progress.phase === UPLOAD_PHASE.COMPLETE) return CLIP_UPLOAD_CREATING_PCT;
  return 0;
}

// T10250: the clip-batch per-item error codes (clips.py upload_clips_batch —
// source_missing / probe_failed / duration_exceeds_cap / insufficient_credits)
// are all non-retryable REFUSALS: the same bytes re-posted fail identically, so
// these rows get the server's reason and NO Retry. Retryable failures are the
// transient transport ones (network/R2/finalize 5xx, and the whole-batch POST
// failing before it was processed).

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

  const uploadClips = useCallback(async (files) => {
    setIsUploading(true);
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
        // T10250: carry the refusal class through. A prepare-upload 400 (bad
        // kind/hash, over-cap) is tagged err.refused by uploadManager and is NOT
        // retryable; everything else (network/R2/finalize) is transient -> Retry.
        perFileErrors.push({
          ok: false,
          original_filename: file.name,
          error: err.message,
          retryable: !err.refused,
        });
        setProgressByFile((prev) => ({ ...prev, [file.name]: -1 }));
      }
    }

    if (landed.length === 0) {
      setIsUploading(false);
      return { results: [...perFileErrors], charged: 0, balance: null };
    }

    // T10250: batch results only carry blake3_hash; reunite them with the
    // original filename so the rail/dialog can name (and, for retryables, re-run)
    // the right file.
    const filenameByHash = new Map(landed.map((l) => [l.blake3_hash, l.original_filename]));
    const enrichBatchResult = (r) => {
      const original_filename = filenameByHash.get(r.blake3_hash) ?? null;
      if (r.ok) return { ...r, original_filename };
      // Every clip-batch error code is a non-retryable refusal (see the note
      // above); an unrecognized code is treated conservatively as non-retryable
      // too — a surprising server reason is not something a blind Retry should
      // paper over.
      return { ...r, original_filename, retryable: false, code: r.error };
    };

    try {
      const batchResult = await uploadClipsBatch(landed);

      // T8370 Slice E: reuse T8480's announceReelCreated CONTRACT (select the
      // new project + force-refresh the list, unlocking Focus) — without its
      // reel-specific toast copy, which belongs to the entry point (it has the
      // full N-clips/partial-failure context to word correctly).
      const firstCreated = batchResult.results.find((r) => r.ok && r.project_id);
      if (firstCreated) {
        useProjectsStore.getState().selectProject(firstCreated.project_id);
        await useProjectsStore.getState().fetchProjects({ force: true });
      }

      // T10260 honest progress: the clip rows now exist in the store, so the bars
      // may finally read 100. Until this point every landed file sat at 99
      // ("Creating your clip...").
      setProgressByFile((prev) => {
        const next = { ...prev };
        for (const l of landed) {
          if (next[l.original_filename] >= 0) next[l.original_filename] = 100;
        }
        return next;
      });

      return {
        ...batchResult,
        results: [...batchResult.results.map(enrichBatchResult), ...perFileErrors],
      };
    } catch (err) {
      // T10250: the batch POST itself failed (network / 5xx) before any row was
      // created — the landed bytes are fine, so re-running the batch is valid:
      // these are RETRYABLE, and they keep their original filename so Retry works.
      console.error('[useClipUpload] Batch POST /api/clips/upload failed:', err);
      return {
        results: [
          ...landed.map((item) => ({
            ok: false,
            blake3_hash: item.blake3_hash,
            original_filename: item.original_filename,
            error: 'batch_failed',
            retryable: true,
          })),
          ...perFileErrors,
        ],
        charged: 0,
        balance: null,
      };
    } finally {
      setIsUploading(false);
    }
  }, []);

  return { uploadClips, progressByFile, isUploading };
}

export default useClipUpload;
