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
import shutil
import subprocess
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

def detect_epic_row(task):
    """Detect if a task row is an epic header (empty ID, bold name linking to EPIC.md)."""
    if task.get('id', '').strip():
        return None
    raw_task = task.get('_raw_task', '')
    m = re.match(r'(?:~~)?\*\*\[(.+?)\]\((.+?EPIC\.md)\)\*\*(?:~~)?', raw_task)
    if m:
        return {'name': m.group(1), 'link': m.group(2), 'id': slugify(m.group(1))}
    return None

def detect_epic_child(task):
    """Detect if a task row is a child of an epic (has ↳ prefix)."""
    raw_task = task.get('_raw_task', '')
    return '↳' in raw_task

def parse_plan(content):
    """Parse PLAN.md into a list of milestones, each with headers and tasks."""
    lines = content.split('\n')
    milestones = []
    section_stack = []  # [(text, line_number), ...]

    i = 0
    while i < len(lines):
        line = lines[i]

        # Track section headers
        m3 = re.match(r'^###\s+(.+)$', line)
        m4 = re.match(r'^####\s+(.+)$', line)
        if m3:
            section_stack = [(m3.group(1).strip(), i)]
        elif m4:
            if len(section_stack) >= 1:
                section_stack = [section_stack[0], (m4.group(1).strip(), i)]
            else:
                section_stack = [(m4.group(1).strip(), i)]

        # Detect table header (must contain "ID")
        if re.match(r'^\|\s*ID\s*\|', line):
            raw_headers = parse_table_cells(line)
            header_line = i

            # Build milestone name from section stack
            if len(section_stack) >= 2:
                raw_name = f"{section_stack[0][0]} \u2014 {section_stack[1][0]}"
            elif section_stack:
                raw_name = section_stack[0][0]
            else:
                raw_name = "Other"

            display_name = clean_milestone_name(raw_name)
            ms_id = f'ms-{len(milestones)}'

            # Skip separator
            i += 1
            if i < len(lines) and re.match(r'^\|[-\s:|]+\|$', lines[i]):
                i += 1

            # Parse task rows and detect epic groupings
            tasks = []
            current_epic = None
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

                # Detect epic header rows and child tasks
                epic_info = detect_epic_row(task)
                if epic_info:
                    current_epic = epic_info['id']
                    task['_is_epic_header'] = True
                    task['_epic_id'] = current_epic
                    task['_epic_name'] = epic_info['name']
                    task['_epic_link'] = epic_info['link']
                elif current_epic and detect_epic_child(task):
                    task['_epic_id'] = current_epic
                else:
                    current_epic = None

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

            section_headers = [{'level': 3 if idx == 0 else 4, 'line': ln, 'text': txt}
                               for idx, (txt, ln) in enumerate(section_stack)]

            milestones.append({
                'id': ms_id,
                'name': display_name,
                'headers': raw_headers,         # original casing for write-back
                'norm_headers': norm_headers,    # lowercase for lookup
                'tasks': tasks,
                'table_start': header_line,
                'table_end': table_end,
                '_section_headers': section_headers,
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
    name_map = {}
    for m in updated_milestones_json:
        updated_map[m['id']] = m['tasks']
        name_map[m['id']] = m.get('name', '')

    # Process bottom-up to preserve line numbers
    original.sort(key=lambda m: m['table_start'], reverse=True)

    for orig in original:
        # Handle table replacement
        if orig['id'] in updated_map:
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

        # Handle milestone rename (header lines are before table, unaffected by table splice)
        new_name = name_map.get(orig['id'], '')
        if new_name and new_name != orig['name']:
            headers = orig.get('_section_headers', [])
            if headers:
                h = headers[-1]  # innermost header
                if len(headers) > 1 and ' — ' in new_name:
                    editable_part = new_name.split(' — ', 1)[1]
                else:
                    editable_part = new_name

                original_line = lines[h['line']]
                header_match = re.match(r'^(#{3,4})\s+', original_line)
                if header_match:
                    prefix = header_match.group(1) + ' '
                    badge_match = re.search(r'(\s*\((?:IN_PROGRESS|TODO|DONE|NEXT UP)\)(?:\s*--\s*BUG FIX)?)\s*$', original_line)
                    badge = badge_match.group(1) if badge_match else ''
                    lines[h['line']] = prefix + editable_part + badge

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
  .toast {
    position: fixed; bottom: 24px; right: 24px; padding: 12px 20px;
    background: var(--green); color: #000; border-radius: 8px;
    font-weight: 600; font-size: 14px; opacity: 0; transition: opacity 0.3s;
    z-index: 200; pointer-events: none;
  }
  .toast.show { opacity: 1; }
  .toast.error { background: var(--red); }

  .controls { display: flex; gap: 8px; align-items: center; }
  .controls label { font-size: 13px; color: var(--text-dim); cursor: pointer; display: flex; align-items: center; gap: 4px; }

  .status { font-size: 13px; font-weight: 500; padding: 6px 12px; border-radius: 6px; transition: all 0.3s; }
  .status.saved { color: var(--green); }
  .status.saving { color: var(--yellow); }
  .status.error { color: var(--red); }

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
  .milestone-header h2 { font-size: 15px; font-weight: 600; flex: 1; cursor: text; }
  .milestone-header .count {
    font-size: 12px; background: var(--border); padding: 2px 8px;
    border-radius: 10px; color: var(--text-dim);
  }

  .task-list { min-height: 8px; }
  .task-list.collapsed { display: none; }

  .inline-edit {
    background: var(--bg); border: 1px solid var(--accent); color: var(--text);
    font-size: inherit; font-weight: inherit; font-family: inherit;
    padding: 2px 6px; border-radius: 4px; outline: none; width: 100%;
  }

  /* Epic group styling */
  .epic-group {
    border-left: 3px solid var(--purple);
    margin: 4px 0; background: rgba(188,140,255,0.03);
    border-radius: 0 6px 6px 0;
  }
  .epic-header {
    display: flex; align-items: center; gap: 10px; padding: 8px 16px;
    cursor: pointer; user-select: none; border-bottom: 1px solid var(--border);
    background: rgba(188,140,255,0.06);
  }
  .epic-header:hover { background: rgba(188,140,255,0.1); }
  .epic-header .epic-arrow { transition: transform 0.2s; font-size: 10px; color: var(--purple); }
  .epic-header .epic-arrow.collapsed { transform: rotate(-90deg); }
  .epic-header .epic-icon { font-size: 14px; color: var(--purple); }
  .epic-header .epic-name { font-size: 14px; font-weight: 600; color: var(--purple); flex: 1; cursor: text; }
  .epic-header .epic-desc { font-size: 12px; color: var(--text-dim); max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .epic-header .epic-count {
    font-size: 11px; background: rgba(188,140,255,0.15); padding: 1px 7px;
    border-radius: 8px; color: var(--purple); font-weight: 600;
  }
  .epic-header .epic-drag-handle { cursor: grab; font-size: 14px; }
  .epic-header .epic-move-btn {
    background: none; border: none; color: var(--text-dim); cursor: pointer;
    font-size: 12px; padding: 2px 6px; border-radius: 4px; transition: all 0.15s;
    position: relative;
  }
  .epic-header .epic-move-btn:hover { color: var(--accent); background: rgba(88,166,255,0.1); }
  .epic-header .epic-reorder-btn {
    background: none; border: none; color: var(--text-dim); cursor: pointer;
    font-size: 14px; padding: 0 2px; transition: all 0.15s; line-height: 1;
  }
  .epic-header .epic-reorder-btn:hover { color: var(--accent); }
  .epic-header .epic-reorder-btn:disabled { opacity: 0.2; cursor: default; }
  .epic-header .epic-delete-btn {
    background: none; border: none; color: var(--text-dim); cursor: pointer;
    font-size: 16px; padding: 0 4px; border-radius: 4px; transition: all 0.15s; line-height: 1;
  }
  .epic-header .epic-delete-btn:hover { color: var(--red); background: rgba(248,81,73,0.1); }
  .move-dropdown {
    position: absolute; top: 100%; right: 0; z-index: 50;
    background: var(--surface); border: 1px solid var(--border); border-radius: 6px;
    min-width: 200px; max-height: 300px; overflow-y: auto;
    box-shadow: 0 8px 24px rgba(0,0,0,0.4); padding: 4px 0;
  }
  .move-dropdown-item {
    display: block; width: 100%; text-align: left; padding: 6px 12px;
    background: none; border: none; color: var(--text); cursor: pointer;
    font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .move-dropdown-item:hover { background: rgba(88,166,255,0.1); color: var(--accent); }
  .move-dropdown-item.current { color: var(--text-dim); cursor: default; }
  .move-dropdown-item.current:hover { background: none; color: var(--text-dim); }
  .epic-children { padding-left: 12px; min-height: 24px; transition: background 0.15s; }
  .epic-children.collapsed { display: none; }
  .epic-children .task-card { border-left: none; }
  .epic-children.sortable-drag-over { background: rgba(188,140,255,0.06); border-radius: 6px; }
  .epic-group.sortable-ghost { opacity: 0.4; background: rgba(188,140,255,0.1); }
  .epic-group.sortable-chosen { background: rgba(188,140,255,0.08); }
  .sortable-fallback { opacity: 0.85; box-shadow: 0 4px 16px rgba(0,0,0,0.4); }

  .add-epic-btn {
    background: none; border: 1px dashed var(--purple); color: var(--purple);
    padding: 6px 16px; border-radius: 6px; cursor: pointer; font-size: 13px;
    margin: 8px 16px; display: block; width: calc(100% - 32px);
    transition: all 0.15s; text-align: center;
  }
  .add-epic-btn:hover { background: rgba(188,140,255,0.1); border-style: solid; }

  .task-card {
    display: grid; grid-template-columns: 24px 64px 1fr auto auto auto auto 24px 24px;
    align-items: center; gap: 8px; padding: 10px 16px;
    border-bottom: 1px solid var(--border); cursor: pointer;
    transition: background 0.1s;
  }
  .task-card .task-epic-btn {
    background: none; border: none; color: var(--text-dim); cursor: pointer;
    font-size: 12px; padding: 0; border-radius: 4px; transition: all 0.15s;
    position: relative; line-height: 1; text-align: center;
  }
  .task-card .task-epic-btn:hover { color: var(--purple); }
  .task-card:last-child { border-bottom: none; }
  .task-card:hover { background: rgba(255,255,255,0.02); }
  .task-card.sortable-ghost { opacity: 0.4; background: rgba(88,166,255,0.1); }
  .task-card.sortable-chosen { background: rgba(88,166,255,0.05); }
  .task-card.expanded { background: rgba(255,255,255,0.02); }

  .drag-handle, .ms-drag-handle { color: var(--text-dim); cursor: grab; font-size: 14px; }
  .task-id {
    font-family: monospace; font-size: 13px; color: var(--accent); font-weight: 600;
    cursor: pointer; position: relative;
  }
  .task-id:hover { text-decoration: underline; }
  .task-id .copy-hint {
    display: none; position: absolute; top: -24px; left: 50%; transform: translateX(-50%);
    background: var(--border); color: var(--text); padding: 2px 6px; border-radius: 4px;
    font-size: 10px; white-space: nowrap; pointer-events: none;
  }
  .task-id:hover .copy-hint { display: block; }
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
  .task-detail .load-btn, .task-detail .copy-details-btn, .task-detail .gen-prompt-btn, .task-detail .open-editor-btn {
    background: none; border: 1px solid var(--border); color: var(--accent);
    padding: 4px 12px; border-radius: 4px; cursor: pointer; font-size: 12px;
    margin-top: 4px;
  }
  .task-detail .load-btn:hover, .task-detail .copy-details-btn:hover, .task-detail .gen-prompt-btn:hover, .task-detail .open-editor-btn:hover {
    border-color: var(--accent); background: rgba(88,166,255,0.05);
  }
  .task-detail .gen-prompt-btn { color: var(--green); border-color: var(--green); }
  .task-detail .gen-prompt-btn:hover { background: rgba(63,185,80,0.1); }
  .task-detail .open-editor-btn { color: #f0883e; border-color: #f0883e; }
  .task-detail .open-editor-btn:hover { background: rgba(240,136,62,0.1); }
  .detail-actions { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }

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

  .migr-badge {
    font-size: 10px; font-weight: 700; padding: 1px 5px; border-radius: 3px;
    white-space: nowrap; letter-spacing: 0.5px;
    background: rgba(210,153,34,0.18); color: var(--yellow); border: 1px solid rgba(210,153,34,0.3);
  }

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
    <button class="btn" id="sort-btn" title="Sort tasks by priority (highest first) within each milestone">Sort by Pri</button>
  </div>
  <span class="status saved" id="status">Saved</span>
  <button class="btn" id="reload-btn">Reload</button>
</header>

<main id="app"></main>

<div class="toast" id="toast">Saved!</div>

<script>
let data = [];
let saving = false;
let pendingSave = false;
let collapseState = {}; // {msId: bool, epicId: bool} — persists across renders

function slugify(text) {
  return text.toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s-]+/g, '-')
    .replace(/^-|-$/g, '');
}

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

function updateStatus(state) {
  const el = document.getElementById('status');
  el.className = 'status ' + state;
  if (state === 'saved') el.textContent = 'Saved';
  else if (state === 'saving') el.textContent = 'Saving...';
  else el.textContent = 'Save failed';
}

async function autoSave() {
  if (saving) { pendingSave = true; return; }
  saving = true;
  updateStatus('saving');
  try {
    const resp = await fetch('/api/save', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(data)
    });
    if (resp.ok) {
      updateStatus('saved');
    } else {
      updateStatus('error');
      showToast('Save failed: ' + await resp.text(), true);
    }
  } catch(e) {
    updateStatus('error');
    showToast('Save failed: ' + e.message, true);
  } finally {
    saving = false;
    if (pendingSave) { pendingSave = false; autoSave(); }
  }
}

// Group tasks into a list of items: standalone tasks and epic groups
function groupTasksWithEpics(tasks) {
  const items = [];
  let i = 0;
  while (i < tasks.length) {
    const t = tasks[i];
    if (t._is_epic_header) {
      const epicId = t._epic_id;
      const epicGroup = {
        type: 'epic',
        epicId: epicId,
        epicName: t._epic_name || t.name,
        epicLink: t._epic_link || t.link,
        epicDesc: t.description || '',
        header: t,
        children: []
      };
      i++;
      while (i < tasks.length && tasks[i]._epic_id === epicId && !tasks[i]._is_epic_header) {
        epicGroup.children.push(tasks[i]);
        i++;
      }
      items.push(epicGroup);
    } else {
      items.push({ type: 'task', task: t });
      i++;
    }
  }
  return items;
}

// Build a task card element (reused for standalone and epic children)
function buildTaskCard(t, ms) {
  const card = document.createElement('div');
  card.className = 'task-card';
  card.dataset.taskId = t.id;

  const impact = t.impact || '';
  const cmplx = t.complexity || '';
  const pri = t.pri || '';
  const needsMigr = (t.migr || '').includes('x');

  card.innerHTML = `
    <span class="drag-handle">&#9776;</span>
    <span class="task-id" title="Click to copy"><span class="copy-hint">Click to copy</span>${esc(t.id)}</span>
    <span class="task-name">${esc(t.name)}${needsMigr ? ' <span class="migr-badge" title="Requires DB migration">DB</span>' : ''}</span>
    <span class="badge ${statusClass(t.status)}">${esc(t.status || 'TODO')}</span>
    <span class="meta" title="Priority">${esc(pri)}</span>
    <span class="meta meta-extra" title="Impact">${impact ? 'I:' + esc(impact) : ''}</span>
    <span class="meta meta-extra" title="Complexity">${cmplx ? 'C:' + esc(cmplx) : ''}</span>
    <button class="task-epic-btn" title="Move to epic">&#8618;</button>
    <button class="delete-btn" title="Delete task">&times;</button>
    <div class="task-detail">
      <p class="detail-desc">${esc(t.description || 'No description.')}</p>
      <div class="detail-meta">
        ${impact ? '<span>Impact: ' + esc(impact) + '</span>' : ''}
        ${cmplx ? '<span>Complexity: ' + esc(cmplx) + '</span>' : ''}
        ${pri ? '<span>Priority: ' + esc(pri) + '</span>' : ''}
      </div>
      ${t.link ? '<div class="detail-content">Click "Load details" to view task file</div>' : ''}
      <div class="detail-actions">
        ${t.link ? '<button class="open-editor-btn" title="Open in Notepad++">&#9998; Edit</button>' : ''}
        ${t.link ? '<button class="load-btn">Load details</button>' : ''}
        ${t.link ? '<button class="copy-details-btn">Copy details</button>' : ''}
        ${t.link ? '<button class="gen-prompt-btn">Copy kickoff prompt</button>' : ''}
      </div>
    </div>
  `;

  card.querySelector('.delete-btn').onclick = (e) => {
    e.stopPropagation();
    if (!confirm(`Delete ${t.id} "${t.name}"?`)) return;
    const realIdx = ms.tasks.findIndex(x => x.id === t.id);
    if (realIdx >= 0) ms.tasks.splice(realIdx, 1);
    render();
    autoSave();
  };

  card.querySelector('.task-epic-btn').onclick = (e) => {
    e.stopPropagation();
    showTaskEpicDropdown(e.currentTarget, t, ms);
  };

  card.querySelector('.task-id').onclick = (e) => {
    e.stopPropagation();
    copyToClipboard(t.id, e.currentTarget);
  };

  card.addEventListener('click', (e) => {
    if (e.target.closest('.drag-handle') || e.target.closest('.delete-btn') || e.target.closest('.task-epic-btn') || e.target.closest('.load-btn') || e.target.closest('.task-id') || e.target.closest('.copy-details-btn') || e.target.closest('.gen-prompt-btn') || e.target.closest('.open-editor-btn')) return;
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

  const copyDetailsBtn = card.querySelector('.copy-details-btn');
  if (copyDetailsBtn) {
    copyDetailsBtn.onclick = async (e) => {
      e.stopPropagation();
      const content = await fetchTaskContent(t.link);
      if (content) {
        const text = `## ${t.id}: ${t.name}\n\n${content}`;
        copyToClipboard(text, copyDetailsBtn);
      }
    };
  }

  const genPromptBtn = card.querySelector('.gen-prompt-btn');
  if (genPromptBtn) {
    genPromptBtn.onclick = async (e) => {
      e.stopPropagation();
      genPromptBtn.textContent = 'Loading...';
      const content = await fetchTaskContent(t.link);
      if (content) {
        const prompt = buildKickoffPrompt(t.id, t.name, content);
        copyToClipboard(prompt, genPromptBtn);
        genPromptBtn.textContent = 'Copied!';
        setTimeout(() => { genPromptBtn.textContent = 'Copy kickoff prompt'; }, 2000);
      } else {
        genPromptBtn.textContent = 'Failed to load';
        setTimeout(() => { genPromptBtn.textContent = 'Copy kickoff prompt'; }, 2000);
      }
    };
  }

  const openEditorBtn = card.querySelector('.open-editor-btn');
  if (openEditorBtn) {
    openEditorBtn.onclick = async (e) => {
      e.stopPropagation();
      try {
        const resp = await fetch('/api/open-file', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({path: t.link})
        });
        if (!resp.ok) {
          const d = await resp.json();
          showToast(d.error || 'Failed to open file');
        }
      } catch(e) {
        showToast('Error: ' + e.message);
      }
    };
  }

  return card;
}

function isTaskHidden(t) {
  const hideDone = document.getElementById('hide-done').checked;
  const hideIce = document.getElementById('hide-ice').checked;
  const st = (t.status || '').toLowerCase();
  if (hideDone && st === 'done') return true;
  if (hideIce && (st === 'ice' || st === 'obsolete')) return true;
  return false;
}

// Inline edit: replace element text with input, call cb on commit
function startInlineEdit(el, currentText, onCommit) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'inline-edit';
  input.value = currentText;
  const origText = el.textContent;
  el.textContent = '';
  el.appendChild(input);
  input.focus();
  input.select();

  function commit() {
    const newVal = input.value.trim();
    el.textContent = newVal || origText;
    if (newVal && newVal !== currentText) onCommit(newVal);
  }
  function cancel() { el.textContent = origText; }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });
  input.addEventListener('blur', commit);
}

