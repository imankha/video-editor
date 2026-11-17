# T16535 design: archiving a finished project keeps its clips

**Status:** approved with option A (owner, 2026-11-16): leave the game video to its own paid 30-day expiry; no early delete, no new UI, no refund rule.
**Expert review:** Opus expert, 2026-11-16 (verdict: design sound; C2 needs an owner ruling)

## In plain words

Today, once a highlight is finished, the sign-in cleanup ("archive") copies the project's crop and spotlight data into a backup file and deletes it from the account database. Redoing that highlight then needs a restore from the backup first. After this change the archive deletes nothing: it only marks the project finished. Redo then reads the data that is still there.

One part of the ruling needs a decision before I build it: **what happens to the game video.** The archive has never touched the game video. That video is shared and paid for, and it already has its own expiry: 30 days of storage bought with credits, which can be extended. A game also holds many clips, and marking more clips needs the video. If finishing one highlight deleted it, everything else from that game would break and the user would lose storage they paid for.

## Current state

`archive_project` (`src/backend/app/services/project_archive.py`) runs for every published project at each sign-in (`archive_completed_projects`, called from `session_init.py`). It:
1. msgpacks the project, its `working_clips` and its `working_videos` rows to R2 `archive/{project_id}.msgpack`;
2. runs `UPDATE projects SET working_video_id = NULL, archived_at = now`;
3. deletes the `working_clips` and `working_videos` rows.

It deletes no media. The working video file (`working_videos/*.mp4`, the framed clip that spotlight renders from) stays in R2. So does the game video (`games/{blake3}.mp4`).

`POST /api/downloads/{id}/restore-project` restores from msgpack whenever `archived_at` is set, then unpublishes.

## Target state

```
archive_project(p):   UPDATE projects SET archived_at = now WHERE id = p     -- nothing deleted, no msgpack
restore-project:      old_archive = archived_at set AND working_video_id IS NULL AND no working_clips rows
                      old_archive -> restore_project() from msgpack (unchanged path, C3)
                      else        -> just clear archived_at; working data is already there (C1)
                      then unpublish as today (T16530 changes the unpublish, not this task)
```

- **`archived_at` keeps its meaning of "finished, hidden from drafts".** The Projects list (`projects.py:448`), the game card counts (`games.py:2048`), clip stage (`clipStage.js`) and sync check all read it that way. It no longer means "working data removed". The knowledge doc will say so.
- **The working video is kept** (row and `working_video_id`). Spotlight redo renders from it. It is the framed clip, not a copy of the game video.
- **`cleanup_database_bloat`** already keeps only the latest working clip and working video per project. Archived projects now come under it, which is correct.
- **The expiry sweep** (`auto_export._export_brilliant_clip`) skips any clip that already has a published final video (`final_videos.published_at IS NOT NULL`). Whether the working rows are kept does not change that, so finished projects stay out of its scope.
- **Restore-if-newer:** the archive is a same-session local UPDATE through the request's own seam connection, synced by the middleware with CAS. No cross-user writer is added. The msgpack upload (an R2 write) goes away.

## Storage per project

| | Before | After |
|---|---|---|
| Account DB rows (crop + spotlight JSON) | 0 | a few KB (latest version only) |
| R2 msgpack backup | a few KB | none (old ones stay for C3) |
| R2 working video | unchanged (kept) | unchanged (kept) |
| R2 game video | its paid expiry | its paid expiry (option A) |

Net: no meaningful storage difference.

## The question for the owner (C2)

C2 says: "After archiving, the game video is no longer stored for that project."

- **A (recommended):** the archive does nothing to the game video. It is removed on its paid expiry by the existing sweep and its 14-day grace period. After that, Edit zoom says the game video is unavailable (your ruling 3 on T16530). No paid days are lost and nothing new can break. C2 is then proved by this: no new copy of the game video is kept for an archived project, and the existing expiry still removes it.
- **B:** when every clip of a game in this profile is finished and archived, end this profile's paid storage of that game early (release its storage ref). The existing gates then delete the video once nobody else holds it. The cost: paid days are forfeited, marking more clips from that game stops working, and it needs a confirmation in the app plus a refund-or-forfeit rule. That is a bigger task with UI.

## Tests (red then green)

- C1: archive a published project, then assert that the `working_clips` / `working_videos` rows and `working_video_id` remain, and that restore-project returns `restored: false` with no R2 read.
- C2 (option A): archive leaves the game storage ref and the R2 game object untouched; no new R2 upload.
- C3: an old-shape archive (rows deleted, msgpack present) still restores through `restore_project`.
- C4: an archived project's final video and its share link still resolve (existing share/gallery tests plus one assertion).

## Risks

- A reader that assumed "archived means no working data" would now see rows. A grep finds only the restore endpoint relying on that, and it is changed here.
- The account DB grows by a few KB per finished project. That is negligible next to the existing bloat cleanup.
