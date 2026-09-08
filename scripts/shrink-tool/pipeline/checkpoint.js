/**
 * T8840 pipeline/checkpoint.js -- design §3. Split into a PURE reducer (this is what
 * gets unit-tested: jsdom has no OPFS, but the state machine is the part worth
 * testing) and a thin OPFS shell built on top of it.
 *
 * The crash-repair table (design §3.4) is not a separate code path: `verifyOutputs`
 * (OPFS shell) drives the SAME `reduceSegment` transitions from file-existence
 * checks (`running` -> 'cancel', `finalizing` -> 'finish'|'cancel', `done` ->
 * 'orphan'), so testing every §3.3 transition also covers the crash-repair table.
 */

const ROOT_DIR = 'shrink-tool';
const MANIFEST_NAME = 'manifest.json';
const MANIFEST_TMP_NAME = 'manifest.json.tmp';
const TMP_DIR = 'tmp';
const OUT_DIR = 'out';

function stemOf(name) {
  return name.replace(/\.[^.]+$/, '');
}

/** `<idx>-<stem>.shrunk.mp4` (design §3.1, matching `tmpPartName`'s own
 * idx-prefixed scheme) -- ONE derivation, shared by the `finalizing` transition
 * (M9: must be set as soon as finalizing starts, not only at `finish`) and
 * `promoteOutput` (which needs the same name to move the file to), so a crash
 * between the two can never disagree about what the file is called. The idx
 * prefix matters: two segments can share a stem (e.g. DJI filenames reused
 * across SD cards) and would otherwise silently collide in `out/`. */
export function outputNameFor(segment) {
  return `${segment.idx}-${stemOf(segment.name)}.shrunk.mp4`;
}

// ============================================================================
// Pure reducer
// ============================================================================

/** @param {{ jobId: string, crop: object, preset: string, segments: Array }} options */
export function newManifest({ jobId, crop, preset, segments }) {
  return {
    version: 1,
    jobId,
    createdAt: Date.now(),
    crop,
    preset,
    probe: null,
    segments: segments.map((s, idx) => ({
      idx,
      name: s.name,
      size: s.size,
      lastModified: s.lastModified,
      durationSec: s.durationSec ?? null,
      framesTotal: s.framesTotal ?? null,
      state: 'pending',
      outputName: null,
      outputBytes: null,
      framesDone: 0,
      savedToDisk: false,
      error: null,
    })),
  };
}

// design §3.3 state diagram, as a lookup table: currentState -> eventType -> nextState.
const TRANSITIONS = {
  pending: { start: 'running' },
  running: { finalizing: 'finalizing', cancel: 'pending', fail: 'failed' },
  finalizing: { finish: 'done', cancel: 'pending' },
  failed: { cancel: 'pending' }, // "Retry" dispatches the same 'cancel' reset event
  done: { save: 'done', orphan: 'pending' },
};

/**
 * @param {object} segment
 * @param {{ type: 'start'|'finalizing'|'finish'|'cancel'|'fail'|'save'|'orphan', [key: string]: any }} event
 */
export function reduceSegment(segment, event) {
  const nextState = TRANSITIONS[segment.state]?.[event.type];
  if (!nextState) {
    throw new Error(
      `checkpoint.reduceSegment: invalid event '${event.type}' for segment ${segment.idx} in state '${segment.state}'`,
    );
  }

  switch (event.type) {
    case 'start':
      return { ...segment, state: nextState, error: null };
    case 'finalizing':
      // M9: outputName must be set HERE, not only at 'finish' -- verifyOutputs'
      // finalizing crash-repair check gates on outputName existing to look the
      // promoted file up, so leaving it null made a crash between "bytes written"
      // and "manifest says done" always take the cancel/redo branch, silently
      // discarding a file that was actually promoted successfully.
      return {
        ...segment,
        state: nextState,
        framesDone: event.framesDone ?? segment.framesDone,
        outputBytes: event.outputBytes ?? segment.outputBytes,
        outputName: outputNameFor(segment),
      };
    case 'finish':
      return { ...segment, state: nextState, outputName: event.outputName ?? segment.outputName, savedToDisk: false, error: null };
    case 'cancel':
      // No mid-segment resume (design §3.3): a reset segment starts fully over.
      return { ...segment, state: nextState, framesDone: 0, error: null };
    case 'fail':
      return { ...segment, state: nextState, error: event.error ?? 'unknown error' };
    case 'save':
      return { ...segment, state: nextState, savedToDisk: true };
    case 'orphan':
      return { ...segment, state: nextState, outputName: null, outputBytes: null, framesDone: 0, error: null };
    /* c8 ignore next 2 */
    default:
      throw new Error(`checkpoint.reduceSegment: unhandled event '${event.type}'`);
  }
}

function segmentKey(seg) {
  return `${seg.name}|${seg.size}|${seg.lastModified}`;
}

/**
 * @param {object} manifest
 * @param {Array<{ name: string, size: number, lastModified: number }>} presentSegments
 * @returns {{ action: 'resume'|'mismatch'|'fresh', firstPendingIdx: number, repairs: Array }}
 */
