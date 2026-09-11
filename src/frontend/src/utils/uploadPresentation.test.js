/**
 * T9430: the four honest upload states (Preparing / Uploading / Saved / Upload failed)
 * must map deterministically from the real uploadManager phase machine. One helper,
 * one mapping, unit-tested for every phase so no surface can drift.
 */
import { describe, it, expect } from 'vitest';
import { UPLOAD_PHASE } from '../services/uploadManager';
import { UPLOAD_STATE } from '../config/displayNames';
import {
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
    expect(uploadStateLabel(UPLOAD_UI_STATE.FAILED)).toBe(UPLOAD_STATE.FAILED);
  });

  it('treats only pre-ack states as an unsaved local preview', () => {
    expect(isLocalPreviewUnsaved(UPLOAD_UI_STATE.PREPARING)).toBe(true);
    expect(isLocalPreviewUnsaved(UPLOAD_UI_STATE.UPLOADING)).toBe(true);
    expect(isLocalPreviewUnsaved(UPLOAD_UI_STATE.SAVED)).toBe(false);
    expect(isLocalPreviewUnsaved(UPLOAD_UI_STATE.FAILED)).toBe(false);
  });
});
