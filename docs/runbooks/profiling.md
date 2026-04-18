# Profiling Runbook

How to profile slow requests end-to-end (backend + frontend).

## Backend Profiling (T1531)

### Enable

Set env vars on the target environment:

```bash
# Staging (fly.io)
fly secrets set --app reel-ballers-api-staging \
  PROFILE_ON_BREACH_ENABLED=true \
  PROFILE_ON_BREACH_MS=1000 \
  DEBUG_ENDPOINTS_ENABLED=true

# Local dev
PROFILE_ON_BREACH_ENABLED=true PROFILE_ON_BREACH_MS=500 uvicorn app.main:app --reload
```

| Env Var | Default | Description |
|---------|---------|-------------|
| `PROFILE_ON_BREACH_ENABLED` | `false` | Enable cProfile wrapping on every request |
| `PROFILE_ON_BREACH_MS` | `1000` | Threshold (ms) -- only dump profiles for requests slower than this |
| `DEBUG_ENDPOINTS_ENABLED` | `false` | Gate the `/api/_debug/profiles` endpoints |

### On-demand profiling

Force a profile dump for any single request with the `X-Profile-Request` header:

```bash
curl -H "X-Profile-Request: 1" -b cookies.txt https://staging.reelballers.com/api/games
```

The `[SLOW REQUEST]` log line will include `profile=<path>` pointing to the dump file.

### Retrieve profiles

**Via debug endpoints** (when `DEBUG_ENDPOINTS_ENABLED=true`):

```bash
# List available profiles
curl -b cookies.txt https://staging.reelballers.com/api/_debug/profiles

# Read a specific profile (plain text pstats output)
curl -b cookies.txt https://staging.reelballers.com/api/_debug/profiles/<name>
```

**Via disk** (SSH/console access):

```
/tmp/profiles/{timestamp}_{method}_{path}_{ms}ms_{user}.prof   # binary pstats
/tmp/profiles/{timestamp}_{method}_{path}_{ms}ms_{user}.txt    # human-readable top-50
```

### View with snakeviz / pstats

```bash
# Quick text view (already available as .txt sibling)
cat /tmp/profiles/*.txt

# Interactive flame graph
pip install snakeviz
snakeviz /tmp/profiles/<name>.prof

# Python pstats
python -c "
import pstats
p = pstats.Stats('/tmp/profiles/<name>.prof')
p.sort_stats('cumulative')
p.print_stats(30)
"
```

### What you see

Each profile captures the full call tree for that request. Key columns:
- **cumtime**: total time in function + its callees (wall clock)
- **tottime**: time in function only (excludes callees)
- **ncalls**: number of invocations

Look for:
- R2 operations (`botocore`, `urllib3`) dominating cumtime
- SQLite operations (`sqlite3`) with high ncalls
- Serialization (`json.dumps`, `json.loads`) with unexpected tottime

R2 call timing is also logged separately as `[R2_CALL]` entries.

## Frontend Profiling (T1570)

### Enable

Set the Vite env var at build time:

```bash
# .env.staging
VITE_PROFILING_ENABLED=true

# .env.production (or omit entirely)
VITE_PROFILING_ENABLED=false
```

When disabled, all profiling code is dead-code-eliminated -- zero overhead.

### What gets instrumented

| Label | Location | Threshold |
|-------|----------|-----------|
| `games:fetch` | gamesDataStore.fetchGames | 1000ms |
| `project:load` | projectsStore.fetchProject | 1000ms |
| `fetch:games:fetch` | profiledFetch wrapper | 500ms |
| `fetch:project:load` | profiledFetch wrapper | 500ms |

### Console output

When a threshold is breached, you see structured logs:

```
[TIMING] games:fetch duration=1523ms threshold=1000ms
[TIMING] fetch:games:fetch total=1400ms ttfb=200ms body=50ms url=/api/games
```

The `[LONGTASK]` observer (from responsiveness.js) also logs main-thread stalls > 50ms.

### DevTools Performance timeline

1. Open Chrome DevTools > Performance tab
2. Click Record, perform the action, stop recording
3. Look for **User Timing** section in the flame chart
4. Named spans (`games:fetch`, `project:load`, `fetch:*`) appear as labeled bars

These spans are created via `performance.mark()` / `performance.measure()` and are
automatically visible in the Performance timeline -- no extension needed.

### Using timedSpan for custom measurements

To add profiling to a new async path:

```javascript
import { timedSpan } from '../utils/profiling';

// Wrap any async function -- zero overhead when VITE_PROFILING_ENABLED != 'true'
const profiledLoadClip = timedSpan('clip:extract', async (clipId) => {
  // ... async work ...
}, 2000);
```

### Using profiledFetch for network calls

```javascript
import { profiledFetch } from '../utils/profiling';

// Replaces fetch() -- logs total, TTFB, and body-read time when over threshold
const response = await profiledFetch('my-label', '/api/endpoint', { method: 'POST' }, 500);
```

## Overhead Verification

To confirm zero overhead when profiling is disabled:

```bash
# 1. Build frontend without profiling (production)
cd src/frontend && VITE_PROFILING_ENABLED=false npm run build

# 2. Start backend
cd src/backend && uvicorn app.main:app

# 3. Benchmark GET /api/games (10 runs, record median)
for i in $(seq 1 10); do
  curl -s -o /dev/null -w "%{time_total}\n" -b cookies.txt http://localhost:8000/api/games
done

# 4. Rebuild with profiling enabled
cd src/frontend && VITE_PROFILING_ENABLED=true npm run build

# 5. Re-run the same benchmark -- median delta should be < 1ms
```

Backend profiling overhead is ~5-15% when enabled (cProfile active). When
`PROFILE_ON_BREACH_ENABLED=false`, no profiler is created -- zero overhead.
