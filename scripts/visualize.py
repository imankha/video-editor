#!/usr/bin/env python3
"""
Visualize — browser-based diagram and chart renderer for Claude communication.

Usage:
    python scripts/visualize.py                           # reads /tmp/viz-data.json
    python scripts/visualize.py /path/to/viz-data.json    # explicit path

Claude writes visualization specs to a JSON file, this serves them in a browser
with Mermaid.js (diagrams) and Chart.js (data charts).

No dependencies beyond Python 3.8+ stdlib.
"""

import json
import os
import sys
import signal
import webbrowser
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse

PORT = 8091

def find_data_path():
    candidates = [
        os.path.join(os.environ.get('TEMP', '/tmp'), 'viz-data.json'),
        '/tmp/viz-data.json',
    ]
    for c in candidates:
        p = os.path.normpath(c)
        if os.path.isfile(p):
            return p
    return candidates[0]

DATA_PATH = sys.argv[1] if len(sys.argv) > 1 else find_data_path()
DATA_PATH = os.path.abspath(DATA_PATH)

# ---------------------------------------------------------------------------
# HTML
# ---------------------------------------------------------------------------

HTML = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Claude Viz</title>
<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<style>
  :root {
    --bg: #0d1117; --surface: #161b22; --border: #30363d;
    --text: #e6edf3; --text-dim: #8b949e; --accent: #58a6ff;
    --green: #3fb950; --yellow: #d29922; --red: #f85149;
    --purple: #bc8cff;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    background: var(--bg); color: var(--text); line-height: 1.5;
    padding: 0;
  }

  /* ---- Header ---- */
  .header {
    position: sticky; top: 0; z-index: 100;
    background: var(--surface); border-bottom: 1px solid var(--border);
    padding: 12px 24px; display: flex; align-items: center; gap: 16px;
  }
  .header h1 { font-size: 18px; font-weight: 600; color: var(--accent); }
  .header .actions { margin-left: auto; display: flex; gap: 8px; }
  .btn {
    background: var(--border); color: var(--text); border: 1px solid var(--border);
    padding: 6px 14px; border-radius: 6px; cursor: pointer; font-size: 13px;
    transition: background 0.15s;
  }
  .btn:hover { background: #3d444d; }
  .btn-accent { background: #1f6feb; border-color: #1f6feb; }
  .btn-accent:hover { background: #388bfd; }

  /* ---- Layout ---- */
  .container { max-width: 1400px; margin: 0 auto; padding: 24px; }

  /* ---- Panel ---- */
  .panel {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 8px; margin-bottom: 20px; overflow: hidden;
  }
  .panel-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 20px; border-bottom: 1px solid var(--border);
    cursor: pointer; user-select: none;
  }
  .panel-header h2 {
    font-size: 15px; font-weight: 600; display: flex; align-items: center; gap: 10px;
  }
  .panel-header .badge {
    font-size: 11px; padding: 2px 8px; border-radius: 10px;
    background: #1f6feb33; color: var(--accent); font-weight: 500;
  }
  .panel-header .collapse-icon {
    color: var(--text-dim); font-size: 12px; transition: transform 0.2s;
  }
  .panel.collapsed .collapse-icon { transform: rotate(-90deg); }
  .panel.collapsed .panel-body { display: none; }

  .panel-body { padding: 20px; overflow-x: auto; }

  /* ---- Panel toolbar ---- */
  .panel-tools {
    display: flex; gap: 6px; align-items: center;
  }
  .panel-tools .btn { padding: 4px 10px; font-size: 12px; }

  /* ---- Mermaid ---- */
  .mermaid-container { display: flex; justify-content: center; }
  .mermaid-container svg { max-width: 100%; height: auto; }
  /* Override mermaid dark defaults for readability */
  .mermaid-container .node rect,
  .mermaid-container .node circle,
  .mermaid-container .node polygon { stroke: var(--accent) !important; }

  /* ---- Chart ---- */
  .chart-container {
    position: relative; width: 100%; max-width: 800px; margin: 0 auto;
  }
  .chart-container canvas { max-height: 450px; }

  /* ---- Code block (for raw source) ---- */
  .source-block {
    display: none; background: #010409; border: 1px solid var(--border);
    border-radius: 6px; padding: 14px 16px; margin-top: 12px;
    font-family: 'Cascadia Code', 'Fira Code', monospace; font-size: 13px;
    color: var(--text-dim); white-space: pre-wrap; overflow-x: auto;
    max-height: 400px; overflow-y: auto;
  }
  .source-block.visible { display: block; }

  /* ---- Markdown / text panels ---- */
  .text-content {
    font-size: 14px; line-height: 1.7; color: var(--text);
  }
  .text-content h1, .text-content h2, .text-content h3 {
    color: var(--accent); margin: 16px 0 8px 0;
  }
  .text-content code {
    background: #010409; padding: 2px 6px; border-radius: 4px; font-size: 13px;
  }
  .text-content pre {
    background: #010409; border: 1px solid var(--border); border-radius: 6px;
    padding: 14px; overflow-x: auto; margin: 12px 0;
  }
  .text-content pre code { background: none; padding: 0; }
  .text-content ul, .text-content ol { padding-left: 24px; margin: 8px 0; }
  .text-content table { border-collapse: collapse; margin: 12px 0; width: 100%; }
  .text-content th, .text-content td {
    border: 1px solid var(--border); padding: 8px 12px; text-align: left;
  }
  .text-content th { background: #161b22; font-weight: 600; }
  .text-content blockquote {
    border-left: 3px solid var(--accent); padding-left: 16px;
    color: var(--text-dim); margin: 12px 0;
  }

  /* ---- Toast ---- */
  .toast {
    position: fixed; bottom: 20px; right: 20px; background: var(--green);
    color: #000; padding: 10px 20px; border-radius: 8px; font-size: 14px;
    font-weight: 600; opacity: 0; transition: opacity 0.3s; z-index: 999;
    pointer-events: none;
  }
  .toast.show { opacity: 1; }

  /* ---- Empty state ---- */
  .empty-state {
    text-align: center; padding: 80px 20px; color: var(--text-dim);
  }
  .empty-state h2 { color: var(--accent); margin-bottom: 12px; }

  /* ---- Grid layout for side-by-side panels ---- */
  .panel-grid {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(500px, 1fr));
    gap: 20px;
  }
  .panel-grid .panel { margin-bottom: 0; }

  /* ---- Fullscreen overlay ---- */
  .fullscreen-overlay {
    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
    background: var(--bg); z-index: 200; display: flex; flex-direction: column;
    animation: fadeIn 0.15s ease-out;
  }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

  .fullscreen-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 24px; background: var(--surface); border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .fullscreen-header h2 {
    font-size: 16px; font-weight: 600; color: var(--accent);
    display: flex; align-items: center; gap: 10px;
  }
  .fullscreen-header .badge {
    font-size: 11px; padding: 2px 8px; border-radius: 10px;
    background: #1f6feb33; color: var(--accent); font-weight: 500;
  }
  .fullscreen-tools { display: flex; gap: 8px; align-items: center; }
  .fullscreen-body {
    flex: 1; overflow: auto; padding: 32px;
    display: flex; align-items: center; justify-content: center;
  }
  .fullscreen-body .mermaid-container { max-width: 95vw; width: 95vw; }
  .fullscreen-body .mermaid-container svg { width: 95vw; max-height: 82vh; }
  .fullscreen-body .chart-container { max-width: 90vw; width: 90vw; }
  .fullscreen-body .chart-container canvas { max-height: 80vh; }
  .fullscreen-body .text-content { max-width: 900px; width: 100%; }
  .fullscreen-body .source-block { max-height: none; }

  .kbd-hint {
    font-size: 11px; color: var(--text-dim); margin-left: 8px;
    background: var(--border); padding: 2px 8px; border-radius: 4px;
  }

  /* ---- Responsive ---- */
  @media (max-width: 768px) {
    .container { padding: 12px; }
    .panel-body { padding: 12px; }
    .panel-grid { grid-template-columns: 1fr; }
    .fullscreen-body { padding: 16px; }
  }
</style>
</head>
<body>

<div class="header">
  <h1 id="page-title">Claude Viz</h1>
  <div class="actions">
    <button class="btn" onclick="reload()" title="Reload data">Reload</button>
    <button class="btn btn-accent" onclick="exportAll()" title="Export as PNG">Export PNG</button>
  </div>
</div>

<div class="container" id="root"></div>
<div class="toast" id="toast"></div>

<script>
// ---- Globals ----
let DATA = null;
let chartInstances = {};

// ---- Init ----
mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  themeVariables: {
    primaryColor: '#1f6feb',
    primaryTextColor: '#e6edf3',
    primaryBorderColor: '#58a6ff',
    lineColor: '#8b949e',
    secondaryColor: '#161b22',
    tertiaryColor: '#0d1117',
    noteBkgColor: '#161b22',
    noteTextColor: '#e6edf3',
    noteBorderColor: '#30363d',
    actorBkg: '#1f6feb',
    actorTextColor: '#fff',
    actorBorder: '#58a6ff',
    actorLineColor: '#8b949e',
    signalColor: '#e6edf3',
    signalTextColor: '#e6edf3',
    labelBoxBkgColor: '#161b22',
    labelBoxBorderColor: '#30363d',
    labelTextColor: '#e6edf3',
    loopTextColor: '#8b949e',
    activationBkgColor: '#1f6feb33',
    activationBorderColor: '#58a6ff',
    sequenceNumberColor: '#0d1117',
  },
  sequence: { mirrorActors: false, messageMargin: 40 },
  flowchart: { htmlLabels: true, curve: 'basis' },
  fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Arial, sans-serif',
});