// Add a new epic header to a milestone
function addEpicHeader(msIdx) {
  const name = prompt('Epic name:');
  if (!name || !name.trim()) return;
  const slug = slugify(name.trim());
  const link = 'tasks/' + slug + '/EPIC.md';
  const rawTask = '**[' + name.trim() + '](' + link + ')**';
  const epicId = slug;

  const ms = data[msIdx];
  const epicHeader = {
    id: '',
    name: name.trim(),
    link: link,
    status: '',
    pri: '',
    impact: '',
    complexity: '',
    description: '',
    migr: '',
    _raw_task: rawTask,
    _is_epic_header: true,
    _epic_id: epicId,
    _epic_name: name.trim(),
    _epic_link: link,
  };
  ms.tasks.push(epicHeader);
  render();
  autoSave();
}

// Rename an epic header
function renameEpic(ms, epicId, newName) {
  const newEpicId = slugify(newName);
  ms.tasks.forEach(t => {
    if (t._epic_id === epicId) {
      t._epic_id = newEpicId;
    }
    if (t._is_epic_header && t._epic_id === newEpicId) {
      t._epic_name = newName;
      t.name = newName;
      t._raw_task = '**[' + newName + '](' + t._epic_link + ')**';
    }
  });
  render();
  autoSave();
}

