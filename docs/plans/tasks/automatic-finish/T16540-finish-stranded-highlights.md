# T16540: Finish the stranded highlights

## In plain words

A highlight is a finished short clip, and it can only be downloaded or shared once it is in the Highlights tab. On 2026-11-14, 38 parents had 42 highlights they had paid to sharpen that never got there: 31 were sharpened and went no further, and 11 had a spotlight rendered but Finish was never pressed. The automatic finish (T16520) only helps highlights made after it ships. We will finish the stranded ones too, so each of those parents finds their highlight in Highlights the next time they open the app, marked as new. Done when a copy of a stranded production account, opened on staging, shows its highlight in Highlights and it plays.

**Status:** STAGING
**Impact:** 7
**Complexity:** 4
**Created:** 2026-11-14
**Updated:** 2026-11-14
**Milestone:** Automatic finish (see [EPIC.md](EPIC.md)). Task 4 of 4.

## How we got here

The count comes from a read of every production account ([evidence](../../bi/finish-step-evidence-2026-11-14.md)). 33 of the 38 parents have nothing at all in Highlights, so for them the product has never delivered the thing they paid for. Some came back at least once and left within seconds.

## The problem

These highlights sit on Home as "In progress". Their owners believe they are either done or lost. New code that finishes highlights as they are sharpened will not touch them.

## What we will do

1. When one of these accounts is next opened, finish each stranded highlight using the same server path as T16520: the 11 with a rendered video are finished as they are, and the 31 without get their shareable video made first.
2. Show them in Highlights with the "new" mark.
3. Leave alone any highlight whose source video has expired or whose finish fails; it keeps today's state and the failure is logged with a count.
4. Report how many were finished and how many could not be.

## Why this and not something else

Emailing these parents to come back and tap Finish was considered. It asks them to complete a step that failed them once; the emails milestone can instead tell them the highlight is waiting, after this task has made that true. Finishing every account at once from a script was ruled out: accounts are only changed when they are next opened.

## How we will know it worked

- [ ] A stranded account copied to staging shows its highlight in Highlights on first load, and it plays and downloads.
- [ ] A stranded highlight with a rendered spotlight keeps its spotlight.
- [ ] An account whose source video has expired loads normally, and the skipped highlight is counted in the log.
- [ ] No credits are charged.
- [ ] Opening the account a second time changes nothing.

## For the implementer

### Relevant files
- `src/backend/app/migrations/profile_db/` - precedent: `v018_heal_lost_publish_proj41.py`, `v020_archive_published_auto_projects.py`.
- `src/backend/app/services/publish_final_video.py`, `src/backend/app/routers/export/overlay.py` - the finish path from T16520.
- `scripts/copy_user_between_envs.py` - bring a stranded account to staging for the check.

### Notes
- Knowledge docs: `export-pipeline.md`, `persistence-sync.md`, `backend-services.md`.
- Include the Migration agent. The 11 rendered highlights are a pure data change; the 31 need a render, which a migration must not block on. Settle in design whether those are queued as jobs at account load instead of done inside the migration.
- Depends on T16520. Must be idempotent.
- Target predicate: a `working_videos` row with no `final_videos` row, or a `final_videos` row with `published_at` NULL, for a non-archived project.