// ---- Load data ----
async function load() {
  try {
    const resp = await fetch('/api/data');
    DATA = await resp.json();
    render();
  } catch (e) {
    document.getElementById('root').innerHTML =
      '<div class="empty-state"><h2>No visualization data</h2><p>Waiting for Claude to generate a visualization...</p></div>';
  }
}

async function reload() {
  await load();
  showToast('Reloaded');
}

// ---- Render ----
async function render() {
  const root = document.getElementById('root');
  root.innerHTML = '';

  if (!DATA || !DATA.panels || DATA.panels.length === 0) {
    root.innerHTML = '<div class="empty-state"><h2>No panels</h2><p>Data file is empty.</p></div>';
    return;
  }

  if (DATA.title) {
    document.getElementById('page-title').textContent = DATA.title;
    document.title = DATA.title;
  }

  // Decide layout: use grid if 2+ small panels, otherwise stack
  const useGrid = DATA.layout === 'grid' && DATA.panels.length >= 2;
  const wrapper = document.createElement('div');
  if (useGrid) wrapper.className = 'panel-grid';
  root.appendChild(wrapper);

  for (let i = 0; i < DATA.panels.length; i++) {
    const panel = DATA.panels[i];
    const el = await createPanel(panel, i);
    wrapper.appendChild(el);
  }
}