// Delete an epic header (children become standalone)
function deleteEpicHeader(ms, epicId) {
  if (!confirm('Remove this epic header? Tasks will become standalone.')) return;
  // Remove epic header
  const headerIdx = ms.tasks.findIndex(t => t._is_epic_header && t._epic_id === epicId);
  if (headerIdx >= 0) ms.tasks.splice(headerIdx, 1);
  // Make children standalone
  ms.tasks.forEach(t => {
    if (t._epic_id === epicId) {
      delete t._epic_id;
      t._raw_task = t._raw_task.replace(/^[↳]\s*/, '');
    }
  });
  render();
  autoSave();
}

function showMoveDropdown(btnEl, currentMs, epicId) {
  // Close any existing dropdown
  document.querySelectorAll('.move-dropdown').forEach(d => d.remove());

  const dropdown = document.createElement('div');
  dropdown.className = 'move-dropdown';

  data.forEach((ms, idx) => {
    // Only show milestones that are visible on the page
    const visibleTasks = ms.tasks.filter(t => !t._is_epic_header && !isTaskHidden(t));
    const hasEmptyEpics = groupTasksWithEpics(ms.tasks).some(item =>
      item.type === 'epic' && item.children.length === 0
    );
    if (visibleTasks.length === 0 && !hasEmptyEpics && ms.id !== currentMs.id) return;

    const btn = document.createElement('button');
    btn.className = 'move-dropdown-item' + (ms.id === currentMs.id ? ' current' : '');
    btn.textContent = ms.name;
    if (ms.id !== currentMs.id) {
      btn.onclick = (e) => {
        e.stopPropagation();
        dropdown.remove();
        moveEpicToMilestone(currentMs, ms, epicId);
      };
    }
    dropdown.appendChild(btn);
  });

  btnEl.style.position = 'relative';
  btnEl.appendChild(dropdown);

  // Close on outside click
  const close = (e) => {
    if (!dropdown.contains(e.target) && e.target !== btnEl) {
      dropdown.remove();
      document.removeEventListener('click', close, true);
    }
  };
  setTimeout(() => document.addEventListener('click', close, true), 0);
}

