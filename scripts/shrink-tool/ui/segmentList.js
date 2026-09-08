/**
 * T8840 ui/segmentList.js -- segment ordering, `.LRF` proxy previews, and the
 * filmstrip DOM (design §5). Deliberately DOM-only: pulling a preview frame is a
 * `<video>` plus `drawImage`, kept out of `pipeline/` on purpose (T8845 does not
 * want this module, T8850 rebuilds it in React anyway).
 *
 * Reuses `pipeline/demux.js`'s `openReader`/`probeContainer` for ordering (moov-only
 * parse, 16-124 ms even on a 17 GB file per T8836) rather than re-implementing a
 * second mp4 parse -- pipeline/ modules are DOM-free, not main-thread-forbidden.
 */

import { openReader, probeContainer } from '../pipeline/demux.js';
import { formatBytes } from './format.js';

const PREVIEW_SEEK_SEC = 2; // past any black lead-in
const PREVIEW_TIMEOUT_MS = 10_000;

/**
 * Orders segment files by embedded recording time (mvhd creation_time via
 * probeContainer), falling back to `lastModified` when a file's moov can't be
 * read or carries no creation time -- a segment ordering failure must never
 * block the whole tool. Also carries the moov info tool.js needs for the
 * estimate/crop/capability steps, so those don't re-probe the same file.
 * @param {File[]} files
 * @returns {Promise<Array<{ file, name, size, lastModified, createdAt, durationSec,
 *   faststartInfo, video: object|null, probeError: string|null }>>}
 */
export async function orderSegments(files) {
  const withMeta = await Promise.all(files.map(async (file) => {
    let createdAt = null;
    let durationSec = null;
    let video = null;
    let faststartInfo = null;
    let probeError = null;
    try {
      const reader = await openReader(file);
      faststartInfo = reader.info;
      const tracks = await probeContainer(reader);
      createdAt = tracks.createdAt ? tracks.createdAt.getTime() : null;
      durationSec = tracks.durationSec;
      video = tracks.video;
    } catch (err) {
      probeError = err.message;
    }
    return { file, name: file.name, size: file.size, lastModified: file.lastModified, createdAt, durationSec, faststartInfo, video, probeError };
  }));
  withMeta.sort((a, b) => (a.createdAt ?? a.lastModified) - (b.createdAt ?? b.lastModified));
  return withMeta;
}

/** Finds the same-stem `.LRF` proxy for a segment, if present (design §5, R10). */
export function findProxyFile(segmentName, allFiles) {
  const stem = segmentName.replace(/\.[^.]+$/, '').toLowerCase();
  return allFiles.find((f) => /\.lrf$/i.test(f.name) && f.name.replace(/\.[^.]+$/, '').toLowerCase() === stem) ?? null;
}

/**
 * Rung 1/2 of design §5's fallback chain: draw a frame ~2 s in from the `.LRF`
 * proxy (or the original file, rung 2) via a `<video>` element.
 * @param {File} file
 * @returns {Promise<HTMLCanvasElement|null>} null on error/timeout -- rung 3 (placeholder tile) is the caller's job
 */
export function previewFrame(file) {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'metadata';
    video.playsInline = true;
    const url = URL.createObjectURL(file);
    let settled = false;
    let timer = null;

    const cleanup = () => {
      URL.revokeObjectURL(url);
      if (timer) clearTimeout(timer);
    };
    const fail = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(null);
    };
    timer = setTimeout(fail, PREVIEW_TIMEOUT_MS);

    video.addEventListener('loadedmetadata', () => {
      const half = Number.isFinite(video.duration) ? video.duration / 2 : 0;
      video.currentTime = Math.min(PREVIEW_SEEK_SEC, half);
    });
    video.addEventListener('seeked', () => {
      if (settled) return;
      settled = true;
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 320;
      canvas.height = video.videoHeight || 180;
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      cleanup();
      resolve(canvas);
    });
    video.addEventListener('error', fail);
    video.src = url;
  });
}

const MOTION_SAMPLE_WIDTH = 160;
const MOTION_SAMPLE_HEIGHT = 90;
const MOTION_SAMPLE_TIMEOUT_MS = 30_000;

