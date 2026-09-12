# T9670: Confirm the save, readiness, publication and draft contracts

**Status:** TODO
**Impact:** 6
**Complexity:** 2
**Created:** 2026-09-10
**Updated:** 2026-09-10

## Source

2026-09-09/10 parent walkthrough of staging. Handoff archive: `C:/Users/imank/Documents/Codex/2026-09-09/can/outputs/reelballers-engineering-handoff`
Handoff item(s): **E1-01 (UX-18, UX-08, UX-13; bug B2)**.

## Why this exists

**No code.** Several tasks in this group write copy that asserts a policy, and the walkthrough found
copy that asserts policies nobody has verified. This task records the answers **from the actual
contracts** so no placeholder policy text ships.

The user asked for all seven decision and verification tasks to be filed (2026-09-10), rather than
folding them into the tier policy.

## Questions to answer

1. **Object model.** Game / Play / Clip / Reel / Published as adopted by the Shared Vocabulary epic -
   write the definitions down with an example of each, and name the source of truth in code.
2. **Save contract.** What exactly does saving a play persist? When does a clip come into existence,
   and what makes it the *same* clip on a repeat gesture rather than a duplicate?
3. **Draft privacy.** Is a private draft genuinely private, and what exactly can a link holder see?
   The walkthrough never exercised publication, so **this is unverified, not known-good.**
4. **Publication audience.** Who can see a published clip or reel, and what does the share link
   grant? T9590's copy has to state this before the click.
5. **Autosave.** Is autosave supported anywhere? The report assumes not; confirm rather than assume.
6. **Status transitions.** The authoritative list, given T8470's Draft/Shared collapse stands.

## Output

A short decision record (in this file, or a knowledge-doc section if it belongs with
`.claude/knowledge/export-pipeline.md` / `persistence-sync.md`), with examples and the code
location that is the source of truth for each answer.

## Related Tasks

- Feeds: T9580 (save contract), T9590 (publication audience), T9600 (statuses), T9520/T9530 (nouns)
- T8470 - the standing status decision this must not contradict

## Acceptance Criteria

- [x] Each of the six questions has a recorded answer with its source of truth in code
- [x] Dependent tasks reference this record rather than restating policy
- [x] No placeholder policy copy ships in any dependent task

## Decision Record (2026-09-12)

Code-verified by the code-expert agent (line numbers read, not inferred). Full detail with worked
examples lives in this task's research (see PR/commit history for the raw report); this section is
the answer dependent tasks should cite.

### 1. Object model

Game = `games` row (source video). Play = a `raw_clips` row with `filename=''` (marked time range,
no `auto_project_id`). Clip = the same `raw_clips` row once `auto_project_id` points at a `projects`
row (`is_auto_created=1`) - the clip has **no media file of its own**; playback proxies the parent
game video by byte range until a render exists. Reel = a `projects` row with `is_auto_created=0`.
Published = `final_videos.published_at IS NOT NULL` (a status on the render, not a separate object);
publishing also archives its `projects` row so it leaves the drafts list.

**Live noun collision to flag, not paper over:** the adopted vocabulary defines Reel as "assembled
from multiple clips" (`shared-vocabulary/EPIC.md:22`), but every published `final_videos` row -
including single-clip ones - lands in the surface named "Highlight Reels"
(`displayNames.js:88`, `SECTION_NAMES.LIBRARY`). Copy must not assume "Reel implies multi-clip" on
the Published surface.

Source of truth: `database.py:1179-1319,1358-1385`; `clips.py:1038-1099`; `displayNames.js`.

### 2. Save contract

"Save play" (`POST /api/clips/raw/save`, `clips.py:1174-1350`) persists exactly one `raw_clips` row
(rating/tags/notes/name/start/end/game linkage) - no crop/segment/overlay data, no media. It is
durable-synced (awaits R2 upload; failure surfaces a retryable Retry toast).

A Clip is created **at save time**, only when the request carries `create_project: true` - not at
framing time, not at export time. `_create_auto_project_for_clip` (`clips.py:1038-1099`) inserts the
`projects` + `working_clips` rows and stamps `raw_clips.auto_project_id`.

**Reuse/dedupe keys (three layers, the play-row one is the surprising one):**
- Play row: natural key `(game_id, end_time, video_sequence)` - **moving the play's start time
  re-saves onto the same row; moving the end time creates a new row.** (`clips.py:1234-1245`)
- Clip/project: a no-op once `auto_project_id` is set - clicking "Frame this clip" twice reuses the
  same project. (`clips.py:1299-1305`, `:1431-1446`)
- Client in-flight guard (not an identity rule, just suppresses a double-click race):
  `useRawClipSave.js:119-128`.