async function createPanel(panel, idx) {
  const div = document.createElement('div');
  div.className = 'panel';
  div.id = 'panel-' + idx;

  const typeBadge = panel.type === 'mermaid' ? 'diagram'
    : panel.type === 'chart' ? 'chart'
    : panel.type === 'table' ? 'table'
    : 'text';

  div.innerHTML = `
    <div class="panel-header" onclick="togglePanel(${idx})">
      <h2>${escHtml(panel.title || 'Untitled')} <span class="badge">${typeBadge}</span></h2>
      <div class="panel-tools">
        <button class="btn" onclick="event.stopPropagation(); openFullscreen(${idx})" title="Fullscreen">&#x26F6;</button>
        ${panel.type === 'mermaid' || panel.type === 'text' ?
          `<button class="btn" onclick="event.stopPropagation(); toggleSource(${idx})">Source</button>` : ''}
        <button class="btn" onclick="event.stopPropagation(); copySource(${idx})">Copy</button>
        <span class="collapse-icon">&#9660;</span>
      </div>
    </div>
    <div class="panel-body" id="panel-body-${idx}"></div>
  `;

  const body = div.querySelector('.panel-body');

  if (panel.type === 'mermaid') {
    await renderMermaid(body, panel, idx);
  } else if (panel.type === 'chart') {
    renderChart(body, panel, idx);
  } else if (panel.type === 'table') {
    renderTable(body, panel, idx);
  } else {
    renderText(body, panel, idx);
  }

  return div;
}

