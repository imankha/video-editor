---
name: har-analysis
description: "Parse HAR files and analyze web performance — waterfall, slow requests, caching issues, optimization opportunities"
license: MIT
author: video-editor
version: 1.0.0
user_invocable: true
---

# HAR Analysis

Parse HTTP Archive (HAR) files and produce actionable performance insights using the visualize skill for charts and diagrams.

## When to Apply

- User says "analyze this HAR", "speed this up", "why is this slow", "performance", or provides a `.har` file path
- User asks about load times, request waterfalls, caching headers, or transfer sizes

## Procedure

1. **Locate the HAR file**: User provides a path (often in `~/Downloads/`). Verify it exists.

2. **Run the analysis script**:
   ```bash
   /c/Python314/python scripts/har-analysis.py "<path-to-har-file>" --output "$TEMP/har-analysis.json" 2>&1
   ```
   The script writes two files:
   - `$TEMP/har-analysis.json` — structured analysis results
   - `$TEMP/viz-data.json` — visualization panels for the visualize skill

3. **Read the analysis JSON** and present findings to the user:
   - Top slowest requests with timing breakdown (wait vs receive vs blocked)
   - Caching issues (missing Cache-Control, no-store on static assets, missing ETags)
   - Compression gaps (large uncompressed responses)
   - Request waterfall showing parallelism and blocking chains
   - Transfer size breakdown by content type

4. **Launch visualization** (uses the visualize skill's infrastructure):
   ```bash
   cd c:/Users/imank/projects/video-editor && python scripts/visualize.py > /dev/null 2>&1 & disown
   ```

5. **Recommend optimizations** based on findings — prioritized by impact.

## Analysis Categories

| Category | What It Checks |
|----------|---------------|
| **Slow Requests** | Requests >200ms, broken down by wait/receive/blocked/DNS/SSL |
| **Caching** | Missing or weak Cache-Control, no ETag/Last-Modified, no-store on cacheable resources |
| **Compression** | Responses >1KB without Content-Encoding (gzip/br/zstd) |
| **Waterfall** | Sequential chains that could be parallelized, long gaps between requests |
| **Size** | Large responses, breakdown by content type |
| **CORS** | Preflight (OPTIONS) overhead, count and time spent |
| **Redirects** | 3xx chains that add latency |
| **Errors** | 4xx/5xx responses |

## What the Script Outputs

The `har-analysis.json` contains:
```json
{
  "summary": { "total_requests", "total_size_kb", "total_time_ms", "page_load_time_ms" },
  "slow_requests": [...],
  "caching_issues": [...],
  "compression_gaps": [...],
  "waterfall": [...],
  "by_content_type": {...},
  "cors_overhead": {...},
  "recommendations": [...]
}
```

## Without the Script

If the script isn't available, Claude can run inline Python to parse the HAR:

```python
/c/Python314/python -c "
import json
with open('<path>', 'r', encoding='utf-8') as f:
    har = json.load(f)
# ... analysis code ...
"
```

This is acceptable for quick one-off analysis but the script is preferred for consistent output.
