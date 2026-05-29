---
name: bug
description: "Load a bug report's full context for investigation. Usage: /bug {id}p or /bug {id}s"
license: MIT
author: video-editor
version: 1.3.0
user_invocable: true
---

# Bug Investigation

Load a bug report and investigate it in the current session. Usage: `/bug 42p` (production) or `/bug 15s` (staging).

## Bug Lifecycle

Bugs follow the same lifecycle as tasks:

| Bug Status | Display | Meaning |
|------------|---------|---------|
| `new` | TODO | Reported, not yet investigated |
| `testing` | TESTING | AI has investigated and applied a fix; awaiting deploy verification |
| `done` | DONE | Fix deployed to prod and confirmed working by user |
| `duplicate` | DUPLICATE | Duplicate of another bug |

**Transitions:**
- `new` → `testing`: User promotes manually via task board Resolve button, or `/bug {id} status testing`
- `testing` → `done`: User promotes manually via task board Resolve button, or `/bug {id} status done`
- AI does not change bug statuses -- the user does it manually

## When to Apply

- User types `/bug 42p` to load and investigate production bug #42
- User types `/bug 15s` to load and investigate staging bug #15
- User types `/bug 42p status testing` to update a bug's status
- Bare integer (`/bug 42`) defaults to production

## Procedure

### 1. Parse Arguments

Extract the bug ID (required), environment suffix, and optional subcommand:
- `/bug 42p` -- load production bug #42
- `/bug 15s` -- load staging bug #15
- `/bug 42` -- defaults to production (same as `/bug 42p`)
- `/bug 42p status testing` -- update status (valid: `new`, `testing`, `done`, `duplicate`)
- `/bug 42p duplicate-of 9` -- mark bug 42 as duplicate of bug 9 (extracts unique context first)

**Suffix mapping:**
| Suffix | Environment | Config key |
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

Where `{env}` is `prod` (for `p` suffix or bare integer) or `staging` (for `s` suffix).

If the bug is not found, tell the user and stop.

### 3. Status Update (If Requested)

If the user provided a status subcommand (`/bug {id}p status {value}`):

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
print(f'Bug {id}{env[0]} updated to {status}')
"
```

Report the result and stop (don't do a full investigation for status-only updates).

### 3a. Mark as Duplicate (Extract Before Linking)

If the user provided a `duplicate-of` subcommand (`/bug {id}{suffix} duplicate-of {target_id}`):

**Do NOT just set `duplicate_of`.** First extract what the duplicate uniquely contributes, then persist that context on the primary bug, then link them.

**Step 1 — Fetch both bugs and the target's existing cluster:**

```bash
cd src/backend && .venv/Scripts/python.exe -c "
import json, ssl, urllib.request
from pathlib import Path

config = json.loads(Path('../../scripts/.task-manager-config.json').read_text())
env = '{env}'
url = config[f'{env}_url']
session = config[f'{env}_session']

# Fetch the bug being marked as duplicate
req = urllib.request.Request(f'{url}/api/admin/bugs/{id}')
req.add_header('X-User-ID', session)
resp = urllib.request.urlopen(req, context=ssl.create_default_context(), timeout=15)
source = json.loads(resp.read().decode())

# Fetch the target's correlated cluster
req = urllib.request.Request(f'{url}/api/admin/bugs/{target_id}/correlated')
req.add_header('X-User-ID', session)
resp = urllib.request.urlopen(req, context=ssl.create_default_context(), timeout=15)
cluster = json.loads(resp.read().decode())

print('SOURCE:', json.dumps(source, indent=2))
print('CLUSTER:', json.dumps(cluster, indent=2))
"
```

**Step 2 — Identify unique contributions** from the source bug that don't exist in the primary or existing duplicates:

- **Screenshot**: Source has one but primary doesn't?
- **Console errors**: Error messages in source not present in any cluster bug?
- **Build version**: Different build than any cluster bug? (narrows regression window)
- **Editor mode/context**: Different mode or state? (broadens scope)
- **Action sequence**: Different path to the same bug? (reveals triggers)
- **Reporter**: New reporter not seen in cluster? (confirms not account-specific)

**Step 3 — Append unique contributions to primary's admin_notes:**

Build a summary string of what this duplicate uniquely adds, then PATCH the primary:

```bash
cd src/backend && .venv/Scripts/python.exe -c "
import json, ssl, urllib.request
from pathlib import Path

config = json.loads(Path('../../scripts/.task-manager-config.json').read_text())
env = '{env}'
url = config[f'{env}_url']
session = config[f'{env}_session']