// ---- Mermaid rendering ----
async function renderMermaid(body, panel, idx) {
  const container = document.createElement('div');
  container.className = 'mermaid-container';
  const mermaidDiv = document.createElement('div');
  mermaidDiv.className = 'mermaid-render';
  container.appendChild(mermaidDiv);
  body.appendChild(container);

  // Source block
  const src = document.createElement('pre');
  src.className = 'source-block';
  src.id = 'source-' + idx;
  src.textContent = panel.content;
  body.appendChild(src);

  try {
    const { svg } = await mermaid.render('mermaid-svg-' + idx, panel.content);
    mermaidDiv.innerHTML = svg;
  } catch (e) {
    mermaidDiv.innerHTML = `<pre style="color:var(--red)">Mermaid error: ${escHtml(e.message)}\n\nSource:\n${escHtml(panel.content)}</pre>`;
  }
}

// ---- Chart rendering ----
function renderChart(body, panel, idx) {
  const container = document.createElement('div');
  container.className = 'chart-container';
  const canvas = document.createElement('canvas');
  canvas.id = 'chart-' + idx;
  container.appendChild(canvas);
  body.appendChild(container);

  // Apply dark theme defaults
  const cfg = JSON.parse(JSON.stringify(panel.config || {}));
  if (!cfg.options) cfg.options = {};
  if (!cfg.options.plugins) cfg.options.plugins = {};
  if (!cfg.options.plugins.legend) cfg.options.plugins.legend = {};
  cfg.options.plugins.legend.labels = { color: '#e6edf3', ...(cfg.options.plugins.legend.labels || {}) };
  if (!cfg.options.scales) cfg.options.scales = {};
  for (const axis of ['x', 'y']) {
    if (!cfg.options.scales[axis]) cfg.options.scales[axis] = {};
    cfg.options.scales[axis].ticks = { color: '#8b949e', ...(cfg.options.scales[axis].ticks || {}) };
    cfg.options.scales[axis].grid = { color: '#30363d', ...(cfg.options.scales[axis].grid || {}) };
    cfg.options.scales[axis].title = { color: '#e6edf3', ...(cfg.options.scales[axis].title || {}) };
  }
  cfg.options.responsive = true;
  cfg.options.maintainAspectRatio = true;

  if (chartInstances[idx]) chartInstances[idx].destroy();
  chartInstances[idx] = new Chart(canvas.getContext('2d'), cfg);

  // Source block
  const src = document.createElement('pre');
  src.className = 'source-block';
  src.id = 'source-' + idx;
  src.textContent = JSON.stringify(panel.config, null, 2);
  body.appendChild(src);
}

// ---- Table rendering ----
function renderTable(body, panel, idx) {
  const { headers, rows } = panel;
  let html = '<div class="text-content"><table><thead><tr>';
  for (const h of headers) html += `<th>${escHtml(h)}</th>`;
  html += '</tr></thead><tbody>';
  for (const row of rows) {
    html += '<tr>';
    for (const cell of row) html += `<td>${escHtml(String(cell))}</td>`;
    html += '</tr>';
  }
  html += '</tbody></table></div>';
  body.innerHTML = html;

  // Source block (CSV-ish)
  const src = document.createElement('pre');
  src.className = 'source-block';
  src.id = 'source-' + idx;
  const lines = [headers.join('\t'), ...rows.map(r => r.join('\t'))];
  src.textContent = lines.join('\n');
  body.appendChild(src);
}

