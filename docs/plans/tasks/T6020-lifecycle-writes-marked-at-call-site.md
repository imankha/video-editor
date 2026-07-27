# T6020: The write-attempt gate's URL denylist cannot classify `/api/projects/{id}/state` — mark lifecycle writes at the call site

**Status:** TODO
**Impact:** 3
**Complexity:** 2
**Created:** 2026-07-27
**Follows:** T5960 (merged to master 2026-07-27, commit `e90633d7`) — read that task file first.

## Problem

T5960 decides "did this session attempt a genuine user write?" by matching the request **URL**
against a denylist in `stores/syncStore.js`:

```js
const NON_GESTURE_API_PREFIXES = ['/api/auth/', '/api/client-errors/'];
const NON_GESTURE_API_EXACT    = ['/api/exports/acknowledge'];
const NON_GESTURE_API_PATTERNS = [/^\/api\/exports\/[^/]+\/resume-progress$/];
```

Two problems, one of them structural.

**1. Structural: one endpoint is BOTH lifecycle and gesture.**
`PATCH /api/projects/{id}/state` is called from:
- `hooks/useProjectLoader.js:123` — on project **load**, bookkeeping (`update_last_opened=true`), no
  user intent;
- `App.jsx:589` and `App.jsx:650` — on a real **mode-switch gesture**.

Same pathname. A pathname matcher cannot separate them, so project-open currently arms the gate and
a stale conflict can still surface on what the user experiences as a passive load. The only URL-level
discriminator is the `update_last_opened` query param, which was **considered and rejected** during
T5960 review: it couples the frontend gate to a backend query-param name that can change
independently and silently break the exclusion.

**2. Maintenance: the coupling is invisible at the call site.**
A new lifecycle write must remember to register itself in a list in a different file. Nothing at the
call site says so, and nothing fails if it is forgotten — the gate just silently re-arms on passive
loads. This already happened once inside T5960 itself: the first implementation missed
`useExportRecovery.js`'s two mount-time writes and had to be corrected in a follow-up commit.

## Decision (implement this)

**Invert the mechanism: mark the few lifecycle writes explicitly at their call sites, and delete the
URL denylist.**

`utils/apiFetch.js` is `fetch(url, { credentials: 'include', ...options })` — options pass straight
through, and `fetch` ignores unknown `RequestInit` keys. So the interceptor in `syncStore.js` can
read the marker off `args[1]` with no plumbing and no new wrapper.

Pick one explicit, greppable key (e.g. `rbLifecycleWrite: true`) and apply it at every known
non-gesture mutating call site:

| Call site | Endpoint |
|---|---|
| `utils/sessionInit.js:259` | `POST /api/auth/init` |
| `utils/sessionInit.js:278` | `POST /api/auth/accept-terms` |
| `hooks/useSessionHeartbeat.js:32` | `POST /api/auth/heartbeat` |
| `hooks/useInstallPrompt.js:41` | `POST /api/auth/pwa-installed` |
| `utils/videoErrorBeacon.js:36` | `POST /api/client-errors/video` |
| `hooks/useExportRecovery.js:136` | `POST /api/exports/acknowledge` |
| `hooks/useExportRecovery.js:216` | `POST /api/exports/{job_id}/resume-progress` |
| `hooks/useProjectLoader.js:123` | `PATCH /api/projects/{id}/state` (**the case URLs cannot express**) |

`App.jsx:589,650` (mode switch) stay **unmarked** — they are genuine gestures and must keep arming
the gate. That is the whole point of the change.

Audit for any call site this table misses rather than trusting the table; it was built by grepping
mutating methods in `src/frontend/src` on 2026-07-27 and may have drifted.

`useSessionHeartbeat.js:40` uses `navigator.sendBeacon`, which does **not** route through
`window.fetch` and so never reaches the interceptor at all. Confirm that and note it; no marker
needed.

### Why this direction and not an allowlist of gesture writes

The failure directions are asymmetric and only one is acceptable:

- **Forgetting to mark a lifecycle write** -> gate arms spuriously -> a stale alarm on a passive
  load. That is the pre-T5960 status quo. Annoying, recoverable.
- **Forgetting to allowlist a gesture write** -> a real writer's genuine conflict is **silently
  suppressed**. That is a data-loss-shaped failure.

Keep the mechanism that fails toward the first. Do not invert it into an allowlist.

This also matches CLAUDE.md § Refactoring Rules #6: *"Greppability beats elegance: explicit names, no
dynamic dispatch/registry indirection for internal code"* — `grep rbLifecycleWrite` finds every
lifecycle write; the current denylist is exactly the registry indirection that rule warns about.

## Must not break

1. Mode-switch (`App.jsx:589,650`) still arms the gate — a real writer still gets a real alarm.
2. Passive load still shows no alarm (T5960's acceptance criterion 1) — including for a user with a
   finished export awaiting acknowledgement.
3. A genuine export **start** (`POST /api/exports/framing`) still arms the gate.
4. Stays green: `syncStore.test.js`, `SyncStatusIndicator.test.jsx`.

## Acceptance criteria

- [ ] The three URL denylist constants are **deleted** from `syncStore.js`; classification is by the
      call-site marker only.
- [ ] Opening a project no longer arms the gate; switching mode still does. Unit test pins both,
      RED before the fix.
- [ ] Every call site in the table above carries the marker; a grep for the key returns exactly that
      set (plus its definition and tests).
- [ ] `isMutatingApiRequest`'s existing edge-case coverage survives: lowercase/absent method, method
      on a `Request` in `args[0]`, foreign-origin (R2 presigned) never arms, GET never arms.
- [ ] Passive-load-silent and edit-then-alarm still pass in a real browser (re-run
      `e2e/T5960-conflict-alarm-gated-on-write.spec.js`; extend it with the project-open case).

## Knowledge

`.claude/knowledge/persistence-sync.md` — the T5960 surfacing-rule section describes the URL
denylist. Rewrite that part to describe the call-site marker at Stage 7; leaving both described
would actively mislead the next agent.
