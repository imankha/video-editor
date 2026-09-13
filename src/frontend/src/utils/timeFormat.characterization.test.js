import { describe, it, expect } from 'vitest';
import {
  formatTime as tfFormatTime,
  formatTimeSimple as tfFormatTimeSimple,
  formatClock as tfFormatClock,
  formatGameClock,
  formatInstant,
  formatLength,
  PRECISION,
} from './timeFormat';
/**
 * T9480 Stage A -- characterization suite.
 *
 * Pins the CURRENT (pre-refactor) output of every seconds->string formatter in
 * the codebase (19 named + 6 inline expressions, design doc section 1.2) at a
 * fixed input set. Stage C replaces the private per-component copies below with
 * calls to the canonical utils/timeFormat.js formatInstant/formatLength;
 * re-running this file before and after each Stage C commit is the proof that
 * the move is byte-identical -- any diff here is a bug, not a valid "mechanical"
 * move. The `59.97 -> "00:60.0"` row on `csrFormatTime` is a documented CURRENT
 * bug (a nonexistent clock reading), not a spec to preserve -- Stage D1 fixes it
 * and that is expected to flip this specific assertion.
 *
 * Private (non-exported) formatters can't be imported, so their CURRENT
 * implementation is copied verbatim below with a file:line pointer -- this is a
 * snapshot of behavior about to be deleted, not new logic being introduced here.
 */

const INPUTS = [0, 0.4, 0.5, 2.973, 6.027, 59.97, 60, 3599.9, 3600, NaN, null, -1];

function describeInput(v) {
  if (typeof v === 'number' && Number.isNaN(v)) return 'NaN';
  if (v === null) return 'null';
  return String(v);
}

const THROWS = Symbol('throws');

function pin(name, fn, expected) {
  describe(name, () => {
    INPUTS.forEach((input, i) => {
      const exp = expected[i];
      it(`(${describeInput(input)}) -> ${exp === THROWS ? 'throws' : JSON.stringify(exp)}`, () => {
        if (exp === THROWS) {
          expect(() => fn(input)).toThrow();
        } else {
          expect(fn(input)).toEqual(exp);
        }
      });
    });
  });
}

// ---- private per-component copies, characterized verbatim (deleted in Stage C/D) ----

/** ClipScrubRegion.jsx:15 -- deleted in Stage D1, replaced by formatInstant(s, TENTH).
 *  Contains the reported bug: 59.97 -> mins=0, secs.toFixed(1)="60.0" -> "00:60.0". */
function csrFormatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toFixed(1).padStart(4, '0')}`;
}

/** ClipListItem.jsx:62 and ClipRegionLayer.jsx:49 -- byte-identical copies,
 *  deleted in Stage C1, replaced by formatInstant(s, SECOND). */
function cliFormatTime(seconds) {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/** ClipLibraryModal.jsx:13 -- deleted in Stage C2, replaced by formatInstant(s, SECOND). */
function clmFormatDuration(seconds) {
  if (!seconds || seconds <= 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/** GameClipSelectorModal.jsx:164 -- deleted in Stage D2 (gains the hours case). */
function gcsmFormatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/** useDownloads.js:340 -- deleted in Stage C2, replaced by formatLength(...). */
function udFormatDuration(seconds) {
  if (seconds == null || isNaN(seconds)) return null;
  const totalSeconds = Math.round(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

/** ShareGameModal.jsx:26 -- deleted in Stage C2, replaced by formatInstant(s, SECOND). */
function sgmFmtTimestamp(seconds) {
  if (seconds == null || Number.isNaN(seconds)) return '';
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** useAnnotate.js:54 -- a WIRE FORMAT (TSV round-trip), left untouched by this task. */
function uaFormatSecondsForTsv(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** useAnnotate.js:230 -- a NAME GENERATOR frozen into persisted clip names, left
 *  untouched by this task. */
function uaFormatTimestampForName(seconds) {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/** clipConstants.js:108 -- formatDuration DELETED in Stage C3 (its 1 importer,
 *  ClipSelectorSidebar, now calls formatLength(..., TENTH) directly). */
function ccFormatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return '0.0s';
  return `${seconds.toFixed(1)}s`;
}

/** timeFormat.js:53 (module func #3) -- formatTimeCompact DELETED (T9480
 *  review fix, MINOR #7): Stage D3 moved its only consumer (VideoControls'
 *  default time display) to formatInstant, leaving it with zero real
 *  importers -- a formatter that ROUNDS a position, sitting unused in the
 *  very module whose point is "instants floor", was clutter this task exists
 *  to remove. */
function tfFormatTimeCompact(seconds) {
  if (isNaN(seconds) || seconds < 0) return '0.0';
  return seconds.toFixed(1);
}

/** clipConstants.js:118 -- formatTimeSimple DELETED in Stage C3 (its 5
 *  importers now call formatInstant(..., SECOND) directly; this was also the
 *  #2/#8 name collision the design flagged as the worst smell in the set). */
function ccFormatTimeSimple(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/** components/collections/format.js:4 -- module DELETED in Stage C2 (its 7
 *  importers now call formatLength(..., {style:'clock'}) directly). */
function collFormatDuration(seconds) {
  if (seconds == null || isNaN(seconds)) return null;
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** components/collections/format.js:19 -- module DELETED in Stage C2 (its
 *  importers now call formatLength(..., {style:'human'}) directly). */
function collFormatDurationHuman(seconds) {
  if (seconds == null || isNaN(seconds)) return null;
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  return `${s}s`;
}

// ---- shared-module formatters (module funcs #1-#10, unchanged by Stage C moves) ----

pin('timeFormat.formatTime (#1)', tfFormatTime, [
  '00:00:00.000', '00:00:00.400', '00:00:00.500', '00:00:02.972', '00:00:06.027',
  '00:00:59.969', '00:01:00.000', '00:59:59.900', '01:00:00.000',
  '00:00:00.000', '00:00:00.000', '00:00:00.000',
]);

// T9480 Stage D2: formatTimeSimple gained the hours case (a timeline hover
// past 1h used to read "60:00.000"; it now reads "1:00:00.000") -- this row
// is intentionally UPDATED, not preserved, to document that flip.
pin('timeFormat.formatTimeSimple (#2, post-Stage-D2)', tfFormatTimeSimple, [
  '0:00.000', '0:00.400', '0:00.500', '0:02.972', '0:06.027',
  '0:59.969', '1:00.000', '59:59.900', '1:00:00.000',
  '0:00.000', '0:00.000', '0:00.000',
]);

pin('timeFormat.formatTimeCompact (#3)', tfFormatTimeCompact, [
  '0.0', '0.4', '0.5', '3.0', '6.0',
  '60.0', '60.0', '3599.9', '3600.0',
  '0.0', THROWS, '0.0',
]);

pin('timeFormat.formatClock (#4)', tfFormatClock, [
  '0:00', '0:00', '0:00', '0:02', '0:06',
  '0:59', '1:00', '59:59', '1:00:00',
  '0:00', '0:00', '0:00',
]);

pin('timeFormat.formatGameClock (#5)', formatGameClock, [
  "0'00\"", "0'00\"", "0'00\"", "0'02\"", "0'06\"",
  "0'59\"", "1'00\"", "59'59\"", "60'00\"",
  null, null, null,
]);

pin('clipConstants.formatDuration (#7)', ccFormatDuration, [
  '0.0s', '0.4s', '0.5s', '3.0s', '6.0s',
  '60.0s', '60.0s', '3599.9s', '3600.0s',
  '0.0s', '0.0s', '-1.0s',
]);

pin('clipConstants.formatTimeSimple (#8)', ccFormatTimeSimple, [
  '0:00', '0:00', '0:00', '0:02', '0:06',
  '0:59', '1:00', '59:59', '60:00',
  '0:00', '0:00', '-1:-1',
]);

pin('collections/format.formatDuration (#9)', collFormatDuration, [
  '0:00', '0:00', '0:01', '0:03', '0:06',
  '1:00', '1:00', '1:00:00', '1:00:00',
  null, null, '-1:-1',
]);

pin('collections/format.formatDurationHuman (#10)', collFormatDurationHuman, [
  '0s', '0s', '1s', '3s', '6s',
  '1m', '1m', '1h', '1h',
  null, null, '-1s',
]);

// ---- per-component private copies (#11-#19) ----

pin('ClipScrubRegion.formatTime (#11)', csrFormatTime, [
  '00:00.0', '00:00.4', '00:00.5', '00:03.0', '00:06.0',
  '00:60.0', // <- the reported bug, DOCUMENTED as current behavior, flipped by Stage D1
  '01:00.0', '59:59.9', '60:00.0',
  'NaN:0NaN', '00:00.0', '-1:-1.0',
]);

pin('ClipListItem/ClipRegionLayer.formatTime (#12/#13)', cliFormatTime, [
  '0:00', '0:00', '0:00', '0:02', '0:06',
  '0:59', '1:00', '59:59', '1:00:00',
  'NaN:NaN', '0:00', '-1:-1',
]);

pin('ClipLibraryModal.formatDuration (#14)', clmFormatDuration, [
  '0:00', '0:00', '0:00', '0:02', '0:06',
  '0:59', '1:00', '59:59', '60:00',
  '0:00', '0:00', '0:00',
]);

pin('GameClipSelectorModal.formatDuration (#15)', gcsmFormatDuration, [
  '0:00', '0:00', '0:00', '0:02', '0:06',
  '0:59', '1:00', '59:59', '60:00',
  'NaN:NaN', '0:00', '-1:-1',
]);

pin('useDownloads.formatDuration (#16)', udFormatDuration, [
  '0:00', '0:00', '0:01', '0:03', '0:06',
  '1:00', '1:00', '1:00:00', '1:00:00',
  null, null, '-1:-1',
]);

pin('ShareGameModal.fmtTimestamp (#17)', sgmFmtTimestamp, [
  '0:00', '0:00', '0:00', '0:02', '0:06',
  '0:59', '1:00', '59:59', '60:00',
  '', '', '0:00',
]);

pin('useAnnotate.formatSecondsForTsv (#18, wire format, untouched)', uaFormatSecondsForTsv, [
  '0:00', '0:00', '0:00', '0:02', '0:06',
  '0:59', '1:00', '59:59', '60:00',
  'NaN:NaN', '0:00', '-1:-1',
]);

pin('useAnnotate.formatTimestampForName (#19, name generator, untouched)', uaFormatTimestampForName, [
  '00:00:00', '00:00:00', '00:00:00', '00:00:02', '00:00:06',
  '00:00:59', '00:01:00', '00:59:59', '01:00:00',
  'NaN:NaN:NaN', '00:00:00', '-1:-1:-1',
]);

// ---- inline (unnamed) formatting expressions -- realistic (finite, non-negative) inputs only,
// since every real call site feeds these a computed numeric duration, never NaN/null/negative ----

const POSITIVE_INPUTS = [0, 0.4, 0.5, 2.973, 6.027, 59.97, 60, 3599.9, 3600];

describe('ClipScrubRegion.jsx:541,556 inline clipDuration.toFixed(1) + "s"', () => {
  const expected = ['0.0s', '0.4s', '0.5s', '3.0s', '6.0s', '60.0s', '60.0s', '3599.9s', '3600.0s'];
  POSITIVE_INPUTS.forEach((v, i) => {
    it(`(${v}) -> ${expected[i]}`, () => {
      expect(`${v.toFixed(1)}s`).toBe(expected[i]);
    });
  });
});

describe('ClipScrubRegion.jsx:603 inline tick label', () => {
  const expected = ['0:00', '0:00', '0:00', '0:02', '0:06', '0:59', '1:00', '59:59', '60:00'];
  POSITIVE_INPUTS.forEach((v, i) => {
    it(`(${v}) -> ${expected[i]}`, () => {
      expect(`${Math.floor(v / 60)}:${String(Math.floor(v % 60)).padStart(2, '0')}`).toBe(expected[i]);
    });
  });
});

describe('AnnotateControls.jsx:194 inline elapsed/clipLength', () => {
  it('(2.973, 6.027) -> "3.0s / 6.0s"', () => {
    const elapsed = 2.973;
    const clipLength = 6.027;
    expect(`${elapsed.toFixed(1)}s / ${clipLength.toFixed(1)}s`).toBe('3.0s / 6.0s');
  });
});

describe('HighlightLayer.jsx:259 inline highlightDuration.toFixed(1) + "s"', () => {
  const expected = ['0.0s', '0.4s', '0.5s', '3.0s', '6.0s', '60.0s', '60.0s', '3599.9s', '3600.0s'];
  POSITIVE_INPUTS.forEach((v, i) => {
    it(`(${v}) -> ${expected[i]}`, () => {
      expect(`${v.toFixed(1)}s`).toBe(expected[i]);
    });
  });
});

describe('SegmentLayer.jsx:150 inline title', () => {
  it('(6.027) -> "6.0s -> 6.0s"', () => {
    const d = 6.027;
    expect(`${d.toFixed(1)}s -> ${d.toFixed(1)}s`).toBe('6.0s -> 6.0s');
  });
});

describe('videoMetadata.js:413 inline durationFormatted (debug log only)', () => {
  const expected = [
    '0:0.00', '0:0.40', '0:0.50', '0:2.97', '0:6.03',
    '0:59.97', '1:0.00', '59:59.90', '60:0.00',
  ];
  POSITIVE_INPUTS.forEach((v, i) => {
    it(`(${v}) -> ${expected[i]}`, () => {
      expect(`${Math.floor(v / 60)}:${(v % 60).toFixed(2)}`).toBe(expected[i]);
    });
  });
});

// ---------------------------------------------------------------------------
// T9480 review fix (MAJOR #3) -- Stage C EQUIVALENCE PROOFS.
//
// The `pin()` tables above only prove the hand-copied OLD-behavior replica
// (frozen, since the real function is deleted) matches a literal table --
// that literal table was correct at Stage A authoring time, but after Stage
// C's commits (f406ff6a, 61601ef7) replaced the imports of the REAL
// clipConstants/collections/format functions with these same replicas IN THE
// SAME COMMIT as deleting them, nothing in this file any longer compares
// against the REAL current canonical function. The blocks below close that
// gap: for every migrated pair, assert `oldReplica(v) === realCanonicalFn(v)`
// using the ACTUAL imported formatInstant/formatLength (called with the exact
// precision/style used at the real call site), over the realistic
// (non-negative, finite) input range every real call site ever sees. Divergs
// on NaN/negative/null are DOCUMENTED, pre-existing, and intentionally
// excluded here (see the Stage C/D4 commit messages) -- they are about
// silent-fallback removal, not migration correctness.
// ---------------------------------------------------------------------------

function assertEquivalence(name, oldFn, newFn, inputs = POSITIVE_INPUTS) {
  describe(`Stage C equivalence: ${name}`, () => {
    inputs.forEach((v) => {
      it(`oldFn(${v}) === realCanonicalFn(${v})`, () => {
        expect(newFn(v)).toBe(oldFn(v));
      });
    });
  });
}

// Inputs under the 1-hour boundary, for pairs where formatInstant's built-in
// (always-on) hours support is a KNOWN, documented divergence from an old
// formatter that never had an hours branch -- asserted separately below,
// not silently dropped.
const POSITIVE_INPUTS_UNDER_1H = POSITIVE_INPUTS.filter((v) => v < 3600);

// #12/#13 ClipListItem/ClipRegionLayer.formatTime -> formatInstant(v, SECOND)
// (both real call sites are game-timeline positions well under 1h in practice;
// no hours-boundary divergence has been observed/documented for these two).
assertEquivalence(
  'ClipListItem/ClipRegionLayer.formatTime (#12/#13) vs formatInstant(v, SECOND)',
  cliFormatTime,
  (v) => formatInstant(v, PRECISION.SECOND),
);

// #14 ClipLibraryModal.formatDuration -- Stage C2's ACTUAL migration target
// was formatInstant(v, SECOND) (proven here, byte-identical under 1h, same
// documented hours-gain above 1h as #8/#17 below). The review round's
// BLOCKING #2 fix later moved ClipLibraryModal's TWO real call sites off
// formatInstant onto formatLength(v, SECOND, {style:'clock'}) (a length
// should round, not floor) -- a SEPARATE, deliberate, later divergence from
// this Stage C proof, covered by ClipLibraryModal.honestZero.test.jsx and the
// FocusModeView.outputLengthChip.test.jsx sibling-fix pattern, not by this
// characterization file (whose job is pinning what Stage C itself did).
assertEquivalence(
  'ClipLibraryModal.formatDuration (#14) vs formatInstant(v, SECOND) [Stage C2 proof]',
  clmFormatDuration,
  (v) => formatInstant(v, PRECISION.SECOND),
  POSITIVE_INPUTS_UNDER_1H,
);

// #17 ShareGameModal.fmtTimestamp -> formatInstant(max(0, v), SECOND)
assertEquivalence(
  'ShareGameModal.fmtTimestamp (#17) vs formatInstant(max(0,v), SECOND)',
  sgmFmtTimestamp,
  (v) => formatInstant(Math.max(0, v), PRECISION.SECOND),
  POSITIVE_INPUTS_UNDER_1H,
);

// #9 collections/format.formatDuration -> formatLength(v, SECOND, {style:'clock'})
assertEquivalence(
  'collections/format.formatDuration (#9) vs formatLength(v, SECOND, {style:"clock"})',
  collFormatDuration,
  (v) => formatLength(v, PRECISION.SECOND, { style: 'clock' }),
);

// #10 collections/format.formatDurationHuman -> formatLength(v, SECOND, {style:'human'})
assertEquivalence(
  'collections/format.formatDurationHuman (#10) vs formatLength(v, SECOND, {style:"human"})',
  collFormatDurationHuman,
  (v) => formatLength(v, PRECISION.SECOND, { style: 'human' }),
);

// #7 clipConstants.formatDuration -> formatLength(v, TENTH) (default 'unit' style)
assertEquivalence(
  'clipConstants.formatDuration (#7) vs formatLength(v, TENTH)',
  ccFormatDuration,
  (v) => formatLength(v, PRECISION.TENTH),
);

// #8 clipConstants.formatTimeSimple -> formatInstant(v, SECOND)
assertEquivalence(
  'clipConstants.formatTimeSimple (#8) vs formatInstant(v, SECOND)',
  ccFormatTimeSimple,
  (v) => formatInstant(v, PRECISION.SECOND),
  POSITIVE_INPUTS_UNDER_1H,
);

// #16 useDownloads.formatDuration -- fully DELETED (dead code, no live
// consumer), not migrated to a canonical call -- no real function remains to
// assert equivalence against; the deletion itself is the fix (Stage C2).

describe('Stage C documented divergence: formatInstant gains an implicit hours case past 3600s (#8, #14-at-Stage-C2, #17)', () => {
  // None of clipConstants.formatTimeSimple (#8), the ORIGINAL Stage C2
  // formatInstant migration target for ClipLibraryModal (#14), or
  // ShareGameModal.fmtTimestamp (#17) ever had an hours branch -- formatInstant
  // ALWAYS shows hours past 3600s (opts.hours defaults to 'auto'). This is a
  // real, low-risk, arguably-correct side effect of the migration (never a
  // silent regression -- more information, not less) for any real call site
  // whose value can exceed 1h. Documented here explicitly rather than
  // silently dropped from the equivalence loops above.
  it('#8: old "60:00" vs formatInstant "1:00:00" at exactly 3600s', () => {
    expect(ccFormatTimeSimple(3600)).toBe('60:00');
    expect(formatInstant(3600, PRECISION.SECOND)).toBe('1:00:00');
  });

  it('#14 (Stage C2 target): old "60:00" vs formatInstant "1:00:00" at exactly 3600s', () => {
    expect(clmFormatDuration(3600)).toBe('60:00');
    expect(formatInstant(3600, PRECISION.SECOND)).toBe('1:00:00');
  });

  it('#17: old "60:00" vs formatInstant "1:00:00" at exactly 3600s', () => {
    expect(sgmFmtTimestamp(3600)).toBe('60:00');
    expect(formatInstant(3600, PRECISION.SECOND)).toBe('1:00:00');
  });
});
