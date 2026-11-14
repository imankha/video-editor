# T16490: New sign-in signs out the old device

**Status:** TODO
**Impact:** 5
**Complexity:** 2
**Created:** 2026-11-13
**Updated:** 2026-11-13

## In plain words

Signing in on a new device signs the old one out. T16380 makes the server remember a valid sign-in for about a minute so it need not ask the database each time. If that memory is not also cleared on a new sign-in, an account reset and an account delete, the old device keeps working for up to a minute. Check all three once T16380 has merged and clear the memory there if needed. Worked when the old device is refused on its very next request in a test.

## Implementer details

- `invalidate_user_sessions` is called from `src/backend/app/routers/auth.py` on a new sign-in (`_issue_session_cookie`), on account reset and on delete. T16380's task only names explicit sign-out.
- Blocked until T16380 merges. If its implementation already clears the cache inside `invalidate_user_sessions`, this task is a test only.
- Knowledge doc: `.claude/knowledge/backend-services.md`.

## Acceptance Criteria

- [ ] After a second sign-in for the same account, a request with the first session's cookie is refused immediately.
- [ ] The same holds after an account reset and after an account delete.
