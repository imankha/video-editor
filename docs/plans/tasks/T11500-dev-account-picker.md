# T11500: Dev account picker on local stacks (no sign-in wall)

**Status:** TODO
**Impact:** 6
**Complexity:** 6
**Created:** 2026-10-09
**Updated:** 2026-10-09

## Problem

Every local stack the AI brings up for a human test (`/dotask land <slug>`, `dotask.sh stack`,
`task.sh stack`) opens on the sign-in screen. Google sign-in and email codes don't work against
a local backend, so the user has to find and paste a JavaScript snippet that calls
`POST /api/auth/dev-login` before testing anything. That costs time on every test, and the
accounts the snippet can reach are a poor fit:

- `imankh+devfixture@gmail.com` has 8 games and hundreds of clips: too much to see one change.
- `imankh@gmail.com` is nearly empty, and `e2e@test.local` is completely empty.
- Two containers logged in as the same account conflict in R2 (`[SYNC_CONFLICT]
  reason=stale_baseline`, see the project_container_ports_r2_cors memory), so sharing one
  account across stacks breaks saves.

Testing a change usually needs one specific starting state: a new user, a user who has just
uploaded, or a user with work in every stage.

## Solution

On a local dev stack, the sign-in wall is replaced by a **dev account picker** with three
presets. One click logs in as a per-stack account in that state:

| Preset | What the account holds |
|---|---|
| **Empty account** | A brand-new user: no games, no clips, default profile. A fresh account on every pick. |
| **Just an upload** | One ready uploaded game. No annotations, no projects. |
| **Full account** | One ready uploaded game with ~6 annotated plays; one clip in Framing (never exported); one clip in Spotlight/Overlay (framing exported, no final); one finished clip (final video, published). |

Stack output prints direct links that skip even the picker, for example
`http://localhost:5174/?dev_account=full`.

### Flow

```
App load (DEV build) -> GET /api/auth/me -> 401
  -> GET /api/dev/accounts            (dev backend: 200 + presets; anything else: 404)
     -> 200: render <DevAccountPicker/> instead of <SignInScreen/>   (App.jsx:897)
     -> 404: render <SignInScreen/> as today
  -> click preset (or ?dev_account=<preset> in the URL)
     -> POST /api/dev/accounts/<preset> {reset?}
        backend: ensure the per-stack account exists in that state, run user_session_init,
                 issue the rb_session cookie (same path as dev-login)
     -> clear sessionStorage rb_profile_id, location.reload()   (initSession is cached)
```

### Backend

- New router `src/backend/app/routers/dev_accounts.py`, mounted only when
  `_test_seams_enabled()` (`storage.py:163`, APP_ENV dev/development/local/test). In every
  other env the routes don't exist (404), the same rule as dev-login's production 404.
- `GET /api/dev/accounts` lists the presets and, per preset, whether this stack's account
  exists yet.
- `POST /api/dev/accounts/{preset}`, body `{"reset": false}`:
  - **Per-stack identity.** The email is `dev+<preset>+<stack>@reelballers.local`. `<stack>`
    comes from a new `DEV_STACK_ID` env var that `container-stack.sh` exports (the container
    name), and `host` for a host stack. Each stack has its own user_id, so its own R2 prefix and
    CAS baseline: no stale_baseline fights between containers.
  - **empty:** always a new user (`generate_user_id()` + `create_user()` in
    `services/auth_db.py`), with a unique suffix so every pick starts clean.
    `user_session_init` creates the default profile.
  - **upload / full:** if the per-stack account is missing (or `reset` is true), clone it from a
    **template account** (below), then dev-login it. A later pick reuses the existing clone, so
    the user's in-progress test state survives a reload. The picker has a "Reset to the preset"
    option.
  - Then the same steps as `dev_login` (`auth.py:1110`): `set_current_user_id`,
    `invalidate_user_cache`, `user_session_init`, `_issue_session_cookie`.
- **Cloning** reuses the logic of `scripts/copy_user_between_envs.py`, extracted into a service
  module (for example `app/services/account_clone.py`) that the script and the endpoint both
  call. It should be a mechanical move first (Refactoring Rule 3), then a dev->dev alias mode.
  - Postgres: the users row and the `game_storage_refs` rows.
  - R2: server-side `copy_object` of the template's `{env}/users/{uid}/...` objects (per-user
    SQLite, working/final videos, posters). These are small; it takes seconds.
  - Game videos are global (`{env}/games/{blake3}.mp4`) and deduplicated, so they are never
    copied. The clone only gets a `game_storage_refs` row with a far-future
    `storage_expires_at`, plus a `game_ref_counts` increment so the sweep never deletes the
    shared video. The copy script skips that increment today; fix it in the extracted module.
  - The shared verify steps (object count, db-version, dangling media refs) run on every clone;
    a failure is a loud 500, never a half-made account.

### Templates (made once per dev environment)

- Two template accounts in dev Postgres and R2: `dev-template+upload@reelballers.local` and
  `dev-template+full@reelballers.local`, built by a new idempotent script
  `scripts/build_dev_account_templates.py`.
  - It clones from `imankh+devfixture@gmail.com` (prod-derived, already in dev), keeps ONE ready
    game, and trims the profile DB to the preset. Upload keeps the game only. Full keeps ~6
    raw_clips plus three projects:
    - Framing: `working_clips` rows, no `working_video_id`.
    - Spotlight: `working_video_id` set, `current_mode='overlay'`, no `final_video_id`.
    - Finished: `final_video_id` set, published.
  - The trim edits only the cloned template's profile.sqlite and bumps its db-version per the
    R2 version-bump rule (reference_changing_env_data). It never touches the source account.
  - The script asserts each state with a query and prints a per-preset summary. If the fixture
    has no exported final video for the chosen game, it picks another game, or fails with that
    reason.
