# T8300: Operator scripts authenticate with a session cookie, never a raw user_id

**Status:** TODO
**Impact:** 7
**Complexity:** 2
**Created:** 2026-09-01
**Epic:** [Admin Auth Hardening](EPIC.md) — child 1 of 2, **must land before [T8290](T8290-xuserid-prod-admin-auth-bypass.md)**

## Problem

`scripts/task-manager.py` (the task board) and `scripts/promote-bugs.py` authenticate to
production admin endpoints by sending an admin's raw `user_id` in an `X-User-ID` header. That
only works because of the production auth bypass that T8290 removes. Until this task lands,
T8290 breaks the task board against prod.

Both scripts already implement real cookie auth. The `user_id` path is a *fallback branch* that
sniffs the configured value's shape:

`scripts/task-manager.py:194-207`:

```python
def _make_request(url, method='GET', data=None, session_cookie='', timeout=10, retries=3):
    """Make an HTTP request with session cookie auth. Returns (parsed_json, error_string).

    If session_cookie looks like a UUID (user_id), sends X-User-ID header instead
    of a cookie -- this works for local dev/staging where the header fallback is enabled.
    """
    ...
        if session_cookie:
            if len(session_cookie) == 36 and session_cookie.count('-') == 4:
                req.add_header('X-User-ID', session_cookie)      # <- delete this branch
            else:
                req.add_header('Cookie', f'rb_session={session_cookie}')
```

`scripts/promote-bugs.py:32-36` has the identical shape-sniffing branch.

Two things to note:

1. **The docstring is wrong and is worth fixing as documentation, not just code.** It claims the
   header "works for local dev/staging where the header fallback is enabled." It also works on
   **production**, which is precisely the vulnerability. Whoever wrote the branch did not know
   that, and the comment is why nobody revisited it.
2. **The UUID sniff is a latent correctness bug independent of security.** Any 36-character
   value containing exactly 4 hyphens is treated as a user_id. A session cookie that happened to
   match that shape would be silently sent as the wrong header. Deleting the branch removes the
   ambiguity as well as the vulnerability.

## Feasibility

Cookie auth is already the intended path, not a new mechanism to build:

- The config keys are already named for it: `prod_session` / `staging_session`
  (`task-manager.py:173-176`, shared with `promote-bugs.py` via `.task-manager-config.json`).
- The settings UI already asks for a cookie: `task-manager.py:1063` and `:1068` render inputs
  placeholdered **"Paste rb_session cookie from prod"** / **"...from staging"**.
- `rb_session` cookies are issued with `Max-Age=2592000` (30 days, confirmed live 2026-09-01
  from a prod `Set-Cookie` response header), so an operator re-pastes roughly monthly rather
  than per-session.

So the change is a deletion plus a docs/UX pass, not a redesign.

## Solution

1. **`scripts/task-manager.py:203-207`** — delete the UUID branch; always send
   `Cookie: rb_session={value}`.
2. **`scripts/task-manager.py:195-198`** — rewrite the docstring: cookie auth only, and state
   explicitly that sending a raw user_id is not an accepted form of authentication.
3. **`scripts/promote-bugs.py:32-36`** — same deletion, same correction.
4. **Failure message.** `_make_request` already collapses 401/403 to `"Auth required"`
   (`task-manager.py:216-217`). Make that message actionable, because after T8290 an operator
   whose config still holds a user_id will hit it and the current text does not say why: point
   at the settings panel and say a stale or user_id value needs replacing with a fresh
   `rb_session` cookie.
5. **Document how to get the cookie** in the settings panel (devtools > Application > Cookies >
   `rb_session` on the admin session), so the migration is self-service.

## Verification

- Task board loads prod bugs with a real `rb_session` cookie configured and **no** `X-User-ID`
  header sent anywhere. Confirm with a request-level check, not just a green UI.
- Task board with a `user_id` in the config fails with the new actionable message rather than
  silently working (it will still "work" until T8290 lands, so assert on the header actually
  sent, not on the response).
- `promote-bugs.py` completes a real run against prod under cookie auth.
- Grep both scripts: no remaining `X-User-ID` occurrences.

## Known adjacent gap (do not let this block the task)

PLAN.md records that the task board's **staging** admin-bug fetch returned 403 on 2026-08-24
because `.task-manager-config.json`'s `staging_session` is not currently admin-privileged. That
is a stale-credential problem, separate from this migration, but it will surface during
verification. Re-authenticate the staging session as part of this task so the epic does not
inherit a pre-existing red herring.

## Notes

Filed 2026-09-01 as the unblocker for T8290. It exists because T8290 cannot ship safely on its
own, not because the scripts are wrong in any user-visible way today. See [EPIC.md](EPIC.md) for
why the order is forced and for the counter-pressure on letting the epic sit.