# Get current primary admin_notes
req = urllib.request.Request(f'{url}/api/admin/bugs/{target_id}')
req.add_header('X-User-ID', session)
resp = urllib.request.urlopen(req, context=ssl.create_default_context(), timeout=15)
target = json.loads(resp.read().decode())

existing_notes = target.get('admin_notes') or ''
# Build contribution summary — replace {contributions} with the actual findings
new_notes = existing_notes.rstrip() + '''

--- Extracted from Bug {id} (duplicate) ---
{contributions}'''

req = urllib.request.Request(f'{url}/api/admin/bugs/{target_id}', method='PATCH')
req.add_header('X-User-ID', session)
req.add_header('Content-Type', 'application/json')
req.data = json.dumps({'admin_notes': new_notes}).encode()
resp = urllib.request.urlopen(req, context=ssl.create_default_context(), timeout=15)
print('Notes updated on primary bug {target_id}')
"
```

Where `{contributions}` includes both the unique factual contributions AND any narrative details from the duplicate's description that add to the story. Read the source bug's description and compare it to the primary's — extract details that are new, not redundant.

```
Description adds: reporter observed the clip reappears on page refresh, suggesting
state desync rather than data loss.
- Screenshot available (primary has none)
- Error: "NetworkError: Failed to fetch" (not in primary)
- Build: def456 (primary is abc123)
- Mode: framing (primary is annotate — broader scope)
- Reporter: bob@example.com (new reporter)
```

Only include lines for contributions that are actually unique. If the duplicate adds nothing new beyond what the primary already says, note that.

**Step 4 — Mark as duplicate:**

```bash
cd src/backend && .venv/Scripts/python.exe -c "
import json, ssl, urllib.request
from pathlib import Path

config = json.loads(Path('../../scripts/.task-manager-config.json').read_text())
env = '{env}'
url = config[f'{env}_url']
session = config[f'{env}_session']

req = urllib.request.Request(f'{url}/api/admin/bugs/{id}', method='PATCH')
req.add_header('X-User-ID', session)
req.add_header('Content-Type', 'application/json')
req.data = json.dumps({'duplicate_of': {target_id}}).encode()
resp = urllib.request.urlopen(req, context=ssl.create_default_context(), timeout=15)
print('Bug {id}{suffix} marked as duplicate of {target_id}{suffix}')
"
```

**Step 5 — Report** what was extracted and linked. Stop here (don't do a full investigation).

### 4. Do NOT Change Status During Investigation

Leave the bug status as-is when loading it. Status changes are manual:
- The user promotes bugs via the task board buttons or `/bug {id} status {status}`
- AI does not change bug statuses

### 5. Display Structured Summary

Format the bug data as (use the suffixed ID throughout, e.g. `42p` or `15s`):

```
## Bug {id}{suffix}: {description (first 80 chars)}
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
   curl -sL "{logs_url}" -o "$TEMP/bug-{id}{suffix}-logs.txt"
   ```

   If no `logs_url` but `console_logs` is present in the response JSON, write them to a temp file:
   ```bash
   cd src/backend && .venv/Scripts/python.exe -c "
   import json, os
   logs = {console_logs_json}
   temp = os.path.join(os.environ.get('TEMP', '/tmp'), 'bug-{id}{suffix}-logs.txt')
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
   reduce_log({ file: "$TEMP/bug-{id}{suffix}-logs.txt", tail: 500, level: "error" })
   ```

3. If errors exist, also run with context to find surrounding warnings:
   ```
   reduce_log({ file: "$TEMP/bug-{id}{suffix}-logs.txt", tail: 500, level: "error", before: 10, context_level: "warning" })
   ```

### 9. Screenshot

If the bug detail response includes `screenshot_url` (presigned R2 URL):

1. Download to temp and read it (Claude can view images):
   ```bash
   curl -sL "{screenshot_url}" -o "$TEMP/bug-{id}{suffix}-screenshot.jpg"
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

### 11a. Correlated Reports (Duplicate Delta Analysis)

After displaying admin notes, check whether this bug has any correlated reports — other bugs in the same duplicate cluster that may contain unique context.

**Fetch correlated bugs:**

```bash
cd src/backend && .venv/Scripts/python.exe -c "
import json, ssl, urllib.request
from pathlib import Path

config = json.loads(Path('../../scripts/.task-manager-config.json').read_text())
env = '{env}'
url = config[f'{env}_url']
session = config[f'{env}_session']

req = urllib.request.Request(f'{url}/api/admin/bugs/{id}/correlated')
req.add_header('X-User-ID', session)
resp = urllib.request.urlopen(req, context=ssl.create_default_context(), timeout=15)
data = json.loads(resp.read().decode())
print(json.dumps(data, indent=2))
"
```

