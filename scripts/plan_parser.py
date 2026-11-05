"""PLAN.md table parser shared by the task board (task-manager.py) and the roadmap export
(export_roadmap.py, T14920). Standard library only; importing it has no side effects.

Moved verbatim out of task-manager.py (T14920, mechanical move); the behaviour is the board's.
"""
import re


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