function reorderEpic(ms, epicId, dir) {
  const grouped = groupTasksWithEpics(ms.tasks);
  const visItems = grouped.filter(item => {
    if (item.type === 'epic') {
      const vc = item.children.filter(c => !isTaskHidden(c));
      return vc.length > 0 || item.children.length === 0;
    }
    return !isTaskHidden(item.task);
  });
  const myPos = visItems.findIndex(g => g.type === 'epic' && g.epicId === epicId);
  if (myPos < 0) return;
  const swapPos = dir === 'up' ? myPos - 1 : myPos + 1;
  if (swapPos < 0 || swapPos >= visItems.length) return;

  const myItem = visItems[myPos];
  const swapItem = visItems[swapPos];

  // Find actual positions in ms.tasks array
  const myHeaderIdx = ms.tasks.findIndex(t => t._is_epic_header && t._epic_id === epicId);
  let myEndIdx = myHeaderIdx + 1;
  while (myEndIdx < ms.tasks.length && ms.tasks[myEndIdx]._epic_id === epicId && !ms.tasks[myEndIdx]._is_epic_header) myEndIdx++;
  const myTasks = ms.tasks.splice(myHeaderIdx, myEndIdx - myHeaderIdx);

  // After splice, find where to insert
  let targetIdx;
  if (swapItem.type === 'epic') {
    targetIdx = ms.tasks.findIndex(t => t._is_epic_header && t._epic_id === swapItem.epicId);
    if (dir === 'down') {
      // Insert after the swap epic's last child
      let end = targetIdx + 1;
      while (end < ms.tasks.length && ms.tasks[end]._epic_id === swapItem.epicId && !ms.tasks[end]._is_epic_header) end++;
      targetIdx = end;
    }
  } else {
    targetIdx = ms.tasks.findIndex(t => t.id === swapItem.task.id);
    if (dir === 'down') targetIdx++;
  }
  if (targetIdx < 0) targetIdx = ms.tasks.length;
  ms.tasks.splice(targetIdx, 0, ...myTasks);
  render();
  autoSave();
}

