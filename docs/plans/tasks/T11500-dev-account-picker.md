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
presets. **Every pick creates a brand-new account** imported from that preset's stored data
(user decision 2026-10-09), so each test starts from exactly the preset state:

| Preset | What the account holds |
|---|---|
| **Empty account** | A brand-new user: no games, no clips, default profile. |
| **Just an upload** | One ready uploaded game. No annotations, no projects. |
| **Full account** | Two profiles. The default profile has one ready uploaded game with ~6 annotated plays; one clip in Framing (never exported); one clip in Spotlight/Overlay (framing exported, no final); one finished clip (final video, published). The second profile holds at least one game of its own. A highlight reel is added once the app supports reels (T11300, see Related Tasks). |

Stack output prints direct links that skip even the picker, for example
`http://localhost:5174/?dev_account=full`.

### Flow

```
App load (DEV build) -> GET /api/auth/me -> 401
  -> GET /api/dev/accounts            (dev backend: 200 + presets; anything else: 404)
     -> 200: render <DevAccountPicker/> instead of <SignInScreen/>   (App.jsx:897)
     -> 404: render <SignInScreen/> as today
  -> click preset (or ?dev_account=<preset> in the URL)
     -> POST /api/dev/accounts/<preset>
        backend: create a NEW account in that state (empty, or cloned from the preset's
                 template), run user_session_init, issue the rb_session cookie (as dev-login)
     -> clear sessionStorage rb_profile_id, location.reload()   (initSession is cached)
```

### Backend

- New router `src/backend/app/routers/dev_accounts.py`, mounted only when
  `_test_seams_enabled()` (`storage.py:163`, APP_ENV dev/development/local/test). In every
  other env the routes don't exist (404), the same rule as dev-login's production 404.
- `GET /api/dev/accounts` lists the presets and whether each preset's template exists.
- `POST /api/dev/accounts/{preset}` (no body):
  - **Every pick is a new account** (user decision 2026-10-09). The email is
    `dev+<preset>+<stack>+<yyyymmddThhmmss>@reelballers.local`. `<stack>` comes from a new
    `DEV_STACK_ID` env var that `container-stack.sh` exports (the container name), and `host`
    for a host stack; it lets `task.sh nuke` find a stack's accounts. Every account has its own
    user_id, so its own R2 prefix and CAS baseline: no stale_baseline fights between containers
    or picks.
    - **empty:** a new user (`generate_user_id()` + `create_user()` in `services/auth_db.py`);
      `user_session_init` creates the default profile.
    - **upload / full:** a new user cloned from that preset's **template account** (below).
  - A reload keeps the cookie, so the current test account stays logged in until the next pick.
    There is no reset or reuse: picking again is the reset.
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
    raw_clips plus three projects in its default profile, and a second profile with one game:
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
  each preset's contents ("creates a new account"), and a small "Use the real sign-in screen"
  link. Styled per the UI style guide.
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
- Reel in the Full preset waits on T11300 (Reels v2, ICE since 2026-09-24).

### Technical Notes
- **Dev only, by construction:** the routes aren't mounted outside dev/local/test, and the UI
  isn't in production bundles. Add a test that the routes 404 with APP_ENV=staging and
  production.
- **R2 cost and cleanup:** every pick creates an account, so they accumulate. Each clone copies
  only per-user objects (seconds, small). `task.sh nuke <slug>` deletes that stack's
  `dev+*+<stack>+*` accounts, their R2 prefixes and their `game_ref_counts` increments. A
  `scripts/cleanup_dev_accounts.py --older-than 7d` covers host stacks and leftovers. Never
  delete the templates.
- **CAS:** isolation comes from a new user_id per pick, never from coordination.
- **No silent fallbacks:** if the template is missing, the picker shows "templates not built:
  run scripts/build_dev_account_templates.py", not a different account.
- **Persistence rules still apply:** the picker is a login gesture; it writes nothing reactively.

### Decisions (user, 2026-10-09)
1. **Every pick is a new account** imported from the preset's stored data: effectively three
   new accounts every time, each with a different starting point. No reuse, no reset option.
2. **Full includes a second profile and a highlight reel.** The reel part waits for reel support:
   T11300 (Reels v2, multi-clip highlight reel) is on ICE since 2026-09-24 ("NOT next
   version"), so T11500 ships Full without the reel. When T11300 lands, add a reel to the full
   template (template script + an acceptance check). The user floated building reel support
   first; that is a roadmap call on T11300, not part of this task.
3. **Templates come from real data:** trimmed from the prod-derived dev fixture account.

## Implementation

### Steps
1. [ ] Stage 2 design doc (`docs/plans/tasks/T11500-design.md`) from this sketch and the
   decisions above; user approval
2. [ ] Mechanical move: extract the clone logic from `copy_user_between_envs.py` into
   `app/services/account_clone.py` (characterization test first)
3. [ ] Template builder script; build both templates in dev; record the summary
4. [ ] Dev-only router + new account per pick + session cookie (tests: gating 404 outside dev,
   each pick is a distinct user_id, missing-template error)
5. [ ] DevAccountPicker + App.jsx wiring + `?dev_account=` (unit test: picker shows only when the
   endpoint answers 200)
6. [ ] container-stack.sh DEV_STACK_ID + task.sh preset links + nuke/cleanup of dev accounts;
   skill and realAuth helper
7. [ ] Live check on a dotask stack: each preset lands in the described state with no sign-in

### Progress Log

**2026-10-09**: Filed from the user's request while testing g-t12010-1. The interim workaround
(paste-in `dev-login` snippet) was given in chat. User decisions recorded: a new account every
pick, Full adds a second profile (reel deferred to T11300), real-data templates.

## Acceptance Criteria

- [ ] Opening any local stack URL shows the dev account picker, not the sign-in screen;
  staging/production and production builds are unchanged.
- [ ] Each preset logs straight in, and the account holds exactly the described state (verified by
  the template script's assertions and a live drive).
- [ ] Every pick is a new account (distinct user_id), so stacks and picks never hit
  `[SYNC_CONFLICT] stale_baseline`.
- [ ] Full has two profiles. The highlight reel is a follow-up once T11300 ships.
- [ ] `task.sh nuke` and the cleanup script remove accumulated dev accounts, never the templates.
- [ ] `?dev_account=<preset>` links printed by `stack`/`land` log in with one click.
- [ ] Shared game videos are never copied, and `game_ref_counts` keeps them from being swept.
- [ ] Tests pass (backend gating/isolation, frontend picker), with red-to-green proof.
