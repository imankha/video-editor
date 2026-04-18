#!/usr/bin/env python3
"""
Task Manager UI — browser-based drag-and-drop task reordering for PLAN.md.

Usage:
    python scripts/task-manager.py                    # auto-finds docs/plans/PLAN.md
    python scripts/task-manager.py path/to/PLAN.md    # explicit path

Opens a browser UI where you can:
  - Drag-and-drop to reorder tasks within a milestone
  - Drag tasks between milestones to reassign them
  - Delete tasks
  - Save changes back to PLAN.md

No dependencies beyond Python 3.8+ stdlib.
"""

import json
import re
import os
import sys
import webbrowser
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

# --- Config ---

PORT = 8089

def find_plan_path():
    """Find PLAN.md relative to this script or cwd."""
    candidates = [
        os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'docs', 'plans', 'PLAN.md'),
        os.path.join(os.getcwd(), 'docs', 'plans', 'PLAN.md'),
        os.path.join(os.getcwd(), 'PLAN.md'),
    ]
    for c in candidates:
        p = os.path.normpath(c)
        if os.path.isfile(p):
            return p
    return None

PLAN_PATH = sys.argv[1] if len(sys.argv) > 1 else find_plan_path()
if not PLAN_PATH or not os.path.isfile(PLAN_PATH):
    print(f"Error: Cannot find PLAN.md. Pass the path as an argument.")
    sys.exit(1)
PLAN_PATH = os.path.abspath(PLAN_PATH)

# --- Parser ---

def slugify(text):
    text = text.lower().strip()
    text = re.sub(r'[^a-z0-9\s-]', '', text)
    text = re.sub(r'[\s-]+', '-', text).strip('-')
    return text

def clean_milestone_name(raw):
    name = raw
    name = re.sub(r'\s*\((?:IN_PROGRESS|TODO|DONE|NEXT UP)\)', '', name)
    name = re.sub(r'\s*--\s*BUG FIX', '', name)
    name = re.sub(r'\s*\(prioritized first\)', '', name)
    name = name.replace('Milestone: ', '').replace('Epic: ', '')
    return name.strip()

def parse_table_cells(line):
    cells = [c.strip() for c in line.split('|')]
    if cells and cells[0] == '':
        cells = cells[1:]
    if cells and cells[-1] == '':
        cells = cells[:-1]
    return cells

def parse_task_link(cell):
    m = re.match(r'[↳\s]*\[(.+?)\]\((.+?)\)', cell)
    if m:
        return m.group(1), m.group(2)
    return cell.strip(), ''

def parse_plan(content):
    """Parse PLAN.md into a list of milestones, each with headers and tasks."""
    lines = content.split('\n')
    milestones = []
    section_stack = []  # track ### and #### headers

    i = 0
    while i < len(lines):
        line = lines[i]

        # Track section headers
        m3 = re.match(r'^###\s+(.+)$', line)
        m4 = re.match(r'^####\s+(.+)$', line)
        if m3:
            section_stack = [m3.group(1).strip()]
        elif m4:
            if len(section_stack) >= 1:
                section_stack = [section_stack[0], m4.group(1).strip()]
            else:
                section_stack = [m4.group(1).strip()]

        # Detect table header (must contain "ID")
        if re.match(r'^\|\s*ID\s*\|', line):
            raw_headers = parse_table_cells(line)
            header_line = i

            # Build milestone name from section stack
            if len(section_stack) >= 2:
                raw_name = f"{section_stack[0]} \u2014 {section_stack[1]}"
            elif section_stack:
                raw_name = section_stack[0]
            else:
                raw_name = "Other"

            display_name = clean_milestone_name(raw_name)
            ms_id = slugify(display_name)

            # Skip separator
            i += 1
            if i < len(lines) and re.match(r'^\|[-\s:|]+\|$', lines[i]):
                i += 1

            # Parse task rows
            tasks = []
            while i < len(lines) and lines[i].startswith('|'):
                cells = parse_table_cells(lines[i])
                task = {}
                for j, h in enumerate(raw_headers):
                    if j < len(cells):
                        key = h.strip().lower()
                        if key == 'cmplx':
                            key = 'complexity'
                        task[key] = cells[j]

                # Extract name/link from "task" column
                task_cell = task.get('task', '')
                name, link = parse_task_link(task_cell)
                task['name'] = name
                task['link'] = link
                task['_raw_task'] = task_cell
                tasks.append(task)
                i += 1

            table_end = i

            # Normalize header names for the stored format
            norm_headers = []
            for h in raw_headers:
                hl = h.strip().lower()
                if hl == 'cmplx':
                    norm_headers.append('complexity')
                else:
                    norm_headers.append(hl)

            milestones.append({
                'id': ms_id,
                'name': display_name,
                'headers': raw_headers,         # original casing for write-back
                'norm_headers': norm_headers,    # lowercase for lookup
                'tasks': tasks,
                'table_start': header_line,
                'table_end': table_end,
            })
        else:
            i += 1

    return milestones