function moveEpicToMilestone(fromMs, toMs, epicId) {
  const epicTasks = fromMs.tasks.filter(t => t._epic_id === epicId);
  if (epicTasks.length === 0) return;
  fromMs.tasks = fromMs.tasks.filter(t => t._epic_id !== epicId);
  toMs.tasks.push(...epicTasks);
  render();
  autoSave();
}

function showTaskEpicDropdown(btnEl, task, ms) {
  document.querySelectorAll('.move-dropdown').forEach(d => d.remove());

  const grouped = groupTasksWithEpics(ms.tasks);
  const epics = grouped.filter(g => {
    if (g.type !== 'epic') return false;
    const visChildren = g.children.filter(c => !isTaskHidden(c));
    return visChildren.length > 0 || g.children.length === 0;
  });
  if (epics.length === 0) return;

  const dropdown = document.createElement('div');
  dropdown.className = 'move-dropdown';

  // "Standalone" option (remove from epic)
  if (task._epic_id) {
    const btn = document.createElement('button');
    btn.className = 'move-dropdown-item';
    btn.textContent = '— Standalone (no epic)';
    btn.onclick = (e) => {
      e.stopPropagation();
      dropdown.remove();
      moveTaskToEpic(task, ms, null);
    };
    dropdown.appendChild(btn);
  }

  epics.forEach(epic => {
    const btn = document.createElement('button');
    btn.className = 'move-dropdown-item' + (task._epic_id === epic.epicId ? ' current' : '');
    btn.textContent = epic.epicName;
    if (task._epic_id !== epic.epicId) {
      btn.onclick = (e) => {
        e.stopPropagation();
        dropdown.remove();
        moveTaskToEpic(task, ms, epic.epicId);
      };
    }
    dropdown.appendChild(btn);
  });

  btnEl.style.position = 'relative';
  btnEl.appendChild(dropdown);

  const close = (e) => {
    if (!dropdown.contains(e.target) && e.target !== btnEl) {
      dropdown.remove();
      document.removeEventListener('click', close, true);
    }
  };
  setTimeout(() => document.addEventListener('click', close, true), 0);
}

function moveTaskToEpic(task, ms, targetEpicId) {
  const taskIdx = ms.tasks.findIndex(t => t.id === task.id);
  if (taskIdx < 0) return;
  const [removed] = ms.tasks.splice(taskIdx, 1);

  if (targetEpicId) {
    if (!removed._raw_task.startsWith('↳')) removed._raw_task = '↳ ' + removed._raw_task;
    removed._epic_id = targetEpicId;
    // Insert after last child of target epic
    const headerIdx = ms.tasks.findIndex(t => t._is_epic_header && t._epic_id === targetEpicId);
    let insertIdx = headerIdx + 1;
    while (insertIdx < ms.tasks.length && ms.tasks[insertIdx]._epic_id === targetEpicId && !ms.tasks[insertIdx]._is_epic_header) insertIdx++;
    ms.tasks.splice(insertIdx, 0, removed);
  } else {
    removed._raw_task = removed._raw_task.replace(/^[↳]\s*/, '');
    delete removed._epic_id;
    ms.tasks.push(removed);
  }

  render();
  autoSave();
}

// Rename a milestone
function renameMilestone(msIdx, newName) {
  data[msIdx].name = newName;
  render();
  autoSave();
}