**If `cluster_size` <= 1**, skip this section entirely (no duplicates to analyze).

**If duplicates exist**, display a correlated reports analysis:

```
### Correlated Reports ({cluster_size} bugs in cluster)

Primary: Bug {primary_id}{suffix}

| Bug | Reporter | Build | Mode | Screenshot | Errors | Actions |
|-----|----------|-------|------|------------|--------|---------|
| {id}{suffix} (primary) | {email} | {build} | {mode} | yes/no | {error_count} | {action_count} |
| {id}{suffix} | {email} | {build} | {mode} | yes/no | {error_count} | {action_count} |
```

Then produce a **consolidated description** and analyze **unique contributions**.

#### Consolidated Description

Read the `description` field from every bug in the cluster. These are user-written narratives — each reporter described the problem from their perspective with their own details. Synthesize them into a single coherent description that:

1. **Eliminates redundancy** — If 3 reports all say "the clip disappears," say it once.
2. **Preserves unique details** — If one reporter mentions a specific trigger ("happens after I drag a clip to the end"), a specific visual ("the timeline shows a gap where the clip was"), or a specific sequence ("I added two clips, deleted the first, then the second vanished"), keep those details and attribute them (e.g., "Bug 7p reporter noted...").
3. **Triangulates into a coherent story** — Combine the perspectives into one narrative that tells a more complete story than any single report. Use the action breadcrumbs and editor contexts to validate or enrich what the descriptions claim.

Write the consolidated description as a short paragraph (3-5 sentences). Lead with what the bug IS, then add the details that narrow it down.

**Example:**

```
### Consolidated Description
Users are losing clips from the timeline after performing delete operations in
annotate mode. The primary report (9p) describes a clip vanishing after deleting
an adjacent clip. Bug 7p's reporter adds that the disappearance is accompanied by
a brief flash of the timeline re-rendering, and that the "lost" clip reappears on
page refresh — suggesting a frontend state desync rather than a backend deletion.
Bug 11p shows the same symptom occurring in framing mode after a crop operation,
which broadens the scope beyond annotate and beyond delete as a trigger.
```

#### Unique Contributions

Analyze what each duplicate adds beyond what the primary already tells us:

1. **Screenshots**: Which bugs have screenshots, especially if the primary lacks one. Download and view any duplicate screenshots that could add visual context.

2. **Unique errors**: Error messages in a duplicate but NOT in the primary — additional failure paths or upstream causes.

3. **Build versions**: Different builds narrow or widen the regression window.

4. **Editor contexts**: Different modes or data states broaden the bug's scope.

5. **Action paths**: Different user paths reveal whether it's trigger-specific or general state corruption.

6. **Reporters**: Multiple reporters confirms not user-specific or account-specific.

**Example output for this section:**

```
### Correlated Reports (3 bugs in cluster)

Primary: Bug 9p

| Bug | Reporter | Build | Mode | Screenshot | Errors | Actions |
|-----|----------|-------|------|------------|--------|---------|
| 9p (primary) | alice@ex.com | abc123 | annotate | no | 2 | 12 |
| 7p | bob@ex.com | abc123 | annotate | yes | 3 | 8 |
| 11p | alice@ex.com | def456 | framing | no | 1 | 15 |

### Consolidated Description
Users are losing clips from the timeline after performing delete operations.
The primary report (9p) describes a clip vanishing after deleting an adjacent clip.
Bug 7p adds that the clip reappears on page refresh — suggesting frontend state
desync, not backend deletion. Bug 11p shows the same symptom in framing mode after
a crop, broadening scope beyond annotate and delete as triggers.

**Unique contributions:**
- **Bug 7p** has a screenshot that primary 9p lacks — viewing it now.
- **Bug 7p** has error `NetworkError: Failed to fetch` not seen in primary.
- **Bug 7p** reporter observed clip reappears on refresh (state desync clue).
- **Bug 11p** reproduces in **framing** mode (primary is annotate) — broader scope.
- **Bug 11p** on build `def456` (primary on `abc123`) — bug spans 2+ deploys.
- 2 different reporters (alice, bob) — not account-specific.
```

If any duplicate has a screenshot worth viewing, download and display it using the same approach as section 9.

## Example Output

```
## Bug 42p: Clip icon placed in wrong part of timeline
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

### 12. Do Not Change Bug Status

AI does not change bug statuses. After committing the fix, tell the user the bug fix is ready. The user will promote the bug status manually via the task board or `/bug {id} status testing`.

### 13. Bug Status Promotion is Manual

Bug status changes are done by the user:
- Via the task board "Resolve" button
- Via `/bug {id} status {status}` command
- AI does not change bug statuses automatically
