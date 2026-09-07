/**
 * T8840 tool.js -- the only orchestration file on the main thread (design §2.4).
 * DOM-only: everything reusable lives under `pipeline/` and is imported by
 * `worker.js` instead. This file's job is folder picking, the crop/preset UI,
 * driving `worker.js` over postMessage, and owning the OPFS manifest (single
 * writer -- design §3.6).
 */

import {
  PRESETS, REFERENCE_ENCODE_PIXELS_PER_SEC,
  resolveOutputSize, estimateOutputBytes, estimateShrinkSeconds, shouldOfferShrink,
} from './pipeline/presets.js';
import { resolveCropRect } from './pipeline/cropScale.js';
import { checkCapability } from './pipeline/probe.js';
import {
  openWorkspace, readManifest, writeManifest, verifyOutputs, promoteOutput, discardWorkspace,
  newManifest, reduceSegment, planResume, tmpPartName,
} from './pipeline/checkpoint.js';
import { createCropRectController } from './ui/cropRect.js';
import { createSegmentListView, orderSegments, findProxyFile, previewFrame } from './ui/segmentList.js';
import { formatBytes, formatDuration, formatMultiplier } from './ui/format.js';

const STORAGE_HEADROOM = 1.2; // 20% headroom over the estimate (design §3.4)
const CANCEL_TIMEOUT_MS = 2000;