// ---- Text / markdown rendering ----
function renderText(body, panel, idx) {
  const div = document.createElement('div');
  div.className = 'text-content';
  div.innerHTML = simpleMarkdown(panel.content || '');
  body.appendChild(div);

  const src = document.createElement('pre');
  src.className = 'source-block';
  src.id = 'source-' + idx;
  src.textContent = panel.content || '';
  body.appendChild(src);
}

// ---- Simple markdown (no dependency) ----
function simpleMarkdown(text) {
  let html = escHtml(text);
  // Code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Blockquote
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
  // Unordered list items
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
  // Line breaks
  html = html.replace(/\n\n/g, '</p><p>');
  html = '<p>' + html + '</p>';
  html = html.replace(/<p><(h[123]|ul|pre|blockquote)/g, '<$1');
  html = html.replace(/<\/(h[123]|ul|pre|blockquote)><\/p>/g, '</$1>');
  return html;
}

// ---- Panel interactions ----
function togglePanel(idx) {
  document.getElementById('panel-' + idx).classList.toggle('collapsed');
}

function toggleSource(idx) {
  const el = document.getElementById('source-' + idx);
  if (el) el.classList.toggle('visible');
}

async function copySource(idx) {
  const el = document.getElementById('source-' + idx);
  if (!el) return;
  try {
    await navigator.clipboard.writeText(el.textContent);
    showToast('Copied to clipboard');
  } catch {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = el.textContent;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('Copied to clipboard');
  }
}

// ---- Fullscreen ----
let fullscreenOverlay = null;
let fullscreenChartInstance = null;