// Handler for dragging entire epic groups between milestones or reordering within one
function handleEpicDrag(evt) {
  const epicEl = evt.item;
  const fromMsId = evt.from.dataset.msId;
  const toMsId = evt.to.dataset.msId;
  const fromMs = data.find(m => m.id === fromMsId);
  const toMs = data.find(m => m.id === toMsId);
  if (!fromMs || !toMs) return;
  if (fromMs === toMs && evt.oldIndex === evt.newIndex) return;

  const epicId = epicEl.dataset.epicId;
  // Extract all tasks belonging to this epic (header + children)
  const epicTasks = fromMs.tasks.filter(t => t._epic_id === epicId);
  if (epicTasks.length === 0) return;
  fromMs.tasks = fromMs.tasks.filter(t => t._epic_id !== epicId);

  // Figure out where to insert in the target milestone's tasks array
  // evt.newIndex is the DOM position among visible top-level items (task-cards + epic-groups)
  const grouped = groupTasksWithEpics(toMs.tasks);
  let visCount = 0;
  let insertIdx = toMs.tasks.length;
  for (const item of grouped) {
    if (item.type === 'epic') {
      const visibleChildren = item.children.filter(c => !isTaskHidden(c));
      if (visibleChildren.length === 0 && item.children.length > 0) continue;
    } else {
      if (isTaskHidden(item.task)) continue;
    }
    if (visCount === evt.newIndex) {
      if (item.type === 'epic') {
        insertIdx = toMs.tasks.findIndex(t => t._is_epic_header && t._epic_id === item.epicId);
      } else {
        insertIdx = toMs.tasks.findIndex(t => t.id === item.task.id);
      }
      if (insertIdx < 0) insertIdx = toMs.tasks.length;
      break;
    }
    visCount++;
  }
  toMs.tasks.splice(insertIdx, 0, ...epicTasks);
  render();
  autoSave();
}

// Unified handler for task drag between any containers (epic-children or milestone-level)
function handleTaskDrag(evt) {
  const el = evt.item;
  const fromContainer = evt.from;
  const toContainer = evt.to;
  if (fromContainer === toContainer && evt.oldIndex === evt.newIndex) return;

  const fromMsEl = fromContainer.closest('.task-list') || fromContainer;
  const toMsEl = toContainer.closest('.task-list') || toContainer;
  const fromMsId = fromMsEl.dataset.msId;
  const toMsId = toMsEl.dataset.msId;
  const fromEpicId = fromContainer.dataset.epicId || null;
  const toEpicId = toContainer.dataset.epicId || null;
  const fromMs = data.find(m => m.id === fromMsId);
  const toMs = data.find(m => m.id === toMsId);
  if (!fromMs || !toMs) return;

  const taskId = el.dataset.taskId;
  const taskIdx = fromMs.tasks.findIndex(t => t.id === taskId);
  if (taskIdx < 0) return;
  const [task] = fromMs.tasks.splice(taskIdx, 1);

  // Update epic membership
  if (toEpicId && !fromEpicId) {
    if (!task._raw_task.startsWith('↳')) task._raw_task = '↳ ' + task._raw_task;
    task._epic_id = toEpicId;
  } else if (!toEpicId && fromEpicId) {
    task._raw_task = task._raw_task.replace(/^[↳]\s*/, '');
    delete task._epic_id;
  } else if (toEpicId && fromEpicId && toEpicId !== fromEpicId) {
    task._epic_id = toEpicId;
  }

  // Calculate insert position
  if (toEpicId) {
    const epicHeaderIdx = toMs.tasks.findIndex(t => t._is_epic_header && t._epic_id === toEpicId);
    if (epicHeaderIdx < 0) { toMs.tasks.push(task); }
    else {
      let childStart = epicHeaderIdx + 1;
      let childEnd = childStart;
      while (childEnd < toMs.tasks.length && toMs.tasks[childEnd]._epic_id === toEpicId && !toMs.tasks[childEnd]._is_epic_header) childEnd++;
      let visCount = 0;
      let insertIdx = childEnd;
      for (let k = childStart; k < childEnd; k++) {
        if (!isTaskHidden(toMs.tasks[k])) {
          if (visCount === evt.newIndex) { insertIdx = k; break; }
          visCount++;
        }
      }
      toMs.tasks.splice(insertIdx, 0, task);
    }
  } else {
    const insertIdx = getInsertIndex(toMs, evt.newIndex);
    toMs.tasks.splice(insertIdx, 0, task);
  }

  render();
  autoSave();
}

