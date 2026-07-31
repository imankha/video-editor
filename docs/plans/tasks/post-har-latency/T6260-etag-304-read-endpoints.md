# T6260: Read endpoints send `no-cache` with no validator — nothing can ever 304

**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Created:** 2026-07-31
**Updated:** 2026-07-31

Epic task 3/6. See [EPIC.md](EPIC.md).

## Problem

Every JSON read endpoint in the 2026-07-31 HAR responds with:

```
Cache-Control: private, no-cache, stale-while-revalidate=...
ETag: (none)
Last-Modified: (none)
```

`no-cache` means "revalidate before reuse" — but with **no ETag and no Last-Modified there is
nothing to revalidate with**, so the browser can never send `If-None-Match` and the server can
never answer `304`. Every request re-sends the full body. `stale-while-revalidate` is likewise
inert without a validator.

Confirmed on: `/api/profiles`, `/api/projects`, `/api/games`, `/api/settings`, `/api/credits`,
`/api/downloads`, `/api/downloads/count`, `/api/quests/progress`, `/api/admin/me`,
`/api/clips/projects/{id}/clips`, `/api/projects/{id}/outdated-clips`,
`/api/export/projects/{id}/overlay-data`, `/api/rank/confidence`, `/api/collections/summary`.

**The stack already does this correctly elsewhere:** poster images send
`Cache-Control: private, max-age=86400` **with** an ETag. That is the proof the pattern works
here — the JSON endpoints just never got it.

## Solution

Add ETags to the read endpoints so unchanged responses answer 304 instead of resending bodies.

1. Pick the validator source deliberately per endpoint — a content hash of the serialized body
   is the simplest correct choice and needs no schema change. A `updated_at`-derived value is
   cheaper but only correct if every mutation touches it.
2. Return `304 Not Modified` when `If-None-Match` matches. Keep `private` (these are per-user).
3. Start with the highest-traffic reads (the boot set: `projects`, `games`, `downloads`,
   `settings`, `profiles`) rather than doing all of them at once.

**Do not add `max-age` to these.** They are mutable per-user data; a stale-serving window would
show users their own edits disappearing. 304-on-revalidate is the win here, not skipping the
request.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/main.py` — where the current `Cache-Control` is applied (middleware); find
  the single place that stamps `private, no-cache, stale-while-revalidate`
- `src/backend/app/routers/projects.py`, `games.py`, `downloads.py`, `settings.py` — the
  highest-traffic read handlers
- Poster handlers (the working reference — they already emit `max-age` + ETag); grep for the
  existing ETag implementation and reuse it rather than inventing a second one

### Related Tasks
- **T6240** — do that first; boot latency is dominated by the event-loop block, not payload size.
- **T6200** — several of these handlers were just converted to plain `def` or `run_in_context`
  offloads. Read `.claude/knowledge/backend-services.md` § Request concurrency model before
  touching handler signatures, and do not move blocking work back onto the loop.

### Technical Notes
- Computing a body hash means serializing before deciding to 304 — that saves bandwidth but not
  handler work. If the goal is also to save server work, the validator must be derivable
  *without* building the body. State which you chose and why.
- The frontend uses `apiFetch`; confirm it does not set headers that defeat conditional requests
  (e.g. `cache: 'no-store'`).
- Measure the benefit before expanding scope: on localhost these bodies are small and the win is
  modest. The case is stronger on real networks — say so with numbers rather than assuming.

## Implementation

### Steps
1. [ ] Locate the single place `Cache-Control` is stamped; confirm no endpoint sets its own
2. [ ] Reuse the existing poster ETag helper for JSON responses
3. [ ] Implement `If-None-Match` -> 304 on the boot-set endpoints first
4. [ ] Verify with a repeat-load HAR: unchanged endpoints answer 304
5. [ ] Confirm no stale data is served after a mutation (edit -> reload -> new value shows)

### Progress Log

**2026-07-31**: Filed from the post-T6190/T6200 verification HAR (header audit across 14 read
endpoints; all lacked a validator).

## Acceptance Criteria

- [ ] Read endpoints emit an ETag
- [ ] A repeat request with `If-None-Match` receives **304** with no body
- [ ] Mutating data then reloading shows the NEW value (no stale serving)
- [ ] Measured before/after transfer size on a repeat load, reported honestly
- [ ] No handler moved back onto the event loop (T6200 invariant preserved)
- [ ] Backend tests pass