async function openFullscreen(idx) {
  const panel = DATA.panels[idx];
  if (!panel) return;

  // Remove existing overlay if any
  closeFullscreen();

  const typeBadge = panel.type === 'mermaid' ? 'diagram'
    : panel.type === 'chart' ? 'chart'
    : panel.type === 'table' ? 'table'
    : 'text';

  const overlay = document.createElement('div');
  overlay.className = 'fullscreen-overlay';
  overlay.id = 'fullscreen-overlay';
  overlay.innerHTML = `
    <div class="fullscreen-header">
      <h2>${escHtml(panel.title || 'Untitled')} <span class="badge">${typeBadge}</span></h2>
      <div class="fullscreen-tools">
        ${panel.type === 'mermaid' || panel.type === 'text' ?
          `<button class="btn" onclick="toggleFullscreenSource()">Source</button>` : ''}
        <button class="btn" onclick="copyFullscreenSource()">Copy</button>
        <button class="btn" onclick="closeFullscreen()">Close</button>
        <span class="kbd-hint">Esc</span>
      </div>
    </div>
    <div class="fullscreen-body" id="fullscreen-body"></div>
  `;

  document.body.appendChild(overlay);
  fullscreenOverlay = overlay;

  const body = overlay.querySelector('#fullscreen-body');

  if (panel.type === 'mermaid') {
    const container = document.createElement('div');
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.alignItems = 'center';
    container.style.width = '100%';

    const mermaidWrap = document.createElement('div');
    mermaidWrap.className = 'mermaid-container';
    const mermaidDiv = document.createElement('div');
    mermaidDiv.className = 'mermaid-render';
    mermaidWrap.appendChild(mermaidDiv);
    container.appendChild(mermaidWrap);

    const src = document.createElement('pre');
    src.className = 'source-block';
    src.id = 'fullscreen-source';
    src.textContent = panel.content;
    container.appendChild(src);

    body.appendChild(container);

    try {
      const id = 'mermaid-fs-' + Date.now();
      const { svg } = await mermaid.render(id, panel.content);
      mermaidDiv.innerHTML = svg;
      // Scale SVG to fill fullscreen: keep viewBox for aspect ratio, stretch width/height
      const svgEl = mermaidDiv.querySelector('svg');
      if (svgEl) {
        // Ensure viewBox exists so the SVG scales properly
        if (!svgEl.getAttribute('viewBox')) {
          const w = parseFloat(svgEl.getAttribute('width') || svgEl.getBBox().width);
          const h = parseFloat(svgEl.getAttribute('height') || svgEl.getBBox().height);
          svgEl.setAttribute('viewBox', `0 0 ${w} ${h}`);
        }
        // Remove fixed dimensions, let CSS scale it to fill the viewport
        svgEl.removeAttribute('width');
        svgEl.removeAttribute('height');
        svgEl.removeAttribute('style');
        svgEl.style.width = '95vw';
        svgEl.style.maxHeight = '82vh';
      }
    } catch (e) {
      mermaidDiv.innerHTML = `<pre style="color:var(--red)">Mermaid error: ${escHtml(e.message)}</pre>`;
    }
  } else if (panel.type === 'chart') {
    const container = document.createElement('div');
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.alignItems = 'center';
    container.style.width = '100%';

    const chartWrap = document.createElement('div');
    chartWrap.className = 'chart-container';
    const canvas = document.createElement('canvas');
    canvas.id = 'fullscreen-chart';
    chartWrap.appendChild(canvas);
    container.appendChild(chartWrap);

    const src = document.createElement('pre');
    src.className = 'source-block';
    src.id = 'fullscreen-source';
    src.textContent = JSON.stringify(panel.config, null, 2);
    container.appendChild(src);

    body.appendChild(container);

    const cfg = JSON.parse(JSON.stringify(panel.config || {}));
    if (!cfg.options) cfg.options = {};
    if (!cfg.options.plugins) cfg.options.plugins = {};
    if (!cfg.options.plugins.legend) cfg.options.plugins.legend = {};
    cfg.options.plugins.legend.labels = { color: '#e6edf3', ...(cfg.options.plugins.legend.labels || {}) };
    if (!cfg.options.scales) cfg.options.scales = {};
    for (const axis of ['x', 'y']) {
      if (!cfg.options.scales[axis]) cfg.options.scales[axis] = {};
      cfg.options.scales[axis].ticks = { color: '#8b949e', ...(cfg.options.scales[axis].ticks || {}) };
      cfg.options.scales[axis].grid = { color: '#30363d', ...(cfg.options.scales[axis].grid || {}) };
      cfg.options.scales[axis].title = { color: '#e6edf3', ...(cfg.options.scales[axis].title || {}) };
    }
    cfg.options.responsive = true;
    cfg.options.maintainAspectRatio = true;

    fullscreenChartInstance = new Chart(canvas.getContext('2d'), cfg);
  } else if (panel.type === 'table') {
    const container = document.createElement('div');
    container.style.width = '100%';
    container.style.maxWidth = '1200px';

    const { headers, rows } = panel;
    let html = '<div class="text-content"><table><thead><tr>';
    for (const h of headers) html += `<th>${escHtml(h)}</th>`;
    html += '</tr></thead><tbody>';
    for (const row of rows) {
      html += '<tr>';
      for (const cell of row) html += `<td>${escHtml(String(cell))}</td>`;
      html += '</tr>';
    }
    html += '</tbody></table></div>';

    const src = document.createElement('pre');
    const lines = [headers.join('\t'), ...rows.map(r => r.join('\t'))];

    container.innerHTML = html;
    const srcEl = document.createElement('pre');
    srcEl.className = 'source-block';
    srcEl.id = 'fullscreen-source';
    srcEl.textContent = lines.join('\n');
    container.appendChild(srcEl);

    body.appendChild(container);
  } else {
    const container = document.createElement('div');
    container.style.width = '100%';
    container.style.maxWidth = '900px';

    const div = document.createElement('div');
    div.className = 'text-content';
    div.innerHTML = simpleMarkdown(panel.content || '');
    container.appendChild(div);

    const src = document.createElement('pre');
    src.className = 'source-block';
    src.id = 'fullscreen-source';
    src.textContent = panel.content || '';
    container.appendChild(src);

    body.appendChild(container);
  }
}

