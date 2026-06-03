# T3320: Preconnect + Inline Warmup Script

**Epic:** [Initial Load Time](EPIC.md)
**Priority:** P0
**Complexity:** 1
**Impact:** 6
**Status:** TODO

## Problem

The frontend fetches are all initiated by JavaScript after the React bundle loads and parses (~500ms). During HTML parse, no API connections are established. The browser idles on the network side while parsing ~991KB of JS.

## Evidence

- JS bundle: 991KB, takes ~500ms to parse/execute before any `fetch()` fires
- No `<link rel="preconnect">` in index.html for the API origin
- TCP+TLS handshake to Fly.io: ~40-60ms (saved if preconnect fires during HTML parse)

## Implementation

### 1. Add preconnect hint

In `src/frontend/index.html`, add in `<head>`:

```html
<link rel="preconnect" href="https://app.reelballers.com" crossorigin>
```

For dev, this is harmless (the browser ignores preconnect to localhost).

### 2. Add inline warmup script

Add a `<script>` tag in `index.html` `<head>` (after preconnect, before the React bundle) that fires the warmup ping with zero framework dependency:

```html
<script>
  if (location.hostname !== 'localhost') {
    fetch('/api/storage/warmup', {credentials: 'omit'}).catch(function(){});
  }
</script>
```

This fires during HTML parse, before React even begins loading. Combined with T3310's unauthenticated warmup endpoint, the Fly.io machine starts booting ~500ms earlier than waiting for React.

## Files

| File | Change |
|------|--------|
| `src/frontend/index.html` | Add preconnect link + inline warmup script |

## Acceptance Criteria

- [ ] `<link rel="preconnect">` present in index.html for API origin
- [ ] Inline warmup `fetch()` fires during HTML parse (visible in HAR before React bundle executes)
- [ ] No errors on localhost (dev mode)
- [ ] Depends on T3310 for the unauthenticated warmup endpoint