# --- Writer ---

def format_task_row(task, headers, norm_headers):
    """Format a task dict as a markdown table row using the given headers."""
    cells = []
    for orig_h, norm_h in zip(headers, norm_headers):
        if norm_h == 'task':
            cells.append(task.get('_raw_task', task.get('name', '')))
        elif norm_h == 'complexity':
            cells.append(task.get('complexity', task.get('cmplx', '')))
        else:
            cells.append(task.get(norm_h, ''))
    return '| ' + ' | '.join(cells) + ' |'

def save_plan(updated_milestones_json):
    """Save updated task ordering back to PLAN.md."""
    with open(PLAN_PATH, 'r', encoding='utf-8') as f:
        content = f.read()

    original = parse_plan(content)
    lines = content.split('\n')

    # Map updated milestones by id
    updated_map = {}
    for m in updated_milestones_json:
        updated_map[m['id']] = m['tasks']

    # Process bottom-up to preserve line numbers
    original.sort(key=lambda m: m['table_start'], reverse=True)

    for orig in original:
        if orig['id'] not in updated_map:
            continue
        new_tasks = updated_map[orig['id']]

        new_lines = []
        # Header
        new_lines.append('| ' + ' | '.join(orig['headers']) + ' |')
        # Separator — match original column count
        sep = '|' + '|'.join(['------' for _ in orig['headers']]) + '|'
        new_lines.append(sep)
        # Rows
        for t in new_tasks:
            new_lines.append(format_task_row(t, orig['headers'], orig['norm_headers']))

        lines[orig['table_start']:orig['table_end']] = new_lines

    with open(PLAN_PATH, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(lines))

    return True


# --- HTML UI ---

