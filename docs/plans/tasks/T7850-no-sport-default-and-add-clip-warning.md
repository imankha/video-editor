# T7850: Default New Users to "No Sport" + Add Clip Warning When Sport Unset

**Status:** WIP
**Impact:** 6
**Complexity:** 4
**Created:** 2026-08-27
**Updated:** 2026-08-27

## Problem

Every new user's default profile is silently created with `sport = "soccer"` (never asked, never
chosen). Two consequences:

1. **Wrong data by default.** A basketball or lacrosse parent's account is misclassified as soccer
   the moment they sign up, until they discover the profile-edit screen and manually change it.
2. **The miscategorization is invisible.** In the Add Clip UI, the Tags section only renders when
   `getTagSet(sport)` resolves to a known set. Today `sport` always falls back to `'soccer'`
   (`currentProfile?.sport || 'soccer'`), so tag pickers just always work — silently reinforcing
   the wrong-sport default rather than surfacing it. If a user's sport were ever genuinely unset,
   the current code makes the entire Tags block vanish with no explanation, which reads as a bug,
   not a prompt to act.

## Solution

### 1. New "No Sport" state, not just an empty/soccer fallback

Introduce a real "No Sport" value (distinct from "unrecognized custom sport" and distinct from
"soccer"). New users get this by default. `getTagSet()` returns `null` for it, same as any
unrecognized sport — no tag-registry change needed there.

### 2. Change the default from `"soccer"` to "No Sport" everywhere a profile is created

Every one of these currently defaults or falls back to `"soccer"` — all need to change together
so the "no sport chosen yet" state is consistent end to end:

- `src/backend/app/session_init.py:264` — `sport = inherited_sport or "soccer"` (new-user default
  profile creation)
- `src/backend/app/services/user_db.py:80` — schema `sport TEXT NOT NULL DEFAULT 'soccer'`
- `src/backend/app/services/user_db.py:846` — `create_profile(..., sport: str = "soccer")`
- `src/backend/app/routers/profiles.py:202` — `sport = request.sport or "soccer"`
- `src/frontend/src/components/ManageProfilesModal.jsx:110,113,130,457` — `ProfileForm`'s
  `initialSport = 'soccer'` default and the `sportValue = ... : 'soccer'` fallback on submit; the
  Sport `<select>` needs a "No Sport" option distinct from the existing "Other" free-text branch

**Explicitly NOT in scope:** existing users/profiles that already have `sport = "soccer"` written.
This task changes the default for **new** profiles only — no migration, no backfill, no
reinterpreting existing soccer profiles as unset. (Follows the no-fallbacks-for-internal-data
principle in the other direction: we're not guessing at data we don't have for existing rows.)

### 3. Add Clip UI: replace the silent empty state with a warning

Three call sites currently do `{tagSet && (<TagSelector .../>)}` — when sport has no tag set
(which will now include every new user until they pick a sport), the Tags section should show a
**warning-styled** message instead of disappearing:

- `src/frontend/src/modes/annotate/components/ClipDetailsEditor.jsx:236-246` (desktop sidebar
  Add/Edit Clip form)
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.jsx:354-366` (fullscreen
  Add/Edit Clip form, desktop-width tag grid)
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.jsx:511-520` (same
  fullscreen form, compact/mobile scrub-bar tag row)
- `src/frontend/src/components/UploadClipModal.jsx:184-197` (Upload Clip modal — same pattern,
  should get the same treatment for consistency)

