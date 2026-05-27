---
name: bug
description: "Load a bug report's full context for investigation. Usage: /bug p{id} or /bug s{id}"
license: MIT
author: video-editor
version: 1.2.0
user_invocable: true
---

# Bug Investigation

Load a bug report and investigate it in the current session. Usage: `/bug p42` (production) or `/bug s15` (staging).

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

- User types `/bug p42` to load and investigate production bug #42
- User types `/bug s15` to load and investigate staging bug #15
- User types `/bug p42 status testing` to update a bug's status
- Bare integer (`/bug 42`) defaults to production

## Procedure

### 1. Parse Arguments

Extract the environment prefix and bug ID (required) and optional subcommand:
- `/bug p42` -- load production bug #42
- `/bug s15` -- load staging bug #15
- `/bug 42` -- defaults to production (same as `/bug p42`)
- `/bug p42 status testing` -- update status (valid: `new`, `testing`, `done`, `duplicate`)

**Prefix mapping:**
| Prefix | Environment | Config key |
|--------|-------------|------------|
| `p` | production | `prod_url`, `prod_session` |
| `s` | staging | `staging_url`, `staging_session` |

### 2. Fetch Bug from Remote API

Read the config to get the right URL and session for the environment:

```bash
cd src/backend && .venv/Scripts/python.exe -c "
import json, ssl, urllib.request
from pathlib import Path

config = json.loads(Path('../../scripts/.task-manager-config.json').read_text())
env = '{env}'  # 'prod' or 'staging'
url = config[f'{env}_url']
session = config[f'{env}_session']

req = urllib.request.Request(f'{url}/api/admin/bugs/{id}')
req.add_header('X-User-ID', session)
resp = urllib.request.urlopen(req, context=ssl.create_default_context(), timeout=15)
print(resp.read().decode())
"
```

Where `{env}` is `prod` (for `p` prefix or bare integer) or `staging` (for `s` prefix).

If the bug is not found, tell the user and stop.

### 3. Status Update (If Requested)

If the user provided a status subcommand (`/bug p{id} status {value}`):

```bash
cd src/backend && .venv/Scripts/python.exe -c "
import json, ssl, urllib.request
from pathlib import Path

config = json.loads(Path('../../scripts/.task-manager-config.json').read_text())
env = '{env}'  # 'prod' or 'staging'
url = config[f'{env}_url']
session = config[f'{env}_session']

req = urllib.request.Request(f'{url}/api/admin/bugs/{id}', method='PATCH')
req.add_header('X-User-ID', session)
req.add_header('Content-Type', 'application/json')
req.data = json.dumps({'status': '{status}'}).encode()
resp = urllib.request.urlopen(req, context=ssl.create_default_context(), timeout=15)
print(f'Bug {env[0]}{id} updated to {status}')
"
```

Report the result and stop (don't do a full investigation for status-only updates).

### 4. Do NOT Change Status During Investigation

Leave the bug status as-is when loading it. Status changes happen later:
- `new` → `testing`: After the fix is committed (see section 12)
- `testing` → `done`: Automatically by `deploy_production.sh` (see section 13)

### 5. Display Structured Summary

Format the bug data as (use the prefixed ID throughout, e.g. `p42` or `s15`):

```
## Bug {prefix}{id}: {description (first 80 chars)}
**Environment:** {production|staging}
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

If the bug detail response includes `console_logs` or `logs_url`:

1. If `logs_url` is present (presigned R2 URL), download to a temp file:
   ```bash
   curl -sL "{logs_url}" -o "$TEMP/bug-{prefix}{id}-logs.txt"
   ```

   If no `logs_url` but `console_logs` is present in the response JSON, write them to a temp file:
   ```bash
   cd src/backend && .venv/Scripts/python.exe -c "
   import json, os
   logs = {console_logs_json}
   temp = os.path.join(os.environ.get('TEMP', '/tmp'), 'bug-{prefix}{id}-logs.txt')
   with open(temp, 'w') as f:
       for entry in logs:
           level = entry.get('level', 'log')
           msg = entry.get('message', str(entry))
           ts = entry.get('timestamp', '')
           f.write(f'[{level.upper()}] {ts} {msg}\n')
   print(temp)
   "
   ```

2. Use `reduce_log` on the temp file to analyze:
   ```
   reduce_log({ file: "$TEMP/bug-{prefix}{id}-logs.txt", tail: 500, level: "error" })
   ```

3. If errors exist, also run with context to find surrounding warnings:
   ```
   reduce_log({ file: "$TEMP/bug-{prefix}{id}-logs.txt", tail: 500, level: "error", before: 10, context_level: "warning" })
   ```

### 9. Screenshot

If the bug detail response includes `screenshot_url` (presigned R2 URL):

1. Download to temp and read it (Claude can view images):
   ```bash
   curl -sL "{screenshot_url}" -o "$TEMP/bug-{prefix}{id}-screenshot.jpg"
   ```

2. Use the Read tool to view the screenshot image file.

If no screenshot URL in the response, note `No screenshot attached` in the output.

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
## Bug p42: Clip icon placed in wrong part of timeline
**Environment:** production
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

After the fix is committed and ready for merge (same point where tasks move to TESTING in PLAN.md), update the bug status on the **same environment** where it was reported (use the `{env}` parsed from the prefix in step 1):

```bash
cd src/backend && .venv/Scripts/python.exe -c "
import json, ssl, urllib.request
from pathlib import Path

config = json.loads(Path('../../scripts/.task-manager-config.json').read_text())
env = '{env}'  # 'prod' or 'staging' — from the bug's prefix
url = config[f'{env}_url']
session = config[f'{env}_session']

req = urllib.request.Request(f'{url}/api/admin/bugs/{id}', method='PATCH')
req.add_header('X-User-ID', session)
req.add_header('Content-Type', 'application/json')
req.data = json.dumps({'status': 'testing'}).encode()
resp = urllib.request.urlopen(req, context=ssl.create_default_context(), timeout=15)
print(f'Bug {env[0]}{id} set to testing')
"
```

**This is required.** Do not skip this step. It mirrors the task workflow where PLAN.md is updated to TESTING before merge.

### 13. Deploy Promotes "testing" → "done" Automatically

`deploy_production.sh` calls `scripts/promote-bugs.py --env prod` which:
1. Fetches all bugs with status `testing` from the production API
2. PATCHes each to status `done` (sets `resolved_at` timestamp)

No manual action needed at deploy time -- bugs follow the same TESTING → DONE promotion as tasks in PLAN.md.