HTML = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Task Manager</title>
<script src="https://cdn.jsdelivr.net/npm/sortablejs@1.15.6/Sortable.min.js"></script>
<style>
  :root {
    --bg: #0d1117; --surface: #161b22; --border: #30363d;
    --text: #e6edf3; --text-dim: #8b949e; --accent: #58a6ff;
    --green: #3fb950; --yellow: #d29922; --red: #f85149;
    --blue: #58a6ff; --gray: #484f58; --purple: #bc8cff;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    background: var(--bg); color: var(--text); line-height: 1.5;
    padding: 0;
  }
  header {
    position: sticky; top: 0; z-index: 100;
    background: var(--surface); border-bottom: 1px solid var(--border);
    padding: 12px 24px; display: flex; align-items: center; gap: 16px;
  }
  header h1 { font-size: 18px; font-weight: 600; flex: 1; }
  .btn {
    padding: 6px 16px; border-radius: 6px; border: 1px solid var(--border);
    background: var(--surface); color: var(--text); cursor: pointer;
    font-size: 13px; font-weight: 500; transition: all 0.15s;
  }
  .btn:hover { border-color: var(--accent); color: var(--accent); }
  .btn-primary {
    background: #238636; border-color: #2ea043; color: #fff;
  }
  .btn-primary:hover { background: #2ea043; }
  .btn-primary:disabled { opacity: 0.5; cursor: default; }
  .toast {
    position: fixed; bottom: 24px; right: 24px; padding: 12px 20px;
    background: var(--green); color: #000; border-radius: 8px;
    font-weight: 600; font-size: 14px; opacity: 0; transition: opacity 0.3s;
    z-index: 200; pointer-events: none;
  }
  .toast.show { opacity: 1; }

  .controls { display: flex; gap: 8px; align-items: center; }
  .controls label { font-size: 13px; color: var(--text-dim); cursor: pointer; display: flex; align-items: center; gap: 4px; }

  main { max-width: 960px; margin: 0 auto; padding: 24px; }

  .milestone {
    margin-bottom: 24px; background: var(--surface);
    border: 1px solid var(--border); border-radius: 8px; overflow: hidden;
  }
  .milestone-header {
    padding: 12px 16px; display: flex; align-items: center; gap: 8px;
    cursor: pointer; user-select: none; border-bottom: 1px solid var(--border);
  }
  .milestone-header:hover { background: rgba(255,255,255,0.02); }
  .milestone-header .arrow { transition: transform 0.2s; font-size: 12px; color: var(--text-dim); }
  .milestone-header .arrow.collapsed { transform: rotate(-90deg); }
  .milestone-header h2 { font-size: 15px; font-weight: 600; flex: 1; }
  .milestone-header .count {
    font-size: 12px; background: var(--border); padding: 2px 8px;
    border-radius: 10px; color: var(--text-dim);
  }

  .task-list { min-height: 8px; }
  .task-list.collapsed { display: none; }

  .task-card {
    display: grid; grid-template-columns: 24px 64px 1fr auto auto auto auto 32px;
    align-items: center; gap: 8px; padding: 10px 16px;
    border-bottom: 1px solid var(--border); cursor: pointer;
    transition: background 0.1s;
  }
  .task-card:last-child { border-bottom: none; }
  .task-card:hover { background: rgba(255,255,255,0.02); }
  .task-card.sortable-ghost { opacity: 0.4; background: rgba(88,166,255,0.1); }
  .task-card.sortable-chosen { background: rgba(88,166,255,0.05); }
  .task-card.expanded { background: rgba(255,255,255,0.02); }

  .drag-handle { color: var(--text-dim); cursor: grab; font-size: 14px; }
  .task-id { font-family: monospace; font-size: 13px; color: var(--accent); font-weight: 600; }
  .task-name { font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }

  .task-detail {
    display: none; grid-column: 1 / -1; padding: 12px 0 4px 32px;
    border-top: 1px solid var(--border); margin-top: 8px;
  }
  .task-card.expanded .task-detail { display: block; }
  .task-detail .detail-desc { font-size: 13px; color: var(--text-dim); margin-bottom: 8px; line-height: 1.6; }
  .task-detail .detail-meta {
    display: flex; gap: 16px; font-size: 12px; color: var(--text-dim); margin-bottom: 8px;
  }
  .task-detail .detail-meta span { font-family: monospace; }
  .task-detail .detail-content {
    background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
    padding: 12px 16px; font-size: 13px; white-space: pre-wrap; max-height: 400px;
    overflow-y: auto; margin-top: 8px; line-height: 1.6; color: var(--text-dim);
  }
  .task-detail .load-btn {
    background: none; border: 1px solid var(--border); color: var(--accent);
    padding: 4px 12px; border-radius: 4px; cursor: pointer; font-size: 12px;
    margin-top: 4px;
  }
  .task-detail .load-btn:hover { border-color: var(--accent); background: rgba(88,166,255,0.05); }

  .badge {
    font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 4px;
    text-transform: uppercase; white-space: nowrap; text-align: center;
  }
  .badge-todo { background: rgba(88,166,255,0.15); color: var(--blue); }
  .badge-testing { background: rgba(210,153,34,0.15); color: var(--yellow); }
  .badge-done { background: rgba(63,185,80,0.15); color: var(--green); }
  .badge-ice { background: rgba(72,79,88,0.25); color: var(--gray); }
  .badge-measuring { background: rgba(188,140,255,0.15); color: var(--purple); }
  .badge-obsolete { background: rgba(72,79,88,0.25); color: var(--gray); text-decoration: line-through; }

  .meta { font-size: 12px; color: var(--text-dim); font-family: monospace; white-space: nowrap; text-align: center; min-width: 28px; }
  .meta-label { font-size: 10px; color: var(--text-dim); display: block; }

  .delete-btn {
    background: none; border: none; color: var(--text-dim); cursor: pointer;
    font-size: 18px; padding: 0 4px; border-radius: 4px; transition: all 0.15s;
    line-height: 1;
  }
  .delete-btn:hover { color: var(--red); background: rgba(248,81,73,0.1); }

  .empty-state {
    padding: 24px; text-align: center; color: var(--text-dim); font-size: 13px;
    font-style: italic;
  }

  @media (max-width: 768px) {
    .task-card { grid-template-columns: 20px 50px 1fr auto auto 28px; font-size: 13px; }
    .meta-extra { display: none; }
  }
</style>
</head>
<body>

<header>
  <h1>Task Manager</h1>
  <div class="controls">
    <label><input type="checkbox" id="hide-done" checked> Hide done</label>
    <label><input type="checkbox" id="hide-ice" checked> Hide ice</label>
  </div>
  <button class="btn btn-primary" id="save-btn" disabled>Save</button>
  <button class="btn" id="reload-btn">Reload</button>
</header>

<main id="app"></main>

<div class="toast" id="toast">Saved!</div>

<script>
let data = [];
let dirty = false;

function statusClass(s) {
  const l = (s || '').toLowerCase().replace(/\s/g, '');
  if (l === 'done') return 'badge-done';
  if (l === 'testing') return 'badge-testing';
  if (l === 'todo') return 'badge-todo';
  if (l === 'ice') return 'badge-ice';
  if (l === 'measuring') return 'badge-measuring';
  if (l === 'obsolete' || l.includes('not_recommended') || l.includes('not recommended')) return 'badge-obsolete';
  return 'badge-todo';
}

function markDirty() {
  dirty = true;
  document.getElementById('save-btn').disabled = false;
}

function render() {
  const app = document.getElementById('app');
  const hideDone = document.getElementById('hide-done').checked;
  const hideIce = document.getElementById('hide-ice').checked;
  app.innerHTML = '';

  data.forEach((ms, msIdx) => {
    const div = document.createElement('div');
    div.className = 'milestone';
    div.dataset.msIdx = msIdx;

    const filteredTasks = ms.tasks.filter(t => {
      const st = (t.status || '').toLowerCase();
      if (hideDone && st === 'done') return false;
      if (hideIce && (st === 'ice' || st === 'obsolete')) return false;
      return true;
    });

    // Header
    const hdr = document.createElement('div');
    hdr.className = 'milestone-header';
    hdr.innerHTML = `
      <span class="arrow">&#9660;</span>
      <h2>${esc(ms.name)}</h2>
      <span class="count">${filteredTasks.length}</span>
    `;
    hdr.onclick = () => {
      const list = div.querySelector('.task-list');
      const arrow = hdr.querySelector('.arrow');
      list.classList.toggle('collapsed');
      arrow.classList.toggle('collapsed');
    };
    div.appendChild(hdr);

    // Task list
    const list = document.createElement('div');
    list.className = 'task-list';
    list.dataset.msId = ms.id;

    if (filteredTasks.length === 0) {
      list.innerHTML = '<div class="empty-state">No tasks — drag tasks here to add</div>';
    }

    filteredTasks.forEach(t => {
      const card = document.createElement('div');
      card.className = 'task-card';
      card.dataset.taskId = t.id;

      const impact = t.impact || '';
      const cmplx = t.complexity || '';
      const pri = t.pri || '';

      card.innerHTML = `
        <span class="drag-handle">&#9776;</span>
        <span class="task-id">${esc(t.id)}</span>
        <span class="task-name">${esc(t.name)}</span>
        <span class="badge ${statusClass(t.status)}">${esc(t.status || 'TODO')}</span>
        <span class="meta" title="Priority">${esc(pri)}</span>
        <span class="meta meta-extra" title="Impact">${impact ? 'I:' + esc(impact) : ''}</span>
        <span class="meta meta-extra" title="Complexity">${cmplx ? 'C:' + esc(cmplx) : ''}</span>
        <button class="delete-btn" title="Delete task">&times;</button>
        <div class="task-detail">
          <p class="detail-desc">${esc(t.description || 'No description.')}</p>
          <div class="detail-meta">
            ${impact ? '<span>Impact: ' + esc(impact) + '</span>' : ''}
            ${cmplx ? '<span>Complexity: ' + esc(cmplx) + '</span>' : ''}
            ${pri ? '<span>Priority: ' + esc(pri) + '</span>' : ''}
          </div>
          ${t.link ? '<div class="detail-content">Click "Load details" to view task file</div><button class="load-btn">Load details</button>' : ''}
        </div>
      `;

      card.querySelector('.delete-btn').onclick = (e) => {
        e.stopPropagation();
        if (!confirm(`Delete ${t.id} "${t.name}"?`)) return;
        const realIdx = ms.tasks.findIndex(x => x.id === t.id);
        if (realIdx >= 0) ms.tasks.splice(realIdx, 1);
        markDirty();
        render();
      };

      card.addEventListener('click', (e) => {
        if (e.target.closest('.drag-handle') || e.target.closest('.delete-btn') || e.target.closest('.load-btn')) return;
        card.classList.toggle('expanded');
      });

      const loadBtn = card.querySelector('.load-btn');
      if (loadBtn) {
        loadBtn.onclick = (e) => {
          e.stopPropagation();
          const detail = card.querySelector('.task-detail');
          const contentEl = detail.querySelector('.detail-content');
          if (detail.dataset.loaded) {
            const visible = contentEl.style.display !== 'none';
            contentEl.style.display = visible ? 'none' : 'block';
            loadBtn.textContent = visible ? 'Show details' : 'Hide details';
          } else {
            loadTaskFile(t.link, detail);
            loadBtn.textContent = 'Hide details';
          }
        };
      }

      list.appendChild(card);
    });

    div.appendChild(list);
    app.appendChild(div);

    // Init SortableJS
    new Sortable(list, {
      group: 'tasks',
      animation: 150,
      handle: '.drag-handle',
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      emptyInsertThreshold: 30,
      onEnd: function(evt) {
        const taskId = evt.item.dataset.taskId;
        const fromMsId = evt.from.dataset.msId;
        const toMsId = evt.to.dataset.msId;

        const fromMs = data.find(m => m.id === fromMsId);
        const toMs = data.find(m => m.id === toMsId);
        if (!fromMs || !toMs) return;

        // Remove from source
        const taskIdx = fromMs.tasks.findIndex(t => t.id === taskId);
        if (taskIdx < 0) return;
        const [task] = fromMs.tasks.splice(taskIdx, 1);

        // Compute visible insert index -> real index in toMs.tasks
        // evt.newIndex is the index among visible (filtered) items
        const hideDone = document.getElementById('hide-done').checked;
        const hideIce = document.getElementById('hide-ice').checked;
        let visibleCount = 0;
        let realInsertIdx = toMs.tasks.length; // default: append
        for (let ri = 0; ri < toMs.tasks.length; ri++) {
          const st = (toMs.tasks[ri].status || '').toLowerCase();
          const hidden = (hideDone && st === 'done') || (hideIce && (st === 'ice' || st === 'obsolete'));
          if (!hidden) {
            if (visibleCount === evt.newIndex) {
              realInsertIdx = ri;
              break;
            }
            visibleCount++;
          }
        }

        toMs.tasks.splice(realInsertIdx, 0, task);
        markDirty();
        render();
      }
    });
  });
}

function esc(s) {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function loadTaskFile(link, detailEl) {
  const contentEl = detailEl.querySelector('.detail-content');
  if (!contentEl) return;
  contentEl.textContent = 'Loading...';
  try {
    const resp = await fetch('/api/task-file?path=' + encodeURIComponent(link));
    if (resp.ok) {
      const d = await resp.json();
      contentEl.textContent = d.content;
      detailEl.dataset.loaded = 'true';
    } else {
      contentEl.textContent = 'Could not load task file.';
    }
  } catch(e) {
    contentEl.textContent = 'Error: ' + e.message;
  }
}

async function load() {
  const resp = await fetch('/api/tasks');
  data = await resp.json();
  dirty = false;
  document.getElementById('save-btn').disabled = true;
  render();
}

document.getElementById('save-btn').onclick = async () => {
  const btn = document.getElementById('save-btn');
  btn.disabled = true;
  btn.textContent = 'Saving...';
  try {
    const resp = await fetch('/api/save', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(data)
    });
    if (resp.ok) {
      dirty = false;
      btn.textContent = 'Save';
      const toast = document.getElementById('toast');
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 2000);
    } else {
      alert('Save failed: ' + await resp.text());
      btn.disabled = false;
      btn.textContent = 'Save';
    }
  } catch(e) {
    alert('Save failed: ' + e.message);
    btn.disabled = false;
    btn.textContent = 'Save';
  }
};