/**
 * Samples `count` frames spread across the middle 80% of `file` (avoiding any black
 * lead-in/out at the very ends) at a small, fixed resolution, for pipeline/autoCrop.js's
 * variance analysis. Downscaling to MOTION_SAMPLE_WIDTH/HEIGHT keeps each seek+draw+
 * readback cheap regardless of the source's real resolution -- the crop suggestion only
 * needs coarse regions, not per-pixel accuracy.
 * @param {File} file
 * @param {number} [count]
 * @returns {Promise<{ frames: Array<Uint8ClampedArray>, width: number, height: number }>}
 *   `frames` may have fewer than `count` entries (or be empty) if the file errors or
 *   times out partway through -- the caller (autoCrop) already treats <2 frames as
 *   "nothing to suggest" rather than throwing.
 */
export function sampleMotionFrames(file, count = 8) {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'metadata';
    video.playsInline = true;
    const url = URL.createObjectURL(file);
    const canvas = document.createElement('canvas');
    canvas.width = MOTION_SAMPLE_WIDTH;
    canvas.height = MOTION_SAMPLE_HEIGHT;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const frames = [];
    let idx = 0;
    let settled = false;
    let timer = null;

    const cleanup = () => { URL.revokeObjectURL(url); if (timer) clearTimeout(timer); };
    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ frames, width: MOTION_SAMPLE_WIDTH, height: MOTION_SAMPLE_HEIGHT });
    };
    timer = setTimeout(finish, MOTION_SAMPLE_TIMEOUT_MS);

    function seekNext() {
      if (idx >= count) { finish(); return; }
      // Middle 80%: skip the first/last 10% so lead-in/out black frames or a
      // pre-kickoff static shot don't dominate the sample set.
      const t = video.duration * (0.1 + (0.8 * idx) / Math.max(1, count - 1));
      video.currentTime = Math.min(video.duration - 0.05, Math.max(0, t));
    }
    video.addEventListener('loadedmetadata', () => {
      if (!Number.isFinite(video.duration) || video.duration <= 0) { finish(); return; }
      seekNext();
    });
    video.addEventListener('seeked', () => {
      if (settled) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      frames.push(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
      idx++;
      seekNext();
    });
    video.addEventListener('error', finish);
    video.src = url;
  });
}

const STATE_LABEL = {
  pending: 'Pending', running: 'Shrinking…', finalizing: 'Finishing…', done: 'Done', failed: 'Failed',
};

/**
 * @param {HTMLElement} container
 * @param {{ onSelect?: (index:number) => void }} [options]
 * @returns {{ setSegments: Function, setThumb: Function, setSelected: Function, setStatus: Function }}
 */
export function createSegmentListView(container, { onSelect = () => {} } = {}) {
  container.innerHTML = '';
  container.classList.add('segment-list');
  const tiles = [];

  function setSegments(segments) {
    container.innerHTML = '';
    tiles.length = 0;
    segments.forEach((seg, idx) => {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'segment-tile';
      tile.innerHTML = `
        <div class="segment-thumb-wrap">
          <canvas class="segment-thumb"></canvas>
          <div class="segment-progress"></div>
        </div>
        <div class="segment-label">${seg.name}</div>
        <div class="segment-meta">${formatBytes(seg.size)} · <span class="segment-state">Pending</span></div>
      `;
      tile.addEventListener('click', () => onSelect(idx));
      container.appendChild(tile);
      tiles.push(tile);
    });
  }

  function setThumb(index, sourceCanvas) {
    const tile = tiles[index];
    if (!tile) return;
    const target = tile.querySelector('.segment-thumb');
    if (!sourceCanvas) {
      target.replaceWith(Object.assign(document.createElement('div'), {
        className: 'segment-thumb segment-thumb-placeholder',
        textContent: 'No preview',
      }));
      return;
    }
    target.width = sourceCanvas.width;
    target.height = sourceCanvas.height;
    target.getContext('2d').drawImage(sourceCanvas, 0, 0);
  }

  function setSelected(index) {
    tiles.forEach((tile, i) => tile.classList.toggle('segment-selected', i === index));
  }

  /** @param {{ state: string, framesDone?: number, framesTotal?: number }} status */
  function setStatus(index, status) {
    const tile = tiles[index];
    if (!tile) return;
    tile.querySelector('.segment-state').textContent = STATE_LABEL[status.state] ?? status.state;
    const bar = tile.querySelector('.segment-progress');
    const pct = status.framesTotal ? Math.round((100 * (status.framesDone ?? 0)) / status.framesTotal) : 0;
    bar.style.width = status.state === 'running' || status.state === 'finalizing' ? `${pct}%` : status.state === 'done' ? '100%' : '0%';
    tile.classList.toggle('segment-done', status.state === 'done');
    tile.classList.toggle('segment-failed', status.state === 'failed');
  }

  return { setSegments, setThumb, setSelected, setStatus };
}