Uploaded clips (T8370 path) use a different origin/key: content-hash dedupe, `game_id` always NULL
(`clips.py:1951-1954`).

### 3. Draft privacy

**Genuinely private - structurally, not just hidden from a listing.** There is no share-token type
for a project/draft at all (only `/api/shared/` routes exist, and none resolves a `projects` row -
share creation only accepts a `final_videos` id). Every other route requires a session (401 without
one), and even an authenticated *different* account cannot address another user's project - "project
41" is a different physical SQLite row per account, with no cross-account lookup path.

**Caveat for copy:** draft media is served via presigned R2 URLs (4h default TTL) to the owner, not
cryptographically sealed forever - "private" means "unaddressable by anyone else," not "a leaked URL
can never work." Not exercised end-to-end in the walkthrough; reasoned from code.

Source of truth: `middleware/db_sync.py:630-645,836-870`; `routers/projects.py:879-893`.

### 4. Publication audience

Publishing alone (`POST /api/downloads/publish/{project_id}`) sets `published_at` and moves the reel
to the owner's own Published tab - it creates **no link and grants no audience by itself.** Sharing
is a separate, second gesture (`POST /api/gallery/{video_id}/share`).

- **Public link**: anyone with the URL, no login - read-only view **plus download**.
- **Direct email share**: only the account whose session email matches the invited recipient (case-
  insensitive), same view+download grant.
- **Collection share**: same public/recipient rule, live-evaluated set of the sharer's published
  reels.
- No further-share prevention is possible for a public link (the token IS the authorization); only
  the sharer can revoke or change visibility.

**Facts copy must not contradict:** a share link **outlives unpublishing** (only Revoke actually cuts
access - un-publish just clears `published_at`, the share resolver never checks it). Backend does not
require `published_at` to create a share (today unreachable from the UI, since ShareModal only mounts
from the published-only panel) - state this as a UI contract, not an API guarantee, since a future
surface must not assume the backend enforces "publish before share."

Source of truth: `routers/downloads.py:2088-2215,2278-2282`; `routers/shares.py:475-579,901-963,1144-1179`.

### 5. Autosave

**Confirmed: does not exist for play/clip/project content.** Machine-enforced: the custom ESLint rule
`local/no-persistence-in-effects` is `"error"` with zero disable-comments anywhere in
`src/frontend/src`. The one known prior violation (a `loadedmetadata` duration PATCH) was already
deleted; Focus's auto-save effect was explicitly removed with a tombstone comment
(`FocusContainer.jsx:1046-1047`).

Three non-click writes exist and are correctly NOT autosave (report these rather than an unqualified
"zero"): a playhead-position write on tab-hide/pagehide (view progress only, never play/clip content),
a 60s session heartbeat (Postgres analytics only, never touches profile.sqlite), and the server-side
sweep auto-export (creates a draft extract but never publishes/archives it - still requires a user
gesture to advance status).

### 6. Status transitions

**There is no single status enum** - five independent axes, and T8470's collapse applies to only one
of them:

- **Draft stage** (the T8470 single source, derived, never stored): `not_started` (Draft) ->
  `in_framing` (Draft - in AI Focus) -> `in_overlay` (Draft - in Spotlight) -> `ready` (Ready to
  Publish), computed live from clip/render state (`draftStage.js`). Published leaves this list
  entirely (archived), by design.
- **Publication**: `final_videos.published_at` NULL <-> timestamp (publish / unpublish-to-edit).
- **Game lifecycle**: `pending -> ready | upload_failed`, plus a separately-derived `active | expired`
  storage status.
- **Export jobs**: `pending -> processing -> complete | error`, with durable sub-stages.
- **Share**: `revoked_at` NULL -> timestamp; `is_public` toggle.

**Two real contradictions found between shipped code and prior recorded decisions - flag these to
whichever task owns cleanup, do not silently pick one:**
1. **T8470's task text specified the label "Ready to share" and "Shared" as the published word -
   neither shipped.** The actual code (post-T9600) uses "Ready to Publish" and "Done", with an
   in-comment rationale that routing a private draft through audience-implying language was itself
   the bug. **Downstream copy should use the code's words, not T8470's task-file text.**
2. **T9600 is STAGING, not DONE, and is only partially landed**: `DraftTile.jsx`'s status chip still
   computes from its own separate word list (`Uploading`/`Offline`/`Exporting`/`Failed`/`In
   Spotlight`/`AI Focus`/`Exported`/`Done`) that does not route through `draftStage.js` - four of
   those words aren't defined by the single source, directly contradicting T9600's own acceptance
   criterion. Any task that asserts "every status comes from one source" is asserting something
   currently false on the Clips/Reels tile.

Full file:line citations for every claim above are preserved in this task's implementation history
for the code-expert agent's research pass (2026-09-12).
