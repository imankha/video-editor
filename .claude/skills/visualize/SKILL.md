---
name: visualize
description: "Launch browser-based visualization for diagrams, charts, and sequence diagrams"
license: MIT
author: video-editor
version: 1.0.0
user_invocable: true
---

# Visualize

Render diagrams, charts, tables, and rich text in a browser UI. Use this whenever a visual would communicate more effectively than plain text — especially for code flow, architecture, data relationships, and metrics.

## When to Apply

**Proactively use this skill whenever a visualization would help the user understand:**
- How code works (sequence diagrams, flowcharts)
- Architecture and data flow (component diagrams, class diagrams)
- State machines and transitions (state diagrams)
- Performance or metrics (bar/line/pie charts)
- Data comparisons (tables, charts)
- Request/response flows (sequence diagrams)
- Database relationships (ER diagrams)
- Git branch flows (gitgraph diagrams)

**Trigger phrases:**
- "show me how this works"
- "explain the flow"
- "visualize", "diagram", "chart", "graph"
- "how does X call Y"
- "what's the architecture"
- Any question where the answer has sequential steps, relationships, or data

## What It Does

1. Claude writes a JSON spec to `$TEMP/viz-data.json` (or `/tmp/viz-data.json`)
2. Launches a Python server on port 8091
3. Opens a browser with rendered panels (Mermaid diagrams, Chart.js charts, tables, text)

## Data Format

Write to `$TEMP/viz-data.json` (Windows) or `/tmp/viz-data.json` (Unix):

```json
{
  "title": "Page Title",
  "layout": "stack",
  "panels": [
    {
      "type": "mermaid",
      "title": "Panel Title",
      "content": "sequenceDiagram\n    Browser->>+API: POST /upload\n    API->>+Storage: save(file)\n    Storage-->>-API: url\n    API-->>-Browser: {url}"
    },
    {
      "type": "chart",
      "title": "Chart Title",
      "config": {
        "type": "bar",
        "data": {
          "labels": ["A", "B", "C"],
          "datasets": [{"label": "Count", "data": [10, 20, 15], "backgroundColor": ["#58a6ff", "#3fb950", "#d29922"]}]
        }
      }
    },
    {
      "type": "table",
      "title": "Table Title",
      "headers": ["Col 1", "Col 2"],
      "rows": [["a", "b"], ["c", "d"]]
    },
    {
      "type": "text",
      "title": "Notes",
      "content": "## Markdown supported\n- bullet 1\n- bullet 2\n`code` and **bold**"
    }
  ]
}
```

### Panel Types

| Type | Engine | Use For |
|------|--------|---------|
| `mermaid` | Mermaid.js v11 | Sequence, flowchart, class, state, ER, gitgraph, pie, gantt, mindmap |
| `chart` | Chart.js v4 | Bar, line, pie, doughnut, radar, scatter, bubble |
| `table` | Native HTML | Data comparisons, feature matrices |
| `text` | Simple markdown | Annotations, explanations alongside diagrams |

### Layout Options

- `"layout": "stack"` — panels stacked vertically (default)
- `"layout": "grid"` — panels in a responsive 2-column grid

### Mermaid Diagram Types (Quick Reference)

```
sequenceDiagram       — request/response flows, function call chains
flowchart TD          — decision trees, process flows, algorithms
classDiagram          — class relationships, module structure
stateDiagram-v2       — state machines, lifecycle
erDiagram             — database schemas, entity relationships
gitgraph              — branch strategies, merge flows
pie                   — proportional data
gantt                 — timelines, schedules
mindmap               — concept maps, brainstorming
```

## How to Launch

```bash
# Write the viz data first (Claude does this), then:

# Windows
cd c:/Users/imank/projects/video-editor && python scripts/visualize.py > /dev/null 2>&1 & disown

# The server auto-opens the browser. To reload with new data, click "Reload" in the UI
# or re-write viz-data.json and the user can refresh.
```

## Best Practices for Claude

1. **Default to sequence diagrams** for explaining how code works — they show the call chain clearly
2. **Combine panel types** — a sequence diagram + a table of the endpoints referenced is better than either alone
3. **Keep mermaid content clean** — avoid overly complex diagrams; split into multiple panels if needed
4. **Use grid layout** for 2-4 small panels that compare things side by side
5. **Always include a title** on each panel
6. **For charts**, use the dark-theme colors: `#58a6ff` (blue), `#3fb950` (green), `#d29922` (yellow), `#f85149` (red), `#bc8cff` (purple)

## Updating Without Relaunch

The server stays running. To show new visualizations:
1. Write new data to the same `$TEMP/viz-data.json` file
2. Tell the user to click "Reload" in the browser (or they can refresh the page)
3. No need to relaunch the server

## Portability

The script uses only Python stdlib. The frontend loads Mermaid.js and Chart.js from CDN.
Works on any machine with Python 3.8+ and a browser.
