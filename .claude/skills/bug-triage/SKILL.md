---
name: bug
description: "Load a bug report's full context for investigation. Usage: /bug {id}"
license: MIT
author: video-editor
version: 1.1.0
user_invocable: true
---

# Bug Investigation

Load a bug report from Postgres and investigate it in the current session. Usage: `/bug {id}` or `/bug {id} status {new_status}`.

## Bug Lifecycle

Bugs follow the same lifecycle as tasks:

| Bug Status | Display | Meaning |
|------------|---------|---------|
| `new` | TODO | Reported, not yet investigated |
| `testing` | TESTING | AI has investigated and applied a fix; awaiting deploy verification |
| `done` | DONE | Fix deployed to prod and confirmed working by user |
| `duplicate` | DUPLICATE | Duplicate of another bug |

**Transitions:**
- `new` → `testing`: AI sets this after committing the fix (section 12), same timing as tasks moving to TESTING in PLAN.md
- `testing` → `done`: `deploy_production.sh` promotes automatically (section 13), same as tasks
- AI must never set a bug to `done`

## When to Apply

- User types `/bug 42` to load and investigate bug #42
- User types `/bug 42 status testing` to update a bug's status

## Procedure

### 1. Parse Arguments

Extract the bug ID (required) and optional subcommand from the user's input:
- `/bug 42` -- load and investigate
- `/bug 42 status testing` -- update status (valid: `new`, `testing`, `done`, `duplicate`)

### 2. Fetch Bug from Postgres (Primary Method)

Use direct Postgres read -- no auth required, works regardless of backend state:

```bash
cd src/backend && .venv/Scripts/python.exe -c "
from app.services.pg import get_pg
import json
with get_pg() as conn:
    cur = conn.cursor()
    cur.execute('SELECT * FROM bug_reports WHERE id = %s', ({id},))
    row = cur.fetchone()
    if row:
        print(json.dumps(dict(row), default=str))
    else:
        print('NOT_FOUND')
"
```

If that fails (e.g., no local Postgres), fall back to the API:

```bash
curl -s http://localhost:8000/api/admin/bugs/{id} -H "X-User-ID: $(cat /tmp/rb_user_id 2>/dev/null || echo admin)"
```

If the bug is not found, tell the user and stop.

### 3. Status Update (If Requested)

If the user provided a status subcommand (`/bug {id} status {value}`):

```bash
cd src/backend && .venv/Scripts/python.exe -c "
from app.services.pg import get_pg
with get_pg() as conn:
    cur = conn.cursor()
    cur.execute('UPDATE bug_reports SET status = %s, updated_at = NOW() WHERE id = %s RETURNING status', ('{status}', {id}))
    row = cur.fetchone()
    print('Updated to:', row['status'] if row else 'NOT_FOUND')
"
```