Message copy: something like *"Set your sport to see [Sport Name]-specific tags"* with a way to
get there (e.g. link/button opening the profile-edit sport picker, or naming the menu path if a
direct in-place jump isn't feasible). Exact copy and whether it's clickable vs. instructional-only
is a UI decision — flag for the ui-designer agent or a quick user check since this task doesn't
have a design doc gate by tier.

Styling: warning treatment per [ui-style-guide.md](../../../.claude/references/ui-style-guide.md)
(amber/yellow warning color, not error-red or neutral-gray) — this is "action recommended," not
"something broke."

**Custom/"Other" sports keep their current silent behavior** — a parent who typed in "Pickleball"
made an active choice and there's no registry entry to point them back to; the warning is
specifically for the "never chose a sport" state, not "chose a sport we don't have tags for."
This means the three call sites need to distinguish `sport === 'no_sport'` (or whatever the sentinel
value is) from "custom sport with no tag set" — both currently collapse to `tagSet === null`, so
the condition changes from `{tagSet && ...}` to a three-way branch (has tags / no-sport-set /
custom-sport-no-tags).

## Context

### Relevant Files

- `src/backend/app/session_init.py` — new-user default profile creation (line ~264)
- `src/backend/app/services/user_db.py` — schema default + `create_profile()` default param
- `src/backend/app/routers/profiles.py` — profile-create endpoint sport fallback
- `src/frontend/src/components/ManageProfilesModal.jsx` — profile create/edit form, sport `<select>`
- `src/frontend/src/modes/annotate/constants/tagRegistry.js` — `SUPPORTED_SPORTS`,
  `sportDisplayName`, `sportEmoji`/`sportEmojiOrNull`, `getTagSet` (reference only — verify
  whether "No Sport" needs an entry here or stays purely a sentinel value the UI checks for)
- `src/frontend/src/modes/annotate/components/ClipDetailsEditor.jsx` — Add Clip UI, Tags block
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.jsx` — Add Clip UI
  (fullscreen), Tags block x2 (desktop + compact)
- `src/frontend/src/components/UploadClipModal.jsx` — Upload Clip modal, Tags block

### Related Tasks

- Builds on the athlete-profile epic (T1610 profile sport field, T1620 sport tag definitions,
  T1630 sport-driven tag selection) which established the `sport || 'soccer'` fallback pattern
  this task is partially reversing.

### Technical Notes

- Decide the sentinel representation for "No Sport" before implementing: an explicit stored value
  like `sport = 'no_sport'` (queryable, matches how custom sports are stored as free text) vs.
  `sport = NULL`/`''` (means "every existing NOT NULL DEFAULT 'soccer' column read needs a
  nullable-aware fallback). An explicit sentinel string is likely simpler given `sport TEXT NOT
  NULL DEFAULT 'soccer'` is a hot-path column read in several places (`ClipDetailsEditor.jsx`,
  `AnnotateFullscreenOverlay.jsx`, `UploadClipModal.jsx`, `ManageProfilesModal.jsx`,
  `session_init.py`, `profiles.py`) — an explicit gate value avoids touching NULL-handling in all
  of them.
- Every `currentProfile?.sport || 'soccer'` read (5+ call sites, see grep below) is doing double
  duty today: "handle missing sport on old data" AND "the actual default." Once "No Sport" is a
  real value written at profile-creation time, these fallbacks become dead code for new profiles
  (still needed for any pre-existing profile rows with `sport IS NULL`, if any exist — verify).
- `getTagSet('no_sport')` returning `null` is already correct behavior (no tags to show) — the
  change is entirely in what the CALLER does with a `null` tagSet, not in `tagRegistry.js` itself.

## Implementation

### Steps
1. [ ] Decide sentinel value for "No Sport" (recommend explicit string, e.g. `'no_sport'`) and
   confirm/adjust with user if UI copy or storage format needs a design gate
2. [ ] Backend: change the three default sites (`session_init.py`, `user_db.py` x2,
   `profiles.py`) from `"soccer"` to the "No Sport" sentinel
3. [ ] Frontend: `ManageProfilesModal.jsx` — add "No Sport" as a selectable option in the Sport
   dropdown (distinct from "Other"), update `ProfileForm`'s defaults
4. [ ] Frontend: `ClipDetailsEditor.jsx`, `AnnotateFullscreenOverlay.jsx` (both blocks),
   `UploadClipModal.jsx` — replace `{tagSet && <TagSelector/>}` with a three-way branch: known
   tag set / "No Sport" warning / custom-sport-silent
5. [ ] Warning UI: build the amber/warning-styled message + set-sport affordance per
   ui-style-guide.md
6. [ ] Update `.claude/knowledge/annotate.md` if it documents the sport-fallback behavior

### Progress Log

**2026-08-27**: Task filed at user request. Investigated current default-sport call sites
(backend: session_init.py, user_db.py, profiles.py; frontend: ManageProfilesModal.jsx) and the Add
Clip UI's tag-set rendering (ClipDetailsEditor.jsx, AnnotateFullscreenOverlay.jsx x2,
UploadClipModal.jsx — all currently `{tagSet && ...}` silent-hide). Not yet classified/started.

## Acceptance Criteria

- [ ] A brand-new user's default profile is created with sport = "No Sport", not "soccer"
- [ ] Existing profiles with sport = "soccer" are unaffected (no migration/backfill)
- [ ] Profile create/edit UI offers "No Sport" as an explicit sport choice
- [ ] Add Clip UI (desktop sidebar, fullscreen, and Upload Clip modal) shows a warning-styled
  message instructing the user how to set their sport when sport = "No Sport"
- [ ] A profile with a custom/"Other" sport (no registry tag set) keeps today's behavior — no
  warning, tags section just doesn't render
- [ ] Setting a sport (from "No Sport" or from a custom sport) makes the correct tag set appear on
  the next Add Clip open