export function planResume(manifest, presentSegments) {
  const presentKeys = new Set(presentSegments.map(segmentKey));
  const matches = manifest.segments.length === presentSegments.length
    && manifest.segments.every((seg) => presentKeys.has(segmentKey(seg)));

  if (!matches) {
    return { action: 'mismatch', firstPendingIdx: -1, repairs: [] };
  }

  const hasProgress = manifest.segments.some((seg) => seg.state !== 'pending');
  if (!hasProgress) {
    return { action: 'fresh', firstPendingIdx: 0, repairs: [] };
  }

  const firstPendingIdx = manifest.segments.findIndex((seg) => seg.state !== 'done');
  return {
    action: 'resume',
    firstPendingIdx: firstPendingIdx === -1 ? manifest.segments.length : firstPendingIdx,
    repairs: [],
  };
}

// ============================================================================
// OPFS shell (not unit-testable -- jsdom has no OPFS; proven by qa/t8840-smoke.mjs)
// ============================================================================

/** `tmp/<idx>-<stem>.part` -- exported so tool.js can hand the worker the exact
 * filename its own OPFS shell (verifyOutputs/promoteOutput) will look for. */
export function tmpPartName(segment) {
  return `${segment.idx}-${stemOf(segment.name)}.part`;
}

async function fileExists(dirHandle, name) {
  try {
    await dirHandle.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

async function fileSize(dirHandle, name) {
  try {
    const handle = await dirHandle.getFileHandle(name);
    const file = await handle.getFile();
    return file.size;
  } catch {
    return null;
  }
}

/** @returns {Promise<{ root: FileSystemDirectoryHandle, outDir: FileSystemDirectoryHandle, tmpDir: FileSystemDirectoryHandle }>} */
export async function openWorkspace() {
  const opfsRoot = await navigator.storage.getDirectory();
  const root = await opfsRoot.getDirectoryHandle(ROOT_DIR, { create: true });
  const tmpDir = await root.getDirectoryHandle(TMP_DIR, { create: true });
  const outDir = await root.getDirectoryHandle(OUT_DIR, { create: true });
  return { root, outDir, tmpDir };
}

export async function readManifest(root) {
  try {
    const handle = await root.getFileHandle(MANIFEST_NAME);
    const file = await handle.getFile();
    return JSON.parse(await file.text());
  } catch {
    return null;
  }
}

/** Atomic: write .tmp then move(), so a crash never truncates the live manifest. */
export async function writeManifest(root, manifest) {
  const tmpHandle = await root.getFileHandle(MANIFEST_TMP_NAME, { create: true });
  const writable = await tmpHandle.createWritable();
  await writable.write(JSON.stringify(manifest));
  await writable.close();
  await tmpHandle.move(MANIFEST_NAME);
}

/**
 * On-load repair pass (design §3.4 step 1). Every crash point maps to exactly one
 * repair, driven through the SAME `reduceSegment` transitions used for live events.
 */
export async function verifyOutputs(root, manifest) {
  const outDir = await root.getDirectoryHandle(OUT_DIR, { create: true });
  const tmpDir = await root.getDirectoryHandle(TMP_DIR, { create: true });

  const segments = [];
  for (const original of manifest.segments) {
    let segment = original;
    if (segment.state === 'running') {
      // Partial output is never resumable -- no mid-segment resume (design §3.3).
      await tmpDir.removeEntry(tmpPartName(segment)).catch(() => {});
      segment = reduceSegment(segment, { type: 'cancel' });
    } else if (segment.state === 'finalizing') {
      const promoted = segment.outputName && (await fileExists(outDir, segment.outputName));
      segment = promoted
        ? reduceSegment(segment, { type: 'finish', outputName: segment.outputName })
        : reduceSegment(segment, { type: 'cancel' });
    } else if (segment.state === 'done') {
      const size = segment.outputName ? await fileSize(outDir, segment.outputName) : null;
      if (size == null || size !== segment.outputBytes) {
        segment = reduceSegment(segment, { type: 'orphan' });
      }
    }
    segments.push(segment);
  }
  const repaired = { ...manifest, segments };

  // Orphaned output FILES: present in out/ but no matching done segment.
  const keepNames = new Set(segments.filter((s) => s.state === 'done').map((s) => s.outputName));
  for await (const [name] of outDir.entries()) {
    if (!keepNames.has(name)) {
      await outDir.removeEntry(name).catch(() => {});
    }
  }

  await writeManifest(root, repaired);
  return repaired;
}

/** tmp/<idx>-<stem>.part -> out/<idx>-<stem>.shrunk.mp4 */
export async function promoteOutput(root, segment) {
  const tmpDir = await root.getDirectoryHandle(TMP_DIR, { create: true });
  const outDir = await root.getDirectoryHandle(OUT_DIR, { create: true });
  const outputName = segment.outputName ?? outputNameFor(segment);
  const tmpHandle = await tmpDir.getFileHandle(tmpPartName(segment));
  await tmpHandle.move(outDir, outputName);
  return outputName;
}

export async function discardWorkspace(root) {
  if (typeof root.remove === 'function') {
    await root.remove({ recursive: true });
    return;
  }
  const opfsRoot = await navigator.storage.getDirectory();
  await opfsRoot.removeEntry(ROOT_DIR, { recursive: true });
}