function render() {
  const app = document.getElementById('app');
  app.innerHTML = '';

  data.forEach((ms, msIdx) => {
    const div = document.createElement('div');
    div.className = 'milestone';
    div.dataset.msIdx = msIdx;

    // Filter: count visible tasks (non-epic-header, not hidden)
    const visibleTasks = ms.tasks.filter(t => !t._is_epic_header && !isTaskHidden(t));
    const hasEmptyEpics = groupTasksWithEpics(ms.tasks).some(item =>
      item.type === 'epic' && item.children.length === 0
    );
    if (visibleTasks.length === 0 && !hasEmptyEpics) return;

    const msCollapsed = collapseState['ms-' + ms.id];

    // Header
    const hdr = document.createElement('div');
    hdr.className = 'milestone-header';
    hdr.innerHTML = `
      <span class="arrow${msCollapsed ? ' collapsed' : ''}">&#9660;</span>
      <h2>${esc(ms.name)}</h2>
      <span class="count">${visibleTasks.length}</span>
    `;
    const h2 = hdr.querySelector('h2');
    h2.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      startInlineEdit(h2, ms.name, (newName) => renameMilestone(msIdx, newName));
    });
    hdr.onclick = (e) => {
      if (e.target.closest('input')) return;
      const list = div.querySelector('.task-list');
      const arrow = hdr.querySelector('.arrow');
      list.classList.toggle('collapsed');
      arrow.classList.toggle('collapsed');
      collapseState['ms-' + ms.id] = list.classList.contains('collapsed');
    };
    div.appendChild(hdr);

    // Task list
    const list = document.createElement('div');
    list.className = 'task-list' + (msCollapsed ? ' collapsed' : '');
    list.dataset.msId = ms.id;

    const grouped = groupTasksWithEpics(ms.tasks);
    // Count visible top-level items for up/down button state
    const visibleItems = grouped.filter(item => {
      if (item.type === 'epic') {
        const vc = item.children.filter(c => !isTaskHidden(c));
        return vc.length > 0 || item.children.length === 0;
      }
      return !isTaskHidden(item.task);
    });
    let visIdx = 0;

    grouped.forEach(item => {
      if (item.type === 'epic') {
        const visibleChildren = item.children.filter(c => !isTaskHidden(c));
        if (visibleChildren.length === 0 && item.children.length > 0) return;

        const myIdx = visIdx++;
        const isFirst = myIdx === 0;
        const isLast = myIdx === visibleItems.length - 1;
        const epicCollapsed = collapseState['epic-' + item.epicId];
        const epicDiv = document.createElement('div');
        epicDiv.className = 'epic-group';
        epicDiv.dataset.epicId = item.epicId;

        const epicHdr = document.createElement('div');
        epicHdr.className = 'epic-header';
        epicHdr.innerHTML = `
          <button class="epic-reorder-btn" data-dir="up" title="Move up" ${isFirst ? 'disabled' : ''}>&#9650;</button>
          <button class="epic-reorder-btn" data-dir="down" title="Move down" ${isLast ? 'disabled' : ''}>&#9660;</button>
          <span class="epic-icon">&#9671;</span>
          <span class="epic-name">${esc(item.epicName)}</span>
          <span class="epic-desc">${esc(item.epicDesc)}</span>
          ${visibleChildren.length > 0 ? '<span class="epic-count">' + visibleChildren.length + '</span>' : ''}
          <button class="epic-move-btn" title="Move to another milestone">&#8618;</button>
          <button class="epic-delete-btn" title="Remove epic header">&times;</button>
        `;
        const epicNameEl = epicHdr.querySelector('.epic-name');
        epicNameEl.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          startInlineEdit(epicNameEl, item.epicName, (newName) => renameEpic(ms, item.epicId, newName));
        });
        epicHdr.querySelectorAll('.epic-reorder-btn').forEach(btn => {
          btn.onclick = (e) => {
            e.stopPropagation();
            reorderEpic(ms, item.epicId, btn.dataset.dir);
          };
        });
        epicHdr.querySelector('.epic-move-btn').onclick = (e) => {
          e.stopPropagation();
          showMoveDropdown(e.currentTarget, ms, item.epicId);
        };
        epicHdr.querySelector('.epic-delete-btn').onclick = (e) => {
          e.stopPropagation();
          deleteEpicHeader(ms, item.epicId);
        };
        epicHdr.onclick = (e) => {
          if (e.target.closest('.epic-reorder-btn') || e.target.closest('.epic-delete-btn') || e.target.closest('.epic-move-btn') || e.target.closest('input') || e.target.closest('.move-dropdown')) return;
          const childList = epicDiv.querySelector('.epic-children');
          const arrow = epicHdr.querySelector('.epic-arrow');
          childList.classList.toggle('collapsed');
          arrow.classList.toggle('collapsed');
          collapseState['epic-' + item.epicId] = childList.classList.contains('collapsed');
        };
        epicDiv.appendChild(epicHdr);

        const childList = document.createElement('div');
        childList.className = 'epic-children' + (epicCollapsed ? ' collapsed' : '');
        childList.dataset.epicId = item.epicId;
        childList.dataset.msId = ms.id;
        if (visibleChildren.length === 0) {
          const empty = document.createElement('div');
          empty.className = 'empty-state';
          empty.textContent = 'Drag tasks here';
          childList.appendChild(empty);
        } else {
          visibleChildren.forEach(c => {
            childList.appendChild(buildTaskCard(c, ms));
          });
        }
        epicDiv.appendChild(childList);

        // Sortable: reorder tasks within this epic
        new Sortable(childList, {
          group: 'epic-tasks',
          animation: 150,
          handle: '.drag-handle',
          filter: '.empty-state',
          ghostClass: 'sortable-ghost',
          chosenClass: 'sortable-chosen',
          onEnd: handleTaskDrag
        });

        list.appendChild(epicDiv);
      } else {
        const t = item.task;
        if (isTaskHidden(t)) { return; }
        visIdx++;
        const card = buildTaskCard(t, ms);
        card.querySelector('.drag-handle').classList.add('ms-drag-handle');
        list.appendChild(card);
      }
    });

    // Add epic button
    const addBtn = document.createElement('button');
    addBtn.className = 'add-epic-btn';
    addBtn.textContent = '+ Add Epic';
    addBtn.onclick = () => addEpicHeader(msIdx);
    list.appendChild(addBtn);

    div.appendChild(list);
    app.appendChild(div);

    // Milestone-level Sortable (standalone tasks only; epics use up/down buttons)
    new Sortable(list, {
      group: 'milestone-items',
      animation: 150,
      handle: '.ms-drag-handle',
      filter: '.add-epic-btn, .epic-group',
      preventOnFilter: false,
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      draggable: '> .task-card',
      onEnd: handleTaskDrag
    });
  });
}