Report the result and stop (don't do a full investigation for status-only updates).

### 4. Do NOT Change Status During Investigation

Leave the bug status as-is when loading it. Status changes happen later:
- `new` → `testing`: After the fix is committed (see section 12)
- `testing` → `done`: Automatically by `deploy_production.sh` (see section 13)

### 5. Display Structured Summary

Format the bug data as:

```
## Bug #{id}: {description (first 80 chars)}
**Status:** {old_status} -> testing  (or just {status} if not changed)
**Reporter:** {reporter_email}
**Reported:** {created_at formatted as YYYY-MM-DD HH:MM UTC}
**Build:** {build}
**Page:** {page_url}
**User Agent:** {user_agent (first 80 chars)}
```

### 6. Editor Context Table

If `editor_context` is present (JSONB dict), format as a markdown table:

```
### Editor Context
| Field | Value |
|-------|-------|
| Mode | {editor_context.mode} |
| ... | ... |
```

Flatten nested objects one level deep. This shows what the user was doing when they hit the bug.

### 7. Action Breadcrumbs

If `actions` is present (JSONB array), format as a timeline showing the last 15 actions:

```
### Action Breadcrumbs (last 15)
{timestamp}  {action_type}  {detail fields}
{timestamp}  {action_type}  {detail fields}
...
```

Each action is an object with at minimum a type/action field. Show them chronologically.

### 8. Console Logs (CRITICAL: Use reduce_log)

**NEVER ingest raw console_logs into context.** They can be huge and waste tokens.

If `console_logs` is present (JSONB array):

1. Write the logs to a temp file:
   ```bash
   cd src/backend && .venv/Scripts/python.exe -c "
   from app.services.pg import get_pg
   import json, os
   with get_pg() as conn:
       cur = conn.cursor()
       cur.execute('SELECT console_logs FROM bug_reports WHERE id = %s', ({id},))
       row = cur.fetchone()
       if row and row['console_logs']:
           logs = row['console_logs']
           temp = os.path.join(os.environ.get('TEMP', '/tmp'), 'bug-{id}-logs.txt')
           with open(temp, 'w') as f:
               for entry in logs:
                   level = entry.get('level', 'log')
                   msg = entry.get('message', str(entry))
                   ts = entry.get('timestamp', '')
                   f.write(f'[{level.upper()}] {ts} {msg}\n')
           print(temp)
       else:
           print('NO_LOGS')
   "
   ```

2. Use `reduce_log` on the temp file to analyze:
   ```
   reduce_log({ file: "$TEMP/bug-{id}-logs.txt", tail: 500, level: "error" })
   ```

3. If errors exist, also run with context to find surrounding warnings:
   ```
   reduce_log({ file: "$TEMP/bug-{id}-logs.txt", tail: 500, level: "error", before: 10, context_level: "warning" })
   ```

### 9. Screenshot

If `screenshot_r2_key` is set:

1. Get a presigned URL and download to a temp file:
   ```bash
   cd src/backend && .venv/Scripts/python.exe -c "
   from app.services.pg import get_pg
   from app.storage import generate_presigned_url_global
   import os
   with get_pg() as conn:
       cur = conn.cursor()
       cur.execute('SELECT screenshot_r2_key FROM bug_reports WHERE id = %s', ({id},))
       row = cur.fetchone()
       if row and row['screenshot_r2_key']:
           url = generate_presigned_url_global(row['screenshot_r2_key'])
           print(url)
       else:
           print('NO_SCREENSHOT')
   "
   ```

2. Download to temp and read it (Claude can view images):
   ```bash
   curl -sL "{presigned_url}" -o "$TEMP/bug-{id}-screenshot.jpg"
   ```

3. Use the Read tool to view the screenshot image file.

If no screenshot, note `No screenshot attached` in the output.

### 10. Investigate

Based on the loaded context:

1. **Identify the editor mode** from `editor_context.mode` (annotate, framing, overlay, gallery) and search relevant frontend files:
   - annotate: `src/frontend/src/components/annotate/`
   - framing: `src/frontend/src/components/framing/`
   - overlay: `src/frontend/src/components/overlay/`
   - gallery: `src/frontend/src/components/gallery/`

2. **Search for error messages** from the console logs in the codebase using Grep.

3. **Correlate action breadcrumbs** with the error timing to narrow down the trigger.

4. **Suggest likely root cause** and list affected files with line numbers.

### 11. Admin Notes

If `admin_notes` is present, display them:

```
### Admin Notes
{admin_notes}
```

If the bug has `duplicate_of` set, note which bug it duplicates.

## Example Output

```
## Bug #42: Clip icon placed in wrong part of timeline
**Status:** new -> testing
**Reporter:** user@example.com
**Reported:** 2026-05-24 01:35 UTC
**Build:** abc123
**Page:** https://app.reelballers.com/annotate

### Editor Context
| Field | Value |
|-------|-------|
| Mode | annotate |
| Game ID | 7 |
| Total Clips | 18 |
| Current Clip | #15 (495s-510s) |

### Action Breadcrumbs (last 15)
01:34:52  navigate_to_game  game_id=7
01:34:55  play_video
01:35:01  add_clip  start=495, end=510
01:35:08  add_clip  start=470, end=515
...

### Console Errors
[analyzed via reduce_log]
3 errors found:
- TypeError: Cannot read property 'x' of undefined (x2)
- Uncaught RangeError: clip index out of bounds

### Screenshot
[viewing bug-42-screenshot.jpg]

### Investigation
Based on the editor context (annotate mode, game #7, 18 clips),
clip #16 (start=470s) starts BEFORE clip #15 (start=495s) but appears
after it. The sort order in AnnotateTimeline.tsx may not account for...
```

## Bug Status After Fix

### 12. Set Bug to "testing" After Fix Is Committed

After the fix is committed and ready for merge (same point where tasks move to TESTING in PLAN.md), update the bug status on the **remote** server where the bug was reported:

```bash
cd src/backend && .venv/Scripts/python.exe -c "
import json, ssl, urllib.request
from pathlib import Path

config = json.loads(Path('../../scripts/.task-manager-config.json').read_text())
url = config['prod_url']
session = config['prod_session']

req = urllib.request.Request(f'{url}/api/admin/bugs/{id}', method='PATCH')
req.add_header('X-User-ID', session)
req.add_header('Content-Type', 'application/json')
req.data = json.dumps({'status': 'testing'}).encode()
resp = urllib.request.urlopen(req, context=ssl.create_default_context(), timeout=15)
print(f'Bug #{id} set to testing')
"
```

**This is required.** Do not skip this step. It mirrors the task workflow where PLAN.md is updated to TESTING before merge.

### 13. Deploy Promotes "testing" → "done" Automatically

`deploy_production.sh` calls `scripts/promote-bugs.py --env prod` which:
1. Fetches all bugs with status `testing` from the production API
2. PATCHes each to status `done` (sets `resolved_at` timestamp)

No manual action needed at deploy time -- bugs follow the same TESTING → DONE promotion as tasks in PLAN.md.
