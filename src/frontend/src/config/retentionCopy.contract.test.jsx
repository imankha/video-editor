import { describe, it, expect } from 'vitest';
import { UPLOAD } from './displayNames.js';
import {
  GAME_RETENTION_NOTE,
  ATTACH_RETENTION_NOTE,
  FOOTAGE_RETENTION_NOTE,
} from '../../e2e/helpers/retentionCopy.js';

// Drift tripwire (proof-verifier gap, 2026-10-04): three Playwright specs
// (T8910, t4940, new-user-flow) silently rotted asserting the OLD retention copy
// after T11770 replaced it, because Branch CI never runs Playwright. The e2e
// specs now assert via e2e/helpers/retentionCopy.js, but those specs CANNOT
// import src/config/displayNames.js (its transitive pricing.json import breaks
// Playwright's ESM loader). This Vitest test CAN import both, so it pins the e2e
// literals equal to the live UPLOAD.*_RETENTION_NOTE constants. It runs in the
// frontend unit CI job, so any future production copy change fails HERE loudly,
// pointing at the one file to update (e2e/helpers/retentionCopy.js).
describe('retention-copy contract: e2e literals <-> displayNames UPLOAD', () => {
  it('matches the live GAME/ATTACH/FOOTAGE retention notes', () => {
    expect(GAME_RETENTION_NOTE).toBe(UPLOAD.GAME_RETENTION_NOTE);
    expect(ATTACH_RETENTION_NOTE).toBe(UPLOAD.ATTACH_RETENTION_NOTE);
    expect(FOOTAGE_RETENTION_NOTE).toBe(UPLOAD.FOOTAGE_RETENTION_NOTE);
  });
});
