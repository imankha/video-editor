# T10860 Design — "Update shared version": re-point a share token to a moved `final_video_id` after a private re-export

**Status:** APPROVED (user, 2026-09-26, relayed by supervisor) — Q1 fold into existing read, Q2 copy
accepted, Q3 leave orphan R2 object, Q4 new endpoint confirmed, Q5 keep L-tier. See §9 for the
resolved decisions (kept for record; this doc's body is updated to match).
**Tier:** L (user overrode the Architect's M recommendation — the live-drive-proof bar stands, no
downgrade of test/review rigor)
**Author:** Architect (Stage 2)
**Date:** 2026-09-26 (amended 2026-09-26 post-approval: Q1 folded staleness detection into the
existing `GET /api/projects` read instead of a dedicated endpoint — see §3)
**Amendment 2026-09-26 (post-ship, independent reviewer finding — BLOCKING, fixed same day):**
`final_videos.id` is a PER-PROFILE SQLite autoincrement, so the same id (e.g. 1) exists
independently in every profile of one user — the original implementation scoped both the
staleness query (§3.2) and the repoint endpoint (§2.2) on `sharer_user_id` alone, never
`sharer_profile_id`. Concretely: profile A's final_video id=1 (`a1.mp4`, shared) and profile B's
final_video id=1 (`b1.mp4`, unrelated) collide; viewing profile B surfaced profile A's share as
`stale_share`, and repointing it SUCCEEDED, rewriting profile A's share row onto profile B's video
while `sharer_profile_id` stayed profile A — breaking profile A's already-distributed link for
everyone holding it. Fixed: (1) the §3.2 Postgres query now filters `AND s.sharer_profile_id =
get_current_profile_id()`; (2) the endpoint refuses 403 if `share["sharer_profile_id"] !=
get_current_profile_id()`; (3) the endpoint additionally refuses 409 `share_project_mismatch` if
the share's current `video_id` does not resolve to the SAME `project_id` as the path `video_id`
(closes a caller-supplied-token cross-project retarget, even within one profile). Regression:
`TestCrossProfileShareIsolation` in `test_t10860_repoint_share_token.py` (3 tests, confirmed RED
against the pre-fix code — genuine 200-success-and-corrupt outcomes, not incidental refusals — then
GREEN after the fix).
**Amendment 2026-09-26 #2 (post-ship, independent reviewer finding — MAJOR, fixed same day):** the
§3.2 staleness scan ordered a project's shares by `shared_at DESC` and marked the project "seen"
(stop looking) on the FIRST row encountered, regardless of whether that first (most recent) share
was already current. So a project with an OLDER stale share PLUS a NEWER current share (e.g. the
user re-shared via "Get link"/"Copy link" after the re-export, minting a fresh token) had its older
stale share silently masked forever — `stale_share` came back `null` even though the original token
was still stale. Directly violated §3.3's "order-independent and convergent" requirement, and is a
real multi-share scenario, not hypothetical. **Fix:** only mark a project "resolved" (stop scanning)
once an ACTUALLY-STALE share has been recorded for it (`project_id in stale_share_by_project`, not a
separate `seen_projects` set that any row — stale or not — added to). Stays a single batched
Postgres query + one Python pass, per Q1's approved decision — no new query. Regression:
`test_stale_share_found_even_when_masked_by_a_newer_current_share` (confirmed RED — reproduced the
exact masking — then GREEN). Also addressed the same day (MINOR, defense-in-depth):
`repoint_share_video`'s UPDATE now carries `sharer_profile_id` as an explicit WHERE-clause CAS
predicate, not solely the router's own pre-check.
**Amendment 2026-09-26 #3 (post-ship, independent reviewer finding — MAJOR, fixed same day):** the
frontend `handleUpdateShared`/`REPOINT_ERROR_MESSAGES` deviated from §5's table in four ways: (1)
410 kept the affordance visible instead of hiding it (a dead token can never succeed on retry); (2)
409 `video_not_current` never re-read staleness (no refetch — the design's own "Button re-reads
staleness" cell was unimplemented); (3) the idempotent no-op showed the same "Shared version
updated" copy as a real change, instead of §5's "Shared version is up to date" — the backend
response had NO field distinguishing the two (both returned identical `{ok, share_url}`); (4)
404/403/400 and the cross-profile fix's `share_project_mismatch` fell through to the raw backend
`detail` text instead of §5's specific copy. Fixed: (a) `ShareRepointResponse` gained `changed: bool`
(false on the idempotent branch, true on a real re-point) so the frontend can tell them apart; (b)
`repointShareLink` now returns `{shareUrl, changed}` and attaches `err.status` (the plain-
HTTPException refusals — 404/403/400/410 — carry NO machine-readable `code`, only an HTTP status);
(c) `handleUpdateShared` now hides on `err.status === 410`, refetches
`useProjectsStore.getState().fetchProjects({force:true})` and re-derives local `staleShare` on
`err.code === 'video_not_current'`, and maps every code/status to its exact §5 copy via
`REPOINT_ERROR_MESSAGES`/`REPOINT_STATUS_MESSAGES`. New/updated tests cover each behavior (hide on
410, refetch-then-retry-with-fresh-token on 409, "up to date" copy on the idempotent branch,
specific copy per 404/403/400/share_project_mismatch). Live-drive re-run against the FINAL code
(this fix + the two prior fixes) — transcript: `qa/t10860-live-drive-final.md`.
**Sources:** Task file `T10860-update-shared-version-repoint-token.md`; T10180-design §5 (the split-out rationale — EXTENDED here, not re-litigated); Code Expert Stage-1 findings (file:line map below); `persistence-sync.md` (CAS / Invariant 1 & 6 / `update_share_visibility`); `export-pipeline.md` (`publish_final_video` versioning + `keep_prior`).

---

## 0. One-line problem

A user publishes a draft, gets a share link, then privately re-exports the same project. The
re-export INSERTs a NEW `final_videos` row and repoints `projects.final_video_id` at it
(`publish_final_video.py:284-296`), but the already-distributed share token still resolves to the
OLD video (playback streams from the snapshotted `share_videos.video_filename`, `shares.py:216-220`).
Nothing re-points the existing token today. This task adds an **explicit-gesture** "Update shared
version" that CAS-safely re-points the existing token to the new export, or refuses loudly.

Non-goals: collection shares (`share_type='collection'`, no snapshot, resolved live — out of scope);
game links; reclaiming the orphaned old R2 object (see §9 Q3); auto/reactive re-pointing (banned by
Invariant 1); re-litigating T10180's phase machine.

---

## 1. Current State (file:line — from the Code Expert map, not re-derived)

### 1.1 Share read path (visitor) — playback resolves from the SNAPSHOT, not `final_videos`
- `GET /api/shared/{share_token}` → `get_shared_video` (`shares.py:901-941`).
- Resolves the row via `get_share_by_token(token)` (`sharing_db.py:120-131`).
- Playback URL built from the snapshotted `share_videos.video_filename` via `_build_video_r2_key`
  (`shares.py:216-220`, key = `{env}/users/{uid}/profiles/{pid}/final_videos/{video_filename}`) —
  it NEVER re-reads `final_videos`.
- `share_videos.video_id` (= a `final_videos.id`) is used ONLY for the live intro/metadata read
  (`_resolve_share_video_intro`, `shares.py:294-297`, `SELECT intro_card_id, duration, aspect_ratio
  FROM final_videos WHERE id = ?`).
- **Consequence:** a correct re-point MUST move BOTH `video_id` AND `video_filename` together;
  moving one leaves a split-brain share (right video plays, wrong intro/metadata, or vice-versa).

### 1.2 Association schema (Postgres, `pg.py`)
- `shares` (`pg.py:135-147`): `id SERIAL PK`, `share_token TEXT UNIQUE`, `share_type` CHECK
  includes `'video'`, `sharer_user_id`, `sharer_profile_id`, `recipient_email`, `revoked_at`.
- `share_videos` (`pg.py:152-159`): `share_id INTEGER PK REFERENCES shares(id) ON DELETE CASCADE`,
  `video_id INTEGER NOT NULL`, `video_filename TEXT NOT NULL` (the streamed R2 object), `video_name`,
  `video_duration`, `is_public`.
- **Both target columns are plain mutable columns.** MIGRATION VERDICT: **NONE** (confirmed by the
  Code Expert — the token is not immutably bound to a version).

### 1.3 Mint path (single-video share) — the token this task re-points
- `DraftReelPreview.jsx:149`/`:158` → `useWebShare.createShareLink({ downloadId: payload.finalVideoId })`
  → `createShareUrl` (`useWebShare.js:17-35`) → `POST /api/gallery/{finalVideoId}/share`
  (`{recipient_emails: [], is_public: true}`) → `create_share` (`shares.py:475-579`) →
  `create_shares` (`sharing_db.py:57-93`) INSERTs `shares` (`share_type='video'`) + `share_videos`
  with `video_id`=the final_video id and `video_filename`=that video's current filename.
- The returned URL is `${window.location.origin}/shared/${share_token}` (`useWebShare.js:27`).

### 1.4 The idempotent-reuse landmine (the reason this is subtle) — `sharing_db.py:96-117`
- `get_active_public_share_for_video(video_id, sharer_user_id, video_filename)` reuses an existing
  public share ONLY when its `video_filename` STILL matches the video's CURRENT filename
  (`WHERE sv.video_id=%s AND s.sharer_user_id=%s AND sv.video_filename=%s AND sv.is_public AND
  s.revoked_at IS NULL`).
- So **after a re-export, clicking "Copy Link"/"Get link" again already mints a BRAND-NEW token**
  (new URL) — the old snapshot no longer matches, reuse is skipped, `create_shares` runs. This is
  by design for the copy-link gesture (T10180 §1.4). T10860's job is the OTHER gesture: preserve the
  **already-distributed** URL by re-pointing the EXISTING token in place.
- These two gestures must NOT fight: "Get link" (mint, new token on stale) vs "Update shared version"
  (re-point existing token, same URL). §3 resolves who owns which.

### 1.5 `final_videos` versioning + `keep_prior` — `publish_final_video.py`
- `publish_final_video` (`:164`), called by `export_final` (`overlay.py:1719`) and
  `_finalize_overlay_export` (`overlay.py:123`), INSERTs a NEW row (`:284-293`, `version=MAX+1`
  `:223-227`), sets `final_video_id=lastrowid` (`:294`), and repoints
  `UPDATE projects SET final_video_id=? WHERE id=?` (`:296`) in ONE transaction.
- `keep_prior = prior_final_is_shared(prior_filename)` (`:221`, via `filename_has_active_share`
  `sharing_db.py:23-41`): when an active share still points at the old filename, the re-export KEEPS
  the old R2 object AND its `final_videos` row alive. Fail-safe = keep (`publish_final_video.py:56-71`).
  **This is what makes T10860 possible:** after a re-export of a shared reel, the old object is still
  in R2 (serving the old link) AND the new object exists — so a re-point has a live target.

### 1.6 CAS precedent to MIRROR — `update_share_visibility` (`sharing_db.py:149-161`)
```sql
UPDATE share_videos SET is_public = %s
  FROM shares
 WHERE share_videos.share_id = shares.id
   AND shares.share_token = %s
   AND shares.sharer_user_id = %s
   AND shares.revoked_at IS NULL
```
returns `cursor.rowcount > 0`. The ownership gate mirrors `patch_shared_video`'s 403
(`shares.py:1144-1160`). This is the EXACT shape for the re-point UPDATE. Because the re-point is a
**Postgres** write, the SQLite CAS / R2-version machinery does NOT apply — "prove current or fail
loudly" here is (a) the conditional UPDATE + ownership predicate + rowcount check, and (b) an R2 HEAD
confirming the NEW object exists before repointing.

### 1.7 R2 existence-check primitive available
- `r2_head_object(user_id, relative_path)` (`storage.py:941-964`) HEADs a per-profile object in the
  CURRENT profile context, returns metadata dict or `None`. **In the re-point endpoint the caller IS
  the sharer**, so `get_current_user_id()`/`get_current_profile_id()` context matches the object's
  owner — `r2_head_object(user_id, f"final_videos/{new_filename}")` is the correct existence probe
  (mirrors `filename_has_active_share`'s fail-safe stance, but here we fail CLOSED: absent object =
  refuse). This is the same relative-path shape `create_share` implicitly relies on.

### 1.8 Frontend anchor (T10180 shipped — EXTEND it)
- `DraftReelPreviewInner` (`DraftReelPreview.jsx:65`): `phase` state
  (`'idle'|'review'|'publishing'|'ready'|'ready-capable'|'failed'`), `shareUrl` (`:78`).
- Gesture handlers: `handleConfirmPublish` (`:140-152`), `handleGetLinkCapable` (`:157-161`),
  `handleCopy` (`:166-176`), `handleNativeShare` (`:180-195`). All are named onClick chains — NO
  reactive persistence effect (only the quest timer `:89-94` and off-page cleanup `:52-54`).
- `PublishLinkFlow` rendered via the `actionBar` slot (`:252-266`). `payload.finalVideoId` in scope;
  `payload.alreadyPublished` seeds `'ready-capable'`.
- **`displayNames.js`:** `RESULT_PUBLISH` block (`:178-192`) — the comment at `:176-177` explicitly
  reserves the "Update shared version" copy for T10860. No such string exists yet.

### 1.9 The staleness-detection gap (critical — drives §3)
- `payload` (built by `openFinishedReel`, `finishedReelNav.js:28-50`) carries `finalVideoId`
  (= the project's CURRENT `final_video_id`), `name`, `alreadyPublished` — but **NO share token and
  NO indication that a pre-existing token points at an older video.**
- `list_shares_for_video(video_id, sharer_user_id)` (`sharing_db.py:134-146`) queries
  `WHERE sv.video_id = %s`. After a re-export the stale token's `share_videos.video_id` still holds
  the OLD id, so **querying by the NEW `payload.finalVideoId` returns nothing** — the stale token is
  invisible to a naive lookup keyed on the current id. Any staleness detector must key on
  `(project_id, sharer)` and compare the share's `video_filename` against the project's CURRENT
  `final_videos.filename`, NOT on `video_id` equality with the current id.

---

## 2. Target State — the CAS-safe re-point

### 2.1 New backend query — `sharing_db.py` (mirror `update_share_visibility`)

```python
def repoint_share_video(
    token: str, sharer_user_id: str, new_video_id: int,
    new_video_filename: str, new_video_name: str | None, new_video_duration: float | None,
) -> bool:
    """Re-point a single-video share's snapshot to a moved final_video (T10860).
    Moves video_id + video_filename (+ name/duration) TOGETHER in one conditional
    statement. Ownership + not-revoked gate mirrors update_share_visibility; the
    rowcount is the CAS verdict (0 => refuse, the row the user saw is not the row
    on the server)."""
    with get_sharing_db() as conn:
        cur = conn.cursor()
        cur.execute(
            """UPDATE share_videos
                  SET video_id = %s, video_filename = %s,
                      video_name = %s, video_duration = %s
                 FROM shares
                WHERE share_videos.share_id = shares.id
                  AND shares.share_token = %s
                  AND shares.sharer_user_id = %s
                  AND shares.share_type = 'video'
                  AND shares.revoked_at IS NULL""",
            (new_video_id, new_video_filename, new_video_name, new_video_duration,
             token, sharer_user_id),
        )
        return cur.rowcount > 0
```
`video_name`/`video_duration` are refreshed alongside so the visitor page's title/duration match the
re-exported reel (the intro read at `shares.py:294-297` already reads live `final_videos` by the new
`video_id`, but `video_name`/`video_duration` are snapshot columns and would otherwise stay stale).

### 2.2 New endpoint — **extend the `/api/gallery/{video_id}/share` router, new sub-route**

**Decision: a NEW route `POST /api/gallery/{video_id}/share/repoint`, NOT an extension of
`patch_shared_video`.** Justification in §4.

```
POST /api/gallery/{final_video_id}/share/repoint
  auth: current session (sharer); user_id = get_current_user_id(), profile_id = get_current_profile_id()
  path param final_video_id: the project's CURRENT final_videos.id (payload.finalVideoId)
  body: { "share_token": "<the existing token to re-point>" }
  response 200: { "ok": true, "share_url": "<unchanged /shared/{token}>" }
```

Handler logic (all refuse-conditions are explicit HTTP errors — never a silent no-op):

```
1. user_id, profile_id = current session
2. row = SELECT fv.id, fv.filename, COALESCE(fv.name, p.name) AS name, fv.duration,
                p.final_video_id
           FROM final_videos fv JOIN projects p ON fv.project_id = p.id
          WHERE fv.id = %s   (SQLite, get_db_connection — same read create_share does :482-488)
   if not row -> 404 "Video not found"
3. # "prove current": the id the user is looking at must BE the project's current final video.
   if row.final_video_id != final_video_id -> 409 {"code": "video_not_current"}
        ("This draft was re-exported again; reopen it and try Update shared version.")
4. share = get_share_by_token(token)
   if not share -> 404 "Share not found"
   if share.revoked_at -> 410 "This share has been revoked"
   if share.sharer_user_id != user_id -> 403 "Only the sharer can update this share"
   if share.share_type != 'video' -> 400 "Not a single-video share"
5. # already pointing at this video+filename? idempotent success (repeat click / no-op re-point).
   if share.video_id == final_video_id and share.video_filename == row.filename:
        return { ok: true, share_url }
6. # "prove the target object exists": the new final video's R2 object must be present
   # (keep_prior kept the OLD one; the NEW one is what we now point at).
   if r2_head_object(user_id, f"final_videos/{row.filename}") is None -> 409 {"code": "target_missing"}
        ("The re-exported video isn't available yet. Try again in a moment.")
7. ok = repoint_share_video(token, user_id, row.id, row.filename, row.name, row.duration)
   if not ok -> 409 {"code": "repoint_conflict"} ("This share was changed or revoked; refresh and retry.")
8. return { ok: true, share_url: f".../shared/{token}" }
```

Steps 3 and 6 are the two halves of "prove current or fail loudly" for this Postgres write; step 7's
rowcount is the CAS verdict for a concurrent revoke/mutation between the read and the write.

### 2.3 Frontend `useWebShare.js` — add `repointShareLink`
Add a sibling to `createShareLink`:
```js
const repointShareLink = useCallback(async ({ downloadId, shareToken }) => {
  const resp = await apiFetch(`${API_BASE}/api/gallery/${downloadId}/share/repoint`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ share_token: shareToken }),
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    const err = new Error(data.detail || 'Failed to update shared version');
    err.code = data.code; // video_not_current | target_missing | repoint_conflict
    throw err;
  }
  const data = await resp.json();
  return data.share_url;
}, []);
```
Additive; returned in the hook's object alongside `createShareLink`.

---

## 3. The "which token" decision + staleness detection (AMENDED per approved Q1: fold, not dedicated GET)

### 3.1 Which token
The affordance re-points the **specific existing token the user already distributed**, identified by
`share_token`. That token must be in the frontend's scope. Two possible sources:

- **In the SAME preview session** where the user clicked "Get link"/published: `shareUrl` (and thus
  the token) is already in `DraftReelPreviewInner` state (`:78`). But in that same session a re-export
  has NOT happened (you can't re-export from inside the preview), so there is nothing to re-point yet.
- **The realistic flow** is: publish + get link (session A) → later re-export in Focus/Overlay
  (session B) → reopen the preview (session C, fresh mount, `payload.finalVideoId` = the NEW id,
  `shareUrl` null). Here the frontend has NO token in scope and MUST discover the stale token from
  the backend.

**Therefore the frontend needs a read that returns the stale token for this project.** The existing
`list_video_shares` (`shares.py:582`) keys on `video_id` and would miss it (§1.9). We need a
project-scoped, staleness-aware read — **folded into an existing read, per approved Q1**, not a new
endpoint.

### 3.2 Fold target — `GET /api/projects` → `ProjectListItem` (confirmed file:line)

**The exact "existing preview-open read":** `DraftTile.jsx:304`/`:756`/`:858` call
`openFinishedReel(project)` **synchronously with an already-fetched row** — no fresh backend call
happens at preview-open time (`finishedReelNav.js:28-52` builds the ephemeral store payload purely
from the `project` object it's handed). That `project` object is one row of the list returned by
`GET /api/projects` (`list_projects`, `projects.py:610`), typed `list[ProjectListItem]`
(`ProjectListItem`, `projects.py:245-279`, which already carries `final_video_id`, `is_published`,
`has_final_video` per row). **This is the fold target.**

Add a new field to `ProjectListItem`:
```python
stale_share: dict | None = None
# { "share_token": str, "old_filename": str } when a non-revoked single-video share for
# this project points at a filename different from the project's CURRENT final_videos
# filename; None otherwise (covers: never shared, share matches current, or revoked).
```

**Batched computation (NOT N+1):** `_read_projects_list()` (`projects.py:310`) already does one
SQLite pass for all projects on the request. After that pass, collect the `(project_id,
final_video_id, current_filename)` triples for projects where `is_published` is true (only published
projects can have a share), then issue **ONE additional Postgres query** for all of them together:

```sql
SELECT DISTINCT ON (sv.video_id) sv.video_id, s.share_token, sv.video_filename
  FROM shares s
  JOIN share_videos sv ON sv.share_id = s.id
 WHERE sv.video_id = ANY(%s)   -- the SQLite final_videos ids for ALL published projects on this page
   AND s.sharer_user_id = %s AND s.share_type = 'video' AND s.revoked_at IS NULL
 ORDER BY sv.video_id, s.shared_at DESC
```

This returns at most one row per `video_id` actually shared — but recall (§1.9) the STALE token's
`video_id` is the OLD id, not the project's current one, so querying `video_id = ANY(current ids)`
**still misses it**, same gap as before. The correct batched shape instead queries by
**`sharer_user_id` + `share_type='video'` + not-revoked, returns ALL of that sharer's video shares**,
and the Python side matches each returned share to its owning project by looking up
`share_videos.video_id` (a `final_videos.id`) against the **already-collected SQLite `(final_video_id
→ project_id, current_filename)` map** built during the same list pass (any `final_videos.id` for
ANY version of a project, not just current — a stale share's `video_id` points at a NON-current
version of some project's `final_videos`, so the map must include every final_videos row per
project, not only the current one). A share whose `video_id` isn't in that map (deleted/foreign) is
ignored. Then per project: `stale_share = share if share.video_filename != current_filename else None`.

This is still a small, explicit two-step read (one SQLite pass, one Postgres query) run inside the
existing `_read_projects_list()` worker-thread call — no new abstraction, no new call site for the
CAS/sync machinery (read-only).

### 3.3 When the affordance appears
The list read above populates `stale_share` on the `ProjectListItem`. `finishedReelNav.js`'s
`openFinishedReel` (`:28-52`) is extended to snapshot `staleShare: project.stale_share ?? null` into
the `reelPreviewStore` payload alongside the existing fields (mechanical addition, same shape as
`gameId`/`alreadyPublished`). `DraftReelPreviewInner` reads `payload.staleShare` — **no separate
network call, no effect** — and if non-null shows an "Update shared version" affordance (button) in
the `ready`/`ready-capable` region; otherwise it does not. This is a plain prop/state read, not a
gesture, and involves no write. The button's click handler calls `repointShareLink({ downloadId,
shareToken: payload.staleShare.share_token })` — the SAME endpoint/shape as before (§2), unaffected
by the Q1 change.

**Reconciliation with the mint gesture (§1.4):** the two never overlap. When a stale token exists,
"Update shared version" is offered and re-points THAT token (same URL). "Get link"/"Copy link"
continue to mint/reuse per `get_active_public_share_for_video` — after a re-point the current-filename
share IS the just-re-pointed token, so a subsequent "Copy link" reuses it (same URL) rather than
minting a third. Order-independent and convergent.

**Staleness snapshot lifetime:** like every other field `openFinishedReel` snapshots, `staleShare` is
frozen at the moment the tile was clicked — it does not live-update while the preview is open (T10180
§ already accepts this staleness class for `alreadyPublished`/`finalVideoId`; consistent, not a new
risk). A successful re-point clears the affordance in local state (§6); the NEXT open of `GET
/api/projects` will naturally return `stale_share: null` once Postgres reflects the update.

### 3.4 Resolved (was open judgment call)
Q1 is resolved: fold into the existing `GET /api/projects` read (§3.2), not a dedicated endpoint.
Rationale for the record: avoids a second round-trip on every preview open, reuses the list's
already-batched worker-thread read, and keeps `DraftReelPreview`'s mount effect-free (no new fetch to
guard against being reactive).

---

## 4. Design decisions

| Decision | Options | Choice | Rationale |
|----------|---------|--------|-----------|
| New endpoint vs extend `patch_shared_video` | extend PATCH `/api/shared/{token}` / new `POST /api/gallery/{id}/share/repoint` | **New route under `gallery_shares_router`** | `patch_shared_video` is auth-by-`X-User-ID`-header on the PUBLIC `/api/shared` router (visibility toggle, `shares.py:1144`); re-point is a SHARER action needing the SQLite `final_videos`/`projects` read + R2 HEAD in the sharer's OWN session context (`get_current_user_id`/`get_current_profile_id`), exactly like `create_share` (`:475`). Co-locating with `create_share` shares the ownership+video-read shape and keeps the "prove current" SQLite read in the right context. Overloading PATCH would conflate two unrelated writes and force the SQLite read onto the wrong router. |
| Move `video_id` alone vs `video_id`+`video_filename` (+name/duration) | one column / all snapshot columns | **All snapshot columns, one statement** | Playback resolves from `video_filename`, intro/metadata from `video_id`; name/duration are stale snapshots. Moving a subset = split-brain share (§1.1). One UPDATE = atomic. |
| CAS mechanism | new machinery / mirror `update_share_visibility` | **Mirror `update_share_visibility`** | Postgres conditional UPDATE + ownership predicate + rowcount is the established, greppable pattern (`sharing_db.py:149`). No SQLite/R2-version CAS applies to a Postgres row. |
| "Prove current" | trust the id / verify project's current final_video_id + R2 HEAD of new object | **Verify both** | CLAUDE.md "prove its copy is current or fail loudly." Refuse if the id isn't the project's current final video (another re-export happened) or the new R2 object is absent. |
| Staleness detection key | `video_id == current id` / `video_filename != current filename` | **filename mismatch, keyed on project** | The stale token's `video_id` is the OLD id, so an id-equality lookup misses it (§1.9). |
| Trigger | reactive effect on new export / explicit button + read-only staleness GET | **Explicit button; GET is read-only** | Invariant 1: re-point fires on a named gesture, never a `useEffect`→write. A GET that reads staleness is allowed (read-only, no write-back). |
| Reclaim old R2 object after re-point | reclaim now / leave it | **Leave it (this task)** | After re-point the old object is orphaned (no active share points at it), a small ongoing storage cost — but reclamation is a separate cleanup concern (§9 Q3), not required for correctness. |

---

## 5. Refuse-on-conflict / fail-loud semantics

| Condition | Detection | HTTP | User sees |
|-----------|-----------|------|-----------|
| Path video id isn't the project's current final video (another re-export raced) | `projects.final_video_id != final_video_id` (step 3) | 409 `video_not_current` | toast: "This draft changed; reopen it and try Update shared version." Button re-reads staleness. |
| Token not found | `get_share_by_token` None (step 4) | 404 | toast: "That share no longer exists." |
| Token revoked | `share.revoked_at` (step 4) | 410 | toast: "This share was revoked." Affordance hides. |
| Caller isn't the sharer | `share.sharer_user_id != user_id` (step 4) | 403 | toast: "Only the sharer can update this share." |
| Not a single-video share | `share.share_type != 'video'` (step 4) | 400 | toast: "This share can't be updated this way." |
| New R2 object absent | `r2_head_object(...) is None` (step 6) | 409 `target_missing` | toast: "The re-exported video isn't ready yet; try again shortly." |
| Concurrent revoke/mutation between read and write | `repoint_share_video` rowcount 0 (step 7) | 409 `repoint_conflict` | toast: "This share changed; refresh and retry." |
| Already current (idempotent) | `video_id == id and video_filename == filename` (step 5) | 200 (no-op) | success toast: "Shared version is up to date." |

Every branch is an explicit response. There is never a silent no-op (idempotent case returns an
explicit success) and never a blind overwrite (a stale/absent target refuses before any write).

---

## 6. Persistence check (every new gesture)

| Gesture (named) | Handler | Write | Reactive? |
|-----------------|---------|-------|-----------|
| Projects list loads (existing gesture, unchanged trigger) | `list_projects` / `GET /api/projects` | none — `stale_share` is a read-only computed field folded into the existing response (§3.2) | No new write; no new call site. |
| Preview opens | `openFinishedReel` snapshots `payload.staleShare` from the already-fetched project row | none | No — plain in-memory snapshot, no network call, no effect. |
| "Update shared version" click | `handleUpdateShared` → `repointShareLink` | Postgres `UPDATE share_videos` via `POST .../share/repoint` (surgical: only the moved snapshot columns) | No — inside the onClick chain |
| Backend re-point | `repoint_share_video` | single conditional UPDATE, ownership-gated, rowcount-checked | No (authorized sharer gesture; not editor reactive persistence) |

**Confirmed:** no `useEffect` watches state to trigger a write. The staleness signal rides an
EXISTING read (the projects list) as a computed field, adding no new fetch and no new effect. The
re-point is a surgical Postgres UPDATE carrying ONLY the moved snapshot columns. No full-state blob.

---

## 7. Risks

| Risk | Mitigation |
|------|-----------|
| **R1 — Split-brain (video plays, wrong intro/metadata).** Moving only one column. | Single UPDATE moves `video_id`+`video_filename`+name+duration together (§2.1). Unit test asserts all four move. |
| **R2 — Stale token invisible (id-keyed lookup misses it).** `list_shares_for_video` keys on the OLD id. | Staleness read keys on `video_filename != current filename` over the project's final-video id set (§3.2). Unit test: re-exported project surfaces the old token. |
| **R3 — Cross-store join gap.** `final_videos` is SQLite, `shares` is Postgres; `sv.video_id` can't be SQL-joined across. | Two-step read in the sharer's context (§3.2): SQLite id/filename set, then Postgres lookup within that set. No cross-DB join attempted. |
| **R4 — Re-pointing to a not-yet-uploaded object.** New `final_videos` row exists but R2 upload lagging. | R2 HEAD (step 6) refuses with `target_missing` before the write; user retries. |
| **R5 — Double gesture (mint vs re-point) forking into two links.** | Re-point preserves the SAME token; after it, the current-filename share IS that token, so a later "Get link" reuses it (`get_active_public_share_for_video` matches). Convergent (§3.3). Test both orders. |
| **R6 — Racing re-export during re-point.** User re-exports again between staleness read and click. | Step 3 (`final_video_id != current`) refuses `video_not_current`; step 7 rowcount refuses a concurrent revoke. |
| **R7 — `r2_head_object` context mismatch.** It uses the CURRENT profile context. | Correct here: the caller IS the sharer, so current context = object owner. Documented in the handler; a non-sharer is already rejected at step 4 before any HEAD. |
| **R8 — `keep_prior` regression coupling.** If a future change makes re-export drop the old object even when shared, this feature is unaffected (it points at the NEW object) but the OLD link breaks between re-export and re-point. | Out of scope; the existing `filename_has_active_share` fail-safe (`:56-71`) already keeps the old object while a share points at it — the window is only until the user re-points. Note for the reviewer. |

---

## 8. Test plan (curated relevant set)

**Backend unit (pytest, Postgres + SQLite fixtures):**
1. `repoint_share_video` moves `video_id`+`video_filename`+name+duration together; rowcount 1; a
   subsequent `get_share_by_token` returns the new snapshot. (Happy path.)
2. `repoint_share_video` refuses (rowcount 0 → False) on: revoked share; wrong `sharer_user_id`;
   non-`'video'` share_type. (CAS-refusal cases — the core acceptance bar.)
3. `list_projects`'s batched staleness computation (§3.2) returns the OLD token in `stale_share` on
   the affected `ProjectListItem` after a simulated re-export (new `final_videos` row + moved
   `projects.final_video_id`, old token's `video_filename` unchanged), returns `stale_share: null`
   when the token already matches the current filename, and does not N+1 (assert Postgres query
   count is O(1) for a page of many published projects, not O(n)).
4. Endpoint `POST .../share/repoint`: 409 `video_not_current` when path id != project's current
   final video; 409 `target_missing` when `r2_head_object` (mocked None) fails; 200 idempotent when
   already current; 200 + unchanged `share_url` on success; 403 non-sharer; 410 revoked.

**Frontend unit (Vitest):**
5. `DraftReelPreview` — with `payload.staleShare` non-null, renders the "Update shared version"
   affordance in the ready region; hidden when `staleShare` is null. Assert ZERO network calls fire
   on mount (staleness rides the already-fetched project row; no new fetch to violate Invariant 1).
   `finishedReelNav.openFinishedReel` — snapshots `project.stale_share` into `staleShare` on the
   store payload (mechanical, same pattern as `alreadyPublished`).
6. Click "Update shared version" → `repointShareLink` called with the stale token; success toast;
   affordance hides. Error `code` maps to the correct toast (R2/R6 refusals).

**E2E / live-drive (Playwright, real account via `loginAsRealUser`) — the CORE acceptance bar
(AC line 75; must run against a live backend, cannot be proven in a container):**
7. Full flow on a real account: publish a draft → Get link (capture URL T) → confirm `GET /shared/T`
   resolves to video V1 (assert `video_url`/`video_name`) → privately re-export the SAME project
   (produces V2, moves `projects.final_video_id`) → reopen preview → assert "Update shared version"
   appears → click it → assert `GET /api/shared/{T}` (SAME token/URL) now resolves to V2 (different
   `video_url` object / refreshed duration), and the token string is UNCHANGED. Record base/head
   revisions, request/response bodies, and the before/after `video_url` R2 keys as proof.

Curated set: backend 1-4 (the CAS refusal + staleness + endpoint contract) + frontend 5-6 (affordance
+ gesture) + the live e2e (7). Branch CI runs the full affected-layer suites as the mandatory sweep.

---

## 9. OPEN QUESTIONS — RESOLVED (user decision, relayed 2026-09-26)

- **Q1 (staleness read shape): RESOLVED — fold into the existing `GET /api/projects` read** (a
  `stale_share` field on `ProjectListItem`), not a dedicated endpoint. See §3.2 for the exact
  batched (non-N+1) implementation this drove.
- **Q2 (copy string): RESOLVED — accepted as proposed.** `RESULT_PUBLISH.UPDATE_SHARED = 'Update
  shared version'` + `UPDATE_SHARED_HINT = 'Your link still shows the old export. Update it to point
  at the latest.'`. Implementor flags any vocabulary conflict found during implementation instead of
  silently changing the copy.
- **Q3 (orphaned old R2 object): RESOLVED — leave it.** Do not reclaim in this task. The old object
  becomes an ordinary orphan (small ongoing storage cost, no correctness impact) after a re-point;
  reclamation is a separable future cleanup concern.
- **Q4 (new-endpoint vs extend): RESOLVED — new endpoint confirmed.** `POST
  /api/gallery/{final_video_id}/share/repoint` per §2.2/§4, not an overload of `patch_shared_video`.
- **Q5 (tier): RESOLVED — keep L-tier.** The live-drive-proof bar (§8 test 7) stands; no downgrade of
  test/review rigor despite the Architect's M-sized implementation estimate.