// Convert a visible index to a real index in ms.tasks
function getInsertIndex(ms, visibleIdx) {
  const grouped = groupTasksWithEpics(ms.tasks);
  let visCount = 0;
  let realIdx = ms.tasks.length;

  for (const item of grouped) {
    if (item.type === 'epic') {
      const visibleChildren = item.children.filter(c => !isTaskHidden(c));
      if (visibleChildren.length === 0) continue;
      if (visCount === visibleIdx) {
        realIdx = ms.tasks.findIndex(t => t._is_epic_header && t._epic_id === item.epicId);
        if (realIdx < 0) realIdx = ms.tasks.length;
        return realIdx;
      }
      visCount++;
    } else {
      if (isTaskHidden(item.task)) continue;
      if (visCount === visibleIdx) {
        realIdx = ms.tasks.findIndex(t => t.id === item.task.id);
        if (realIdx < 0) realIdx = ms.tasks.length;
        return realIdx;
      }
      visCount++;
    }
  }
  return realIdx;
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

function copyToClipboard(text, el) {
  navigator.clipboard.writeText(text).then(() => {
    showToast('Copied to clipboard!');
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('Copied to clipboard!');
  });
}

function showToast(msg, isError) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = 'toast show' + (isError ? ' error' : '');
  setTimeout(() => { toast.className = 'toast'; }, 2000);
}

async function fetchTaskContent(link) {
  try {
    const resp = await fetch('/api/task-file?path=' + encodeURIComponent(link));
    if (resp.ok) {
      const d = await resp.json();
      return d.content;
    }
  } catch(e) {}
  return null;
}

function buildKickoffPrompt(id, name, taskContent) {
  return `Create a detailed kickoff prompt I can use in a fresh AI session to implement the following task. Read CLAUDE.md for project context, coding standards, and workflow rules.

## Task: ${id} -- ${name}

${taskContent}`;
}

async function load() {
  const resp = await fetch('/api/tasks');
  data = await resp.json();
  updateStatus('saved');
  render();
}

document.getElementById('reload-btn').onclick = () => { load(); };

document.getElementById('hide-done').onchange = render;
document.getElementById('hide-ice').onchange = render;

// Sort by priority within each milestone (epics stay grouped)
function sortByPri() {
  data.forEach(ms => {
    const grouped = groupTasksWithEpics(ms.tasks);
    grouped.sort((a, b) => {
      const priA = a.type === 'epic'
        ? Math.max(...a.children.map(c => parseFloat(c.pri) || 0), 0)
        : (parseFloat(a.task.pri) || 0);
      const priB = b.type === 'epic'
        ? Math.max(...b.children.map(c => parseFloat(c.pri) || 0), 0)
        : (parseFloat(b.task.pri) || 0);
      return priB - priA;
    });
    const newTasks = [];
    grouped.forEach(item => {
      if (item.type === 'epic') {
        newTasks.push(item.header);
        const sorted = [...item.children].sort((a, b) => (parseFloat(b.pri) || 0) - (parseFloat(a.pri) || 0));
        newTasks.push(...sorted);
      } else {
        newTasks.push(item.task);
      }
    });
    ms.tasks = newTasks;
  });
  render();
  autoSave();
}

document.getElementById('sort-btn').onclick = sortByPri;

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
                    task_data = {
                        'id': t.get('id', ''),
                        'name': t.get('name', ''),
                        'link': t.get('link', ''),
                        'status': t.get('status', ''),
                        'pri': t.get('pri', ''),
                        'impact': t.get('impact', ''),
                        'complexity': t.get('complexity', ''),
                        'description': t.get('description', ''),
                        'migr': t.get('migr', ''),
                        '_raw_task': t.get('_raw_task', ''),
                    }
                    if t.get('_is_epic_header'):
                        task_data['_is_epic_header'] = True
                        task_data['_epic_id'] = t['_epic_id']
                        task_data['_epic_name'] = t['_epic_name']
                        task_data['_epic_link'] = t['_epic_link']
                        # Strip markdown bold from epic description
                        desc = task_data.get('description', '')
                        task_data['description'] = re.sub(r'\*\*(.+?)\*\*', r'\1', desc)
                    elif t.get('_epic_id'):
                        task_data['_epic_id'] = t['_epic_id']
                    tasks.append(task_data)
                result.append({
                    'id': ms['id'],
                    'name': ms['name'],
                    'tasks': tasks,
                    '_name_parts': [h['text'] for h in ms.get('_section_headers', [])],
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
        elif self.path == '/api/open-file':
            length = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(length))
            rel_path = body.get('path', '')
            if not rel_path:
                self._json(400, {'error': 'Missing path'})
                return
            plan_dir = os.path.dirname(PLAN_PATH)
            file_path = os.path.normpath(os.path.join(plan_dir, rel_path))
            project_root = os.path.dirname(plan_dir)
            if not file_path.startswith(project_root):
                self._json(403, {'error': 'Access denied'})
                return
            if not os.path.isfile(file_path):
                self._json(404, {'error': 'File not found'})
                return
            editor = shutil.which('notepad++') or shutil.which('notepad')
            if not editor:
                for candidate in [
                    r'C:\Program Files\Notepad++\notepad++.exe',
                    r'C:\Program Files (x86)\Notepad++\notepad++.exe',
                ]:
                    if os.path.isfile(candidate):
                        editor = candidate
                        break
            if not editor:
                editor = 'notepad'
            subprocess.Popen([editor, file_path])
            self._json(200, {'ok': True})
        else:
            self.send_error(404)


# --- Main ---

def kill_existing():
    """Kill any existing task-manager process on our port."""
    import subprocess
    try:
        out = subprocess.check_output(
            ['netstat', '-ano'], text=True, stderr=subprocess.DEVNULL
        )
        pids = set()
        for line in out.splitlines():
            if f':{PORT}' in line and 'LISTENING' in line:
                parts = line.split()
                if parts:
                    try:
                        pids.add(int(parts[-1]))
                    except ValueError:
                        pass
        my_pid = os.getpid()
        for pid in pids:
            if pid != my_pid and pid > 0:
                subprocess.run(['taskkill', '/PID', str(pid), '/F'],
                               capture_output=True)
    except Exception:
        pass

if __name__ == '__main__':
    kill_existing()
    print(f"Task Manager serving PLAN.md: {PLAN_PATH}")
    print(f"Open http://localhost:{PORT}")
    server = HTTPServer(('127.0.0.1', PORT), Handler)
    webbrowser.open(f'http://localhost:{PORT}')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