// ---------------------------------------------------------------------------
// IndexedDB: persists the FileSystemDirectoryHandle across a reload (design Q2).
// ---------------------------------------------------------------------------
const IDB_NAME = 'shrink-tool';
const IDB_STORE = 'handles';

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function saveDirHandle(handle) {
  const db = await idbOpen();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(handle, 'sourceDir');
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
async function loadDirHandle() {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get('sourceDir');
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function hashJobId(segments) {
  const key = segments.map((s) => `${s.name}|${s.size}|${s.lastModified}`).sort().join('\n');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return [...new Uint8Array(digest)].slice(0, 4).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const el = {
  workspaceBanner: document.getElementById('workspace-banner'),
  pickFolderBtn: document.getElementById('pick-folder-btn'),
  fallbackInput: document.getElementById('fallback-input'),
  pickerNote: document.getElementById('picker-note'),
  segmentsSection: document.getElementById('segments-section'),
  segmentList: document.getElementById('segment-list'),
  cropSection: document.getElementById('crop-section'),
  cropCanvas: document.getElementById('crop-canvas'),
  cropReadout: document.getElementById('crop-readout'),
  resetCropBtn: document.getElementById('reset-crop-btn'),
  presetSection: document.getElementById('preset-section'),
  presetChips: document.getElementById('preset-chips'),
  runSection: document.getElementById('run-section'),
  startBtn: document.getElementById('start-btn'),
  cancelBtn: document.getElementById('cancel-btn'),
  saveAllBtn: document.getElementById('save-all-btn'),
  verdictBanner: document.getElementById('verdict-banner'),
  progressLog: document.getElementById('progress-log'),
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const state = {
  workspace: null, // { root, outDir, tmpDir }
  manifest: null,
  segments: [], // ordered [{file,name,size,lastModified,durationSec,video,faststartInfo}]
  allFiles: [], // every File in the picked folder, for .LRF lookup
  selectedIndex: 0,
  crop: { x: 0, y: 0, w: 1, h: 1 },
  presetId: 'sharpest', // EPIC decision 5 (amended 2026-09-07): Sharpest is the default
  probeResult: null,
  worker: null,
  cancelTimer: null,
  running: false,
  currentIdx: null, // index into manifest.segments currently in flight
  onSegmentSettled: null, // resolves runQueue's per-segment await ('done'|'error'|'cancelled')
};

let segmentView = null;
let cropController = null;

function log(line) {
  el.progressLog.textContent += `${line}\n`;
  el.progressLog.scrollTop = el.progressLog.scrollHeight;
}

function banner(container, kind, html) {
  container.innerHTML = `<div class="banner ${kind}">${html}</div>`;
}

// ---------------------------------------------------------------------------
// Init: repair whatever OPFS workspace already exists (design §3.4)
// ---------------------------------------------------------------------------
async function init() {
  state.workspace = await openWorkspace();
  let manifest = await readManifest(state.workspace.root);
  if (manifest) {
    manifest = await verifyOutputs(state.workspace.root, manifest);
    state.manifest = manifest;
    renderWorkspaceBanner(manifest);
  }
  renderPresetChips();
  wireStaticHandlers();
}

function renderWorkspaceBanner(manifest) {
  const done = manifest.segments.filter((s) => s.state === 'done').length;
  const bytes = manifest.segments.reduce((sum, s) => sum + (s.outputBytes ?? 0), 0);
  el.workspaceBanner.classList.add('visible');
  el.workspaceBanner.innerHTML = `
    <div class="banner info">
      Workspace found: ${done}/${manifest.segments.length} segments done, ${formatBytes(bytes)} on disk.
      <div class="row" style="margin-top:8px">
        <button id="resume-btn" class="primary" type="button">Resume</button>
        <button id="save-finished-btn" type="button">Save finished now</button>
        <button id="discard-btn" type="button">Discard workspace</button>
      </div>
    </div>`;
  document.getElementById('resume-btn').addEventListener('click', onResumeClick);
  document.getElementById('save-finished-btn').addEventListener('click', () => saveAllFinished(manifest));
  document.getElementById('discard-btn').addEventListener('click', async () => {
    await discardWorkspace(state.workspace.root);
    state.manifest = null;
    el.workspaceBanner.classList.remove('visible');
    el.workspaceBanner.innerHTML = '';
  });
}

async function onResumeClick() {
  const dirHandle = await loadDirHandle();
  if (!dirHandle) {
    banner(el.workspaceBanner, 'warn', 'No saved folder handle in this browser -- pick the same folder again to resume.');
    await pickFolder();
    return;
  }
  const perm = await dirHandle.requestPermission({ mode: 'read' });
  if (perm !== 'granted') {
    banner(el.workspaceBanner, 'danger', 'Folder permission was not granted.');
    return;
  }
  const present = [];
  for await (const entry of dirHandle.values()) {
    if (entry.kind === 'file') present.push(await entry.getFile());
  }
  const plan = planResume(state.manifest, present.map((f) => ({ name: f.name, size: f.size, lastModified: f.lastModified })));
  if (plan.action === 'mismatch') {
    banner(el.workspaceBanner, 'danger', 'This folder does not match the saved workspace. <button id="start-over-btn" type="button">Start over</button>');
    document.getElementById('start-over-btn').addEventListener('click', async () => {
      await discardWorkspace(state.workspace.root);
      location.reload();
    });
    return;
  }
  await loadSegmentsFromFiles(present);
  state.crop = { ...state.manifest.crop };
  state.presetId = state.manifest.preset;
  cropController.setCrop(state.crop);
  renderPresetChips();
  renderCropReadout();
  el.startBtn.disabled = true;
  el.cancelBtn.disabled = false;
  await runQueue(plan.firstPendingIdx);
}

async function saveAllFinished(manifest) {
  for (let i = 0; i < manifest.segments.length; i += 1) {
    if (manifest.segments[i].state !== 'done') continue;
    const saved = await saveSegmentToDisk(manifest.segments[i]);
    if (saved) {
      manifest.segments[i] = reduceSegment(manifest.segments[i], { type: 'save' });
      await writeManifest(state.workspace.root, manifest);
    }
  }
}

// ---------------------------------------------------------------------------
// Folder picking
// ---------------------------------------------------------------------------
function wireStaticHandlers() {
  el.pickFolderBtn.addEventListener('click', pickFolder);
  el.fallbackInput.addEventListener('change', async () => {
    const files = [...el.fallbackInput.files];
    await loadSegmentsFromFiles(files);
  });
  el.resetCropBtn.addEventListener('click', () => cropController.reset());
  el.startBtn.addEventListener('click', onStartClick);
  el.cancelBtn.addEventListener('click', onCancelClick);
  el.saveAllBtn.addEventListener('click', () => saveAllFinished(state.manifest));
}

async function pickFolder() {
  if (typeof window.showDirectoryPicker === 'function') {
    try {
      const dirHandle = await window.showDirectoryPicker();
      await saveDirHandle(dirHandle);
      const files = [];
      for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file') files.push(await entry.getFile());
      }
      await loadSegmentsFromFiles(files);
      return;
    } catch (err) {
      if (err?.name === 'AbortError') return; // user cancelled the picker
      el.pickerNote.textContent = `showDirectoryPicker failed (${err.message}); falling back.`;
    }
  }
  el.pickerNote.textContent = 'Using the folder input fallback -- resume after reload will need a re-pick.';
  el.fallbackInput.click();
}

async function loadSegmentsFromFiles(files) {
  const videoFiles = files.filter((f) => /\.mp4$/i.test(f.name));
  if (!videoFiles.length) {
    el.pickerNote.textContent = 'No .MP4 files found in that folder.';
    return;
  }

  // design §3.1: a job whose segment set doesn't match the saved manifest must
  // prompt before wiping it, never wipe silently.
  if (state.manifest && !state.running) {
    const present = videoFiles.map((f) => ({ name: f.name, size: f.size, lastModified: f.lastModified }));
    if (planResume(state.manifest, present).action === 'mismatch') {
      const done = state.manifest.segments.filter((s) => s.state === 'done').length;
      const bytes = state.manifest.segments.reduce((sum, s) => sum + (s.outputBytes ?? 0), 0);
      const proceed = window.confirm(`Discard the saved workspace? (${done} finished files, ${formatBytes(bytes)})`);
      if (!proceed) {
        el.pickerNote.textContent = 'Keeping the saved workspace -- click Resume above, or pick the matching folder.';
        return;
      }
      await discardWorkspace(state.workspace.root);
      state.manifest = null;
      el.workspaceBanner.classList.remove('visible');
      el.workspaceBanner.innerHTML = '';
    }
  }

  state.allFiles = files;
  el.pickerNote.textContent = `${videoFiles.length} segment(s) found, probing...`;
  state.segments = await orderSegments(videoFiles);
  el.pickerNote.textContent = `${state.segments.length} segment(s), ordered by recording time.`;

  el.segmentsSection.style.display = '';
  el.cropSection.style.display = '';
  el.presetSection.style.display = '';
  el.runSection.style.display = '';

  segmentView = createSegmentListView(el.segmentList, { onSelect: selectSegment });
  segmentView.setSegments(state.segments);

  for (const [idx, seg] of state.segments.entries()) {
    const proxy = findProxyFile(seg.name, state.allFiles) ?? seg.file;
    previewFrame(proxy).then((canvas) => {
      segmentView.setThumb(idx, canvas);
      seg.previewCanvas = canvas;
    });
  }

  cropController = createCropRectController(el.cropCanvas, { onChange: onCropChange });
  selectSegment(0);
  renderPresetChips();
  checkOfferShrink();
  await checkDeviceCapability();
}

/** Coarse "can WebCodecs do this codec at all" gate (task file: "the ONLY gate T8850
 * consults"); never throws (falls back to 'unavailable' -- e.g. Firefox). The real
 * speed gate is the runtime probe at Start, not this. */
async function checkDeviceCapability() {
  const seg0 = state.segments[0];
  if (!seg0) return;
  const capability = await checkCapability(seg0.file, seg0.faststartInfo);
  if (capability.decode !== 'yes' || capability.encode !== 'yes') {
    el.startBtn.disabled = true;
    banner(el.verdictBanner, 'danger',
      `This browser can't decode/encode this video (decode: ${capability.decode}, encode: ${capability.encode}). Upload the originals instead.`);
  }
}

function selectSegment(idx) {
  state.selectedIndex = idx;
  segmentView.setSelected(idx);
  const seg = state.segments[idx];
  if (!seg?.video) return;
  const draw = () => cropController.setFrame(seg.previewCanvas ?? el.cropCanvas, seg.video.codedWidth, seg.video.codedHeight);
  if (seg.previewCanvas) draw();
  else previewFrame(findProxyFile(seg.name, state.allFiles) ?? seg.file).then((canvas) => {
    seg.previewCanvas = canvas;
    segmentView.setThumb(idx, canvas);
    draw();
  });
  cropController.setCrop(state.crop);
  renderCropReadout();
}

function onCropChange(crop) {
  state.crop = crop;
  renderCropReadout();
  invalidateProbe();
}

function renderCropReadout() {
  const seg = state.segments[state.selectedIndex];
  if (!seg?.video) return;
  const src = resolveCropRect(state.crop, seg.video.codedWidth, seg.video.codedHeight);
  const out = resolveOutputSize(PRESETS[state.presetId], src.sw, src.sh);
  el.cropReadout.textContent = `Output: ${out.width} x ${out.height}`;
}

function checkOfferShrink() {
  const totalBytes = state.segments.reduce((sum, s) => sum + s.size, 0);
  const totalDuration = state.segments.reduce((sum, s) => sum + (s.durationSec ?? 0), 0);
  const sourceBitrateBps = totalDuration > 0 ? (totalBytes * 8) / totalDuration : 0;
  if (!shouldOfferShrink({ totalBytes, sourceBitrateBps })) {
    banner(el.verdictBanner, 'warn',
      `These files are already ${(sourceBitrateBps / 1e6).toFixed(1)} Mbps, lower than every preset. Shrinking them will not make them meaningfully smaller.`);
  }
}

// ---------------------------------------------------------------------------
// Presets + estimate
// ---------------------------------------------------------------------------
function renderPresetChips() {
  el.presetChips.innerHTML = '';
  for (const preset of Object.values(PRESETS)) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `preset-chip${preset.id === state.presetId ? ' selected' : ''}`;
    chip.innerHTML = `<span class="preset-name">${preset.label}</span><span class="preset-estimate">${estimateLine(preset)}</span>`;
    chip.addEventListener('click', () => {
      state.presetId = preset.id;
      renderPresetChips();
      renderCropReadout();
      invalidateProbe();
    });
    el.presetChips.appendChild(chip);
  }
}

function estimateLine(preset) {
  if (!state.segments.length) return '';
  const totalDuration = state.segments.reduce((sum, s) => sum + (s.durationSec ?? 0), 0);
  const bytes = estimateOutputBytes(preset, totalDuration);
  const pixelsPerSecond = state.probeResult?.pixelsPerSecond ?? REFERENCE_ENCODE_PIXELS_PER_SEC;
  const seg0 = state.segments[0];
  const out = seg0?.video ? resolveOutputSize(preset, seg0.video.codedWidth, seg0.video.codedHeight) : { width: 0, height: 0 };
  const fps = seg0?.video?.fps ?? 30;
  const seconds = estimateShrinkSeconds({ outWidth: out.width, outHeight: out.height, durationSec: totalDuration, fps, pixelsPerSecond });
  const label = state.probeResult ? '' : ' (reference machine)';
  return `${formatBytes(bytes)}, about ${formatDuration(seconds)}${label}`;
}

function invalidateProbe() {
  state.probeResult = null; // design §4.1: changing preset/crop invalidates the probe
  renderPresetChips();
}

// ---------------------------------------------------------------------------
// Worker lifecycle
// ---------------------------------------------------------------------------
function spawnWorker() {
  const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.addEventListener('message', onWorkerMessage);
  state.worker = worker;
  return worker;
}

function onWorkerMessage(event) {
  const msg = event.data;
  if (msg.type === 'probe') onProbeResult(msg);
  else if (msg.type === 'progress') onProgress(msg);
  else if (msg.type === 'done') onSegmentDone(msg);
  else if (msg.type === 'error') onSegmentError(msg);
  else if (msg.type === 'cancelled') onCancelled();
}

// ---------------------------------------------------------------------------
// Start / probe / verdict
// ---------------------------------------------------------------------------
async function onStartClick() {
  if (!state.segments.length) return;
  const preset = PRESETS[state.presetId];
  const totalDuration = state.segments.reduce((sum, s) => sum + (s.durationSec ?? 0), 0);
  const estimatedBytes = estimateOutputBytes(preset, totalDuration);

  if (navigator.storage?.estimate) {
    const { quota, usage } = await navigator.storage.estimate();
    const free = (quota ?? 0) - (usage ?? 0);
    if (free < estimatedBytes * STORAGE_HEADROOM) {
      banner(el.verdictBanner, 'danger',
        `This needs about ${formatBytes(estimatedBytes * STORAGE_HEADROOM)} free; you have ${formatBytes(free)}.`);
      return;
    }
  }
  await navigator.storage?.persist?.();

  if (!state.manifest) {
    const jobId = await hashJobId(state.segments);
    state.manifest = newManifest({
      jobId,
      crop: state.crop,
      preset: state.presetId,
      segments: state.segments.map((s) => ({
        name: s.name, size: s.size, lastModified: s.lastModified,
        durationSec: s.durationSec, framesTotal: s.video?.nbSamples ?? null,
      })),
    });
    await writeManifest(state.workspace.root, state.manifest);
  }

  el.startBtn.disabled = true;
  banner(el.verdictBanner, 'info', 'Running the speed probe...');
  spawnWorker();
  state.worker.postMessage({ cmd: 'probe', file: state.segments[0].file, crop: state.crop, preset });
}

function onProbeResult(msg) {
  state.probeResult = msg;
  renderPresetChips();
  const { verdict, realtimeMultiplier } = msg;
  const totalDuration = state.segments.reduce((sum, s) => sum + (s.durationSec ?? 0), 0);
  const preset = PRESETS[state.presetId];
  const seg0 = state.segments[0];
  const out = resolveOutputSize(preset, seg0.video.codedWidth, seg0.video.codedHeight);
  const seconds = estimateShrinkSeconds({ outWidth: out.width, outHeight: out.height, durationSec: totalDuration, fps: seg0.video.fps, pixelsPerSecond: msg.pixelsPerSecond });

  if (verdict === 'too-slow') {
    banner(el.verdictBanner, 'danger', `This computer is too slow for this (${formatMultiplier(realtimeMultiplier)} realtime). Upload the originals instead.`);
    el.startBtn.disabled = false;
    return;
  }
  if (verdict === 'slow') {
    banner(el.verdictBanner, 'warn',
      `This will take about ${formatDuration(seconds)} (${formatMultiplier(realtimeMultiplier)} realtime) and your computer will be busy the whole time. Uploading the originals may be easier.
       <button id="confirm-slow-btn" class="primary" type="button" style="margin-left:8px">Start anyway</button>`);
    document.getElementById('confirm-slow-btn').addEventListener('click', () => beginRun());
    el.startBtn.disabled = false;
    return;
  }
  banner(el.verdictBanner, 'go', `About ${formatDuration(seconds)}. Your computer will be busy the whole time.`);
  beginRun();
}

async function beginRun() {
  if (state.probeResult) {
    state.manifest.probe = {
      realtimeMultiplier: state.probeResult.realtimeMultiplier,
      pixelsPerSecond: state.probeResult.pixelsPerSecond,
      at: Date.now(),
    };
    await writeManifest(state.workspace.root, state.manifest);
  }
  el.startBtn.disabled = true;
  el.cancelBtn.disabled = false;
  await runQueue(0);
}

// ---------------------------------------------------------------------------
// The per-segment run queue
// ---------------------------------------------------------------------------
async function runQueue(firstPendingIdx) {
  state.running = true;
  for (let i = firstPendingIdx; i < state.manifest.segments.length; i += 1) {
    if (!state.running) break; // Cancel stops the queue, doesn't advance past it
    const seg = state.manifest.segments[i];
    if (seg.state === 'done') continue;
    state.currentIdx = i;
    state.manifest.segments[i] = reduceSegment(seg, { type: 'start' });
    await writeManifest(state.workspace.root, state.manifest);
    segmentView?.setStatus(i, { state: 'running' });
    log(`Segment ${i + 1}/${state.manifest.segments.length}: ${seg.name}`);

    if (!state.worker) spawnWorker();
    const outName = tmpPartName(state.manifest.segments[i]);
    const fileEntry = state.segments.find((s) => s.name === seg.name) ?? { file: null };
    const completed = await new Promise((resolve) => {
      state.onSegmentSettled = resolve;
      state.worker.postMessage({
        cmd: 'start',
        file: fileEntry.file,
        crop: state.crop,
        preset: PRESETS[state.manifest.preset],
        dirHandle: state.workspace.tmpDir,
        outName,
      });
    });
    if (completed !== 'done') break; // cancelled or failed -- stop the queue, don't auto-advance
  }
  state.running = false;
  if (state.manifest.segments.every((s) => s.state === 'done')) {
    el.saveAllBtn.disabled = false;
    banner(el.verdictBanner, 'go', 'All segments shrunk. Save them to disk and check playback.');
  }
  el.cancelBtn.disabled = true;
}

function onProgress({ framesDone, framesTotal, fps }) {
  const i = state.currentIdx;
  segmentView?.setStatus(i, { state: 'running', framesDone, framesTotal });
  log(`  frame ${framesDone}/${framesTotal ?? '?'} (${fps ? fps.toFixed(1) : '?'} fps)`);
}

async function onSegmentDone(msg) {
  const i = state.currentIdx;
  let seg = state.manifest.segments[i];
  seg = reduceSegment(seg, { type: 'finalizing', framesDone: msg.framesDone, outputBytes: msg.bytes });
  state.manifest.segments[i] = seg;
  await writeManifest(state.workspace.root, state.manifest);

  const outputName = await promoteOutput(state.workspace.root, seg);
  state.manifest.segments[i] = reduceSegment(seg, { type: 'finish', outputName });
  await writeManifest(state.workspace.root, state.manifest);
  segmentView?.setStatus(i, { state: 'done' });
  log(`  done: ${formatBytes(msg.bytes)}, ${msg.wallSeconds.toFixed(1)}s, mp4box buffers max ${msg.mp4boxBuffers}`);
  state.onSegmentSettled?.('done');
}

async function onSegmentError(msg) {
  const i = state.currentIdx;
  state.manifest.segments[i] = reduceSegment(state.manifest.segments[i], { type: 'fail', error: `${msg.stage}: ${msg.message}` });
  await writeManifest(state.workspace.root, state.manifest);
  segmentView?.setStatus(i, { state: 'failed' });
  log(`  ERROR [${msg.stage}]: ${msg.message}`);
  banner(el.verdictBanner, 'danger', `Segment ${i + 1} failed at stage "${msg.stage}": ${msg.message}. Fix the issue and click Start again to retry.`);
  state.onSegmentSettled?.('error');
}

// ---------------------------------------------------------------------------
// Cancel (design §3.5): graceful first, terminate() as a 2s backstop
// ---------------------------------------------------------------------------
function onCancelClick() {
  if (!state.worker) return;
  el.cancelBtn.disabled = true;
  state.worker.postMessage({ cmd: 'cancel' });
  state.cancelTimer = setTimeout(async () => {
    state.worker.terminate();
    state.worker = null;
    await finishCancel();
  }, CANCEL_TIMEOUT_MS);
}

async function onCancelled() {
  if (state.cancelTimer) {
    clearTimeout(state.cancelTimer);
    state.cancelTimer = null;
  }
  await finishCancel();
}

async function finishCancel() {
  const i = state.currentIdx;
  if (i != null && state.manifest?.segments[i]?.state === 'running') {
    await state.workspace.tmpDir.removeEntry(tmpPartName(state.manifest.segments[i])).catch(() => {});
    state.manifest.segments[i] = reduceSegment(state.manifest.segments[i], { type: 'cancel' });
    await writeManifest(state.workspace.root, state.manifest);
    segmentView?.setStatus(i, { state: 'pending' });
  }
  state.running = false;
  el.startBtn.disabled = false;
  el.cancelBtn.disabled = true;
  log('Cancelled.');
  state.onSegmentSettled?.('cancelled');
}

// ---------------------------------------------------------------------------
// Save to disk (showSaveFilePicker, download-link fallback)
// ---------------------------------------------------------------------------
/** @returns {Promise<boolean>} whether the save completed (vs. user-cancelled the picker) */
async function saveSegmentToDisk(seg) {
  const handle = await state.workspace.outDir.getFileHandle(seg.outputName);
  const file = await handle.getFile();
  if (typeof window.showSaveFilePicker === 'function') {
    try {
      const dest = await window.showSaveFilePicker({ suggestedName: seg.outputName });
      const writable = await dest.createWritable();
      await file.stream().pipeTo(writable);
      return true;
    } catch (err) {
      if (err?.name === 'AbortError') return false;
      log(`Save picker failed (${err.message}), falling back to a download link.`);
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = seg.outputName;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}

init();
