# T16430: An "admin" choice in the dev sign-in presets

**Status:** STAGING
**Impact:** 4
**Complexity:** 2
**Created:** 2026-11-13
**Updated:** 2026-11-13

## In plain words

**Today.** A local or task-container app stack offers three ready-made sign-ins through `?dev_account=`: `empty` (a new user), `upload` (a user with a game uploaded) and `full` (a user with plays and highlights). None of them is an admin, so none can open `/admin`.

**The problem and how we got here.** On 2026-11-13 the owner tested group g-t16070-3 (the retention table, retention chart and activation report, all on `/admin`) on its local stack. The test link signed them in as `full`, which cannot see the admin panel. To get in, they had to paste a `fetch('/api/auth/dev-login', ...)` call into the browser console. The browser checks for admin screens get around this the same way, by signing in as the owner's real account (`loginAsRealUser`; T15690 and T7430 note that "dev-preset accounts have no admin flag"). Now that every /dotask group stops for the owner to test before its PR (owner rule 2026-11-13), any admin-screen work runs into this.

**What we will do.** Add a fourth preset, `admin`: `?dev_account=admin` signs in as an account that passes the admin check and lands on `/admin`. The preset picker lists it beside the other three. It exists only where the other presets exist (dev stacks and task containers, never production).

**Why.** Admin features can then be tested from a link like every other feature, with no console code and without signing a test session in as the owner's real account.

**How we will know it worked.** Opening `http://localhost:<port>/?dev_account=admin` on a fresh task stack shows the admin panel with its sections loading, and the same link on a production build does nothing.

## Ruling

(owner, 2026-11-13) "?dev_account=full doesnt work ... just logs in as normal user currently, no access to admin panel. please fix." The owner expects the existing preset links to reach `/admin`, so there is no fourth preset: every account the dev picker creates (`empty`, `upload`, `full`) is an admin on a dev stack. `auth_db.is_admin` answers yes for a user who is flagged `is_test_account` AND whose email matches the picker's grammar AND whose backend runs a dev env (`storage._test_seams_enabled()`, the same gate that mounts the picker). Staging and production never widen. No `admin_users` rows are written, so there is nothing to clean up, and accounts picked before the change gain admin too. Side effect: on a dev stack an admin cannot impersonate a dev-picker account (impersonation refuses admin targets).

## Implementer details

- Presets: `DevAccountPreset` and `_PRESET_INFO` in `src/backend/app/routers/dev_accounts.py`; the frontend reads `?dev_account=` in `src/frontend/src/utils/devAccounts.js` and `src/frontend/src/stores/editorStore.js` (test: `editorStore.devAccountParam.test.js`).
- Admin check: `auth_db.is_admin` (`src/backend/app/services/auth_db.py`, T550) goes by email. Decide whether the preset gets an admin-listed email or a dev-only admin flag; do not widen admin for any non-dev account.
- `scripts/dotask_cli.py` lists the presets in `DEV_ACCOUNT_PRESETS` (printed with every stack URL) and the READY_TO_TEST test guide links `?dev_account=full`. For a group whose tasks touch `/admin`, the guide should link the admin preset instead.
- Admin checks under `src/frontend/e2e/checks/` (T7430, T7420, T16070, T15690) can then sign in with the preset in place of `loginAsRealUser`.

## Acceptance criteria

- [x] C1: An account from `?dev_account=<preset>` passes the admin check on a dev stack (backend test, `test_dev_picker_account_is_an_admin_on_a_dev_stack`).
- [x] C2: The same account is never an admin on staging or production, and a picker-shaped email without the test flag is never an admin (backend tests).
- [ ] C3: On a task stack, `?dev_account=full` opens the admin panel (owner, after merge).
