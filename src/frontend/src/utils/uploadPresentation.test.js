/**
 * T9430: the four honest upload states (Preparing / Uploading / Saved / Upload failed)
 * must map deterministically from the real uploadManager phase machine. One helper,
 * one mapping, unit-tested for every phase so no surface can drift.
 */
import { describe, it, expect } from 'vitest';
import { UPLOAD_PHASE } from '../services/uploadManager';
import { UPLOAD_STATE } from '../config/displayNames';
import {
  uploadPhasePresentation,
  uploadUiState,
  uploadStateLabel,
  isLocalPreviewUnsaved,
  UPLOAD_UI_STATE,
} from './uploadPresentation';

describe('T9430 uploadUiState mapping', () => {
  it('maps local pre-transfer phases to Preparing', () => {
    for (const phase of [UPLOAD_PHASE.HASHING, UPLOAD_PHASE.PREPARING, UPLOAD_PHASE.IDLE]) {
      expect(uploadUiState({ phase })).toBe(UPLOAD_UI_STATE.PREPARING);
    }
  });

  it('maps transfer/finalize phases to Uploading', () => {
    expect(uploadUiState({ phase: UPLOAD_PHASE.UPLOADING })).toBe(UPLOAD_UI_STATE.UPLOADING);
    expect(uploadUiState({ phase: UPLOAD_PHASE.FINALIZING })).toBe(UPLOAD_UI_STATE.UPLOADING);
  });

  it('maps COMPLETE (server ack) to Saved', () => {
    expect(uploadUiState({ phase: UPLOAD_PHASE.COMPLETE })).toBe(UPLOAD_UI_STATE.SAVED);
  });

  it('maps an errored entry to Upload failed', () => {
    expect(uploadUiState({ phase: UPLOAD_PHASE.ERROR })).toBe(UPLOAD_UI_STATE.FAILED);
  });

  it('returns null for no entry', () => {
    expect(uploadUiState(null)).toBeNull();
    expect(uploadUiState(undefined)).toBeNull();
  });

  it('labels each state from the single displayNames source', () => {
    expect(uploadStateLabel(UPLOAD_UI_STATE.PREPARING)).toBe(UPLOAD_STATE.PREPARING);
    expect(uploadStateLabel(UPLOAD_UI_STATE.UPLOADING)).toBe(UPLOAD_STATE.UPLOADING);
    expect(uploadStateLabel(UPLOAD_UI_STATE.SAVED)).toBe(UPLOAD_STATE.SAVED);
    expect(UPLOAD_STATE.SAVED).toBe('Uploaded');
    expect(uploadStateLabel(UPLOAD_UI_STATE.FAILED)).toBe(UPLOAD_STATE.FAILED);
  });

  it('treats only pre-ack states as an unsaved local preview', () => {
    expect(isLocalPreviewUnsaved(UPLOAD_UI_STATE.PREPARING)).toBe(true);
    expect(isLocalPreviewUnsaved(UPLOAD_UI_STATE.UPLOADING)).toBe(true);
    expect(isLocalPreviewUnsaved(UPLOAD_UI_STATE.SAVED)).toBe(false);
    expect(isLocalPreviewUnsaved(UPLOAD_UI_STATE.FAILED)).toBe(false);
  });
});

describe('T11870 uploadPhasePresentation', () => {
  const KEEP_OPEN = 'Keep this tab open until it finishes.';
  it('gives one percent-free sentence per phase', () => {
    expect(uploadPhasePresentation(UPLOAD_PHASE.HASHING).sentence).toBe('Getting your game ready to upload');
    expect(uploadPhasePresentation(UPLOAD_PHASE.PREPARING).sentence).toBe('Getting your game ready to upload');
    expect(uploadPhasePresentation(UPLOAD_PHASE.UPLOADING).sentence).toBe('Uploading your game');
    expect(uploadPhasePresentation(UPLOAD_PHASE.FINALIZING).sentence).toBe('Finishing up');
    expect(uploadPhasePresentation(UPLOAD_PHASE.COMPLETE).sentence).toBe('Your game is uploaded.');
    expect(uploadPhasePresentation(UPLOAD_PHASE.ERROR).sentence).toBe('Upload stopped.');
    for (const p of Object.values(UPLOAD_PHASE)) {
      expect(uploadPhasePresentation(p).sentence).not.toMatch(/\d+%/);
    }
  });

  it('sub-lines tell the parent to keep the tab open', () => {
    for (const p of [UPLOAD_PHASE.HASHING, UPLOAD_PHASE.PREPARING, UPLOAD_PHASE.FINALIZING]) {
      expect(uploadPhasePresentation(p).subLine).toBe(KEEP_OPEN);
    }
    expect(uploadPhasePresentation(UPLOAD_PHASE.UPLOADING).subLine)
      .toBe(`${KEEP_OPEN} You can start marking plays.`);
  });
});