- Migrations: template DBs migrate just-in-time at the seam like any other account, so they
  can't fall below head.

### Frontend

- `src/frontend/src/components/DevAccountPicker.jsx`: three cards with a one-line description of
  each preset's contents, a "Reset to the preset" checkbox, and a small "Use the real sign-in
  screen" link. Styled per the UI style guide.
- `App.jsx:897`: `if (!isAuthenticated) return <SignInScreen />` becomes "DEV build and the
  backend answered `GET /api/dev/accounts` with 200 -> `<DevAccountPicker/>`, else
  `<SignInScreen/>`".
  - The check runs only in `import.meta.env.DEV`, so production bundles drop the component.
  - A production build pointed at a dev backend still shows the real sign-in.
- `?dev_account=<preset>` (DEV only) logs in without showing the picker. The parameter is
  removed from the URL after the reload.

### Tooling

- `task.sh stack` / `dotask.sh stack` / `land` step 1 print the three direct links under the
  stack URL. `container-stack.sh` exports `DEV_STACK_ID`.
- Update the drive-app-as-user skill and the realAuth E2E helper to accept a preset as well as an
  email, so AI live-drives use the same isolated accounts.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/dev_accounts.py` - new dev-only router (presets list + login-as-preset)
- `src/backend/app/main.py` - mount the router only when `_test_seams_enabled()`
- `src/backend/app/routers/auth.py` - reuse dev_login's session-init + cookie path (factor a helper)
- `src/backend/app/services/account_clone.py` - new; clone logic extracted from the copy script
- `scripts/copy_user_between_envs.py` - call the extracted module (mechanical move first)
- `scripts/build_dev_account_templates.py` - new; builds the upload/full templates
- `src/frontend/src/App.jsx` - auth wall picks DevAccountPicker in dev
- `src/frontend/src/components/DevAccountPicker.jsx` - new picker UI
- `.devcontainer/container-stack.sh` - export DEV_STACK_ID
- `scripts/task.sh` - print the preset links after the stack is up
- `.claude/skills/drive-app-as-user/SKILL.md` - document the presets
- `src/frontend/e2e/helpers/realAuth.js` - log in by preset

### Related Tasks
- Placed before the Social Cover Image milestone (user-ordered 2026-10-09): every later UI task
  is tested on a local stack.
- Builds on PR 576/578 (dotask land brings up the stack and starts dev Postgres).

### Technical Notes
- **Dev only, by construction:** the routes aren't mounted outside dev/local/test, and the UI
  isn't in production bundles. Add a test that the routes 404 with APP_ENV=staging and
  production.
- **R2 cost and cleanup:** each per-stack clone copies only per-user objects. `task.sh nuke
  <slug>` should delete that stack's dev accounts and their R2 prefix (and decrement
  `game_ref_counts`). Otherwise, document a cleanup script.
- **CAS:** isolation comes from per-stack user_ids, never from coordination. Never let two stacks
  share a preset account.
- **No silent fallbacks:** if the template is missing, the picker shows "templates not built:
  run scripts/build_dev_account_templates.py", not a different account.
- **Persistence rules still apply:** the picker is a login gesture; it writes nothing reactively.

### Open questions (resolve at the Stage 2 design gate)
1. Should "Empty" be a fresh account per pick (proposed), or one per-stack account that a Reset
   empties?
2. "Full" contents: is ~6 plays + one Framing + one Spotlight + one finished clip the right
   minimum, or should it also include a highlight reel (collection) and a second profile?
3. Template source: trim from the prod-derived devfixture (real footage, proposed), or build
   from scratch through the API with a short committed sample video (reproducible on any
   machine, but needs Modal or local ffmpeg exports to reach the Spotlight and finished
   states)?

## Implementation

### Steps
1. [ ] Stage 2 design doc (`docs/plans/tasks/T11500-design.md`) from this sketch; user approval
2. [ ] Mechanical move: extract the clone logic from `copy_user_between_envs.py` into
   `app/services/account_clone.py` (characterization test first)
3. [ ] Template builder script; build both templates in dev; record the summary
4. [ ] Dev-only router + per-stack identity + clone-on-pick + session cookie (tests: gating 404
   outside dev, per-stack isolation, reuse vs reset, missing-template error)
5. [ ] DevAccountPicker + App.jsx wiring + `?dev_account=` (unit test: picker shows only when the
   endpoint answers 200)
6. [ ] container-stack.sh DEV_STACK_ID + task.sh preset links; skill and realAuth helper
7. [ ] Live check on a dotask stack: each preset lands in the described state with no sign-in

### Progress Log

**2026-10-09**: Filed from the user's request while testing g-t12010-1. The interim workaround
(paste-in `dev-login` snippet) was given in chat.

## Acceptance Criteria

- [ ] Opening any local stack URL shows the dev account picker, not the sign-in screen;
  staging/production and production builds are unchanged.
- [ ] Each preset logs straight in, and the account holds exactly the described state (verified by
  the template script's assertions and a live drive).
- [ ] Two dotask stacks using the same preset never hit `[SYNC_CONFLICT] stale_baseline` (separate
  user_ids).
- [ ] `?dev_account=<preset>` links printed by `stack`/`land` log in with one click.
- [ ] Shared game videos are never copied, and `game_ref_counts` keeps them from being swept.
- [ ] Tests pass (backend gating/isolation, frontend picker), with red-to-green proof.