function closeFullscreen() {
  if (fullscreenChartInstance) {
    fullscreenChartInstance.destroy();
    fullscreenChartInstance = null;
  }
  const el = document.getElementById('fullscreen-overlay');
  if (el) el.remove();
  fullscreenOverlay = null;
}

function toggleFullscreenSource() {
  const el = document.getElementById('fullscreen-source');
  if (el) el.classList.toggle('visible');
}

async function copyFullscreenSource() {
  const el = document.getElementById('fullscreen-source');
  if (!el) return;
  try {
    await navigator.clipboard.writeText(el.textContent);
    showToast('Copied to clipboard');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = el.textContent;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('Copied to clipboard');
  }
}

// Escape key closes fullscreen
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && fullscreenOverlay) {
    closeFullscreen();
  }
});

// ---- Export all panels as PNG ----
async function exportAll() {
  // Use html2canvas-like approach via SVG foreignObject
  // For simplicity, export mermaid SVGs directly
  for (let i = 0; i < DATA.panels.length; i++) {
    const panel = DATA.panels[i];
    if (panel.type === 'mermaid') {
      const svgEl = document.querySelector('#panel-body-' + i + ' svg');
      if (!svgEl) continue;
      const svgData = new XMLSerializer().serializeToString(svgEl);
      const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = (panel.title || 'diagram-' + i).replace(/[^a-z0-9]/gi, '-') + '.svg';
      a.click();
      URL.revokeObjectURL(url);
    } else if (panel.type === 'chart') {
      const canvas = document.getElementById('chart-' + i);
      if (!canvas) continue;
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = (panel.title || 'chart-' + i).replace(/[^a-z0-9]/gi, '-') + '.png';
      a.click();
    }
  }
  showToast('Exported');
}

// ---- Utils ----
function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2000);
}

// ---- Boot ----
load();
</script>
</body>
</html>
"""

# ---------------------------------------------------------------------------
# Server
# ---------------------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # suppress logs

    def _json(self, data, status=200):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _html(self, content, status=200):
        body = content.encode()
        self.send_response(status)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlparse(self.path).path

        if path == '/' or path == '':
            self._html(HTML)
        elif path == '/api/data':
            try:
                with open(DATA_PATH, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                self._json(data)
            except FileNotFoundError:
                self._json({'panels': [], 'title': 'No data'})
            except json.JSONDecodeError as e:
                self._json({'error': str(e)}, 400)
        else:
            self.send_error(404)

    def do_POST(self):
        path = urlparse(self.path).path

        if path == '/api/data':
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            try:
                data = json.loads(body)
                with open(DATA_PATH, 'w', encoding='utf-8') as f:
                    json.dump(data, f, indent=2)
                self._json({'ok': True})
            except Exception as e:
                self._json({'error': str(e)}, 400)
        else:
            self.send_error(404)


def kill_existing():
    """Kill any existing visualize server on our port."""
    import subprocess
    try:
        if sys.platform == 'win32':
            result = subprocess.run(
                ['netstat', '-ano'], capture_output=True, text=True
            )
            for line in result.stdout.splitlines():
                if f':{PORT}' in line and 'LISTENING' in line:
                    parts = line.split()
                    pid = parts[-1]
                    subprocess.run(['taskkill', '/F', '/PID', pid],
                                   capture_output=True)
        else:
            subprocess.run(
                ['fuser', '-k', f'{PORT}/tcp'],
                capture_output=True
            )
    except Exception:
        pass


def main():
    kill_existing()

    server = HTTPServer(('127.0.0.1', PORT), Handler)
    print(f"Visualize server running at http://localhost:{PORT}")
    print(f"Data file: {DATA_PATH}")

    webbrowser.open(f'http://localhost:{PORT}')

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