document.getElementById('reload-btn').onclick = () => {
  if (dirty && !confirm('Discard unsaved changes?')) return;
  load();
};

document.getElementById('hide-done').onchange = render;
document.getElementById('hide-ice').onchange = render;

// Warn on leave
window.onbeforeunload = (e) => { if (dirty) { e.preventDefault(); return ''; } };

load();
</script>
</body>
</html>"""


# --- HTTP Server ---

class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # quiet

    def _json(self, code, data):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', len(body))
        self.end_headers()
        self.wfile.write(body)

    def _html(self, code, html):
        body = html.encode()
        self.send_response(code)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', len(body))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == '/':
            self._html(200, HTML)
        elif self.path.startswith('/api/task-file'):
            parsed = urlparse(self.path)
            params = parse_qs(parsed.query)
            rel_path = params.get('path', [''])[0]
            if not rel_path:
                self._json(400, {'error': 'Missing path'})
                return
            plan_dir = os.path.dirname(PLAN_PATH)
            file_path = os.path.normpath(os.path.join(plan_dir, rel_path))
            # Security: must stay within project
            project_root = os.path.dirname(plan_dir)
            if not file_path.startswith(project_root):
                self._json(403, {'error': 'Access denied'})
                return
            if not os.path.isfile(file_path):
                self._json(404, {'error': 'File not found'})
                return
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
            self._json(200, {'content': content})
        elif self.path == '/api/tasks':
            with open(PLAN_PATH, 'r', encoding='utf-8') as f:
                content = f.read()
            milestones = parse_plan(content)
            # Send clean data to frontend
            result = []
            for ms in milestones:
                tasks = []
                for t in ms['tasks']:
                    tasks.append({
                        'id': t.get('id', ''),
                        'name': t.get('name', ''),
                        'link': t.get('link', ''),
                        'status': t.get('status', ''),
                        'pri': t.get('pri', ''),
                        'impact': t.get('impact', ''),
                        'complexity': t.get('complexity', ''),
                        'description': t.get('description', ''),
                        '_raw_task': t.get('_raw_task', ''),
                    })
                result.append({
                    'id': ms['id'],
                    'name': ms['name'],
                    'tasks': tasks,
                })
            self._json(200, result)
        else:
            self.send_error(404)

    def do_POST(self):
        if self.path == '/api/save':
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            updated = json.loads(body)
            try:
                save_plan(updated)
                self._json(200, {'ok': True})
            except Exception as e:
                self._json(500, {'error': str(e)})
        else:
            self.send_error(404)


# --- Main ---

if __name__ == '__main__':
    print(f"Task Manager serving PLAN.md: {PLAN_PATH}")
    print(f"Open http://localhost:{PORT}")
    server = HTTPServer(('127.0.0.1', PORT), Handler)
    webbrowser.open(f'http://localhost:{PORT}')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
