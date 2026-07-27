# T6150: Establish why staging carries dangling media refs — env-copy gap or export-durability bug?

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-07-27
**Found by:** a real user report — "Brilliant Control" would not play on staging (black player,
`MEDIA_ELEMENT_ERROR: Format error`, `0.0 / 0.0` duration)

## The question

Staging keeps producing rows whose media object does not exist. Two candidate causes, with very
different consequences:

1. **Env-copy gap** — `scripts/copy_user_between_envs.py` (or the wipe/re-seed flow) copies the
   profile SQLite and the R2 objects from snapshots taken at different moments, so DB rows arrive
   without their objects. Environmental; the fix is in the tooling.
2. **Export-durability bug** — an export records `final_videos.filename` and reports success while
   the object never durably lands. That is the **T4010 / T4110 "sync-then-announce"** class, it is a
   real product defect, and it would be prod-reachable.

**Do not assume (1).** Positively exclude (2), or confirm it. That distinction is the deliverable.

## Evidence already gathered (2026-07-27 — do NOT re-derive)

Staging, user `imankh@gmail.com` (`3ed03fb5-…`), profile `9fa7378c`:

- `final_videos` row 41 → project 31, `final_31_eda94512.mp4`, name *"Brilliant Control"*,
  `created_at = 2026-07-22 21:26:27`, **`published_at = NULL`** (a Reel Draft, never published).
- That object **404s**. 41 `final_videos` rows, exactly **1** dangling.
- **Every** final-video mp4 present was written **2026-07-27 between 18:46:15 and 18:46:54Z** — a
  39-second window. That is a bulk copy, not organic exports.
- Asymmetry: **47 mp4 objects vs 41 DB rows** → 6 objects with no row, 1 row with no object. The two
  halves of the copy were not atomic.
- Project 31 is ALSO one of the three drafts (31/33/51) whose **working_video** ref dangles.
- **Prod is clean**: 87 media rows across all profiles, **0 dangling** (audited with the correct
  `{APP_ENV}/users/…` key prefix — see the correction note in T6130).
- Staging schema is at head (profile_db v29, postgres 19), and the row reads back all 26 columns
  including the v024/v025 additions. **A migration cannot create a missing R2 object** — this is not
  a migration-window symptom.

## DECISIVE EVIDENCE added 2026-07-27 (after the user reported re-downloading from prod)

The user re-downloaded `imankh@gmail.com` and arshia's accounts **from prod to staging** shortly
before the report. Follow-up measurements change the picture substantially:

- **Prod does NOT contain this reel at all.** Prod `final_videos` for profile `9fa7378c` = **40
  rows**, and a query for `project_id=31 OR name LIKE '%Brilliant Control%'` returns **[]**.
- **Staging has 41 rows**, including `Brilliant Control` (created 2026-07-22, staging-native).
- Staging `PRAGMA user_version` = **29** (head) *after* the re-download.
- Staging's project 31 working video (`working_31_f874d743.mp4`) is **also 404**.

So the profile **DB half of the copy did not land** — staging's SQLite is still staging's own — while
the **R2 half did** (all 47 mp4s rewritten in a 39-second window). The DB therefore references a
reel that the newly-copied object store was never going to contain.

This matches the known hazard in memory `project_copy_to_live_env_clobber`: copying a profile DB
into a **LIVE** backend is rejected/reverted by the local-ahead guard unless the machine is
restarted first. **Cause (2) is now unlikely** — prod never had this object, so no export ever
failed to durably land it. Confirm that reasoning rather than inheriting it, but do not spend the
task hunting an export-durability bug that the row counts already argue against.

## What to determine

1. **Which cause?** Check `scripts/copy_user_between_envs.py`: does it copy `final_videos` /
   `working_videos` objects for ALL rows, or only a filtered subset (published only? by
   `published_at`? by age?). `published_at = NULL` on the one missing row is a strong hint worth
   testing directly — but confirm it against the script, do not reason from the coincidence.
2. **Exclude the durability path.** T6120 recorded an overlay export job for project 31 completing
   in ~16s. Establish whether the object ever existed on the SOURCE environment (dev). If it exists
   on dev and not on staging → copy gap. If it never existed anywhere while the DB says success →
   that is cause (2) and a **much** bigger deal: STOP and report before going further.
3. **Fix the cause you find.** If it is the copy script, make it either copy every referenced object
   or fail loudly listing what it could not copy — a silent partial copy is what produced a day of
   misdiagnosis (four E2E failures blamed on hydration, and a false "prod is affected" claim).
4. **Consider a verification step**: after a copy, assert every `final_videos`/`working_videos` row
   resolves to a present object, and report the diff. Cheap, and it converts this whole class from
   "discovered by a user" to "caught by the tool".

## Watch out for

- **Never target prod.** You have no prod credentials. Prod is clean; there is nothing to fix there.
- Do NOT "repair" staging data by deleting the dangling row or re-exporting — the user's reel is
  recoverable by re-export and that is their call. This task is about the CAUSE.
- T6130 (in review) makes a dangling ref degrade gracefully to the T5440 re-export prompt instead of
  a dead player. That is the symptom fix; this is the source fix. They are complementary — do not
  duplicate T6130's work.
- `scripts/copy_user_between_envs.py` is also documented in memory as the tool where "missing
  user_segments = account invisible in admin" — it has a history of partial copies. Check whether
  media is another instance of the same pattern rather than a one-off.
- The R2 key scheme is `{APP_ENV}/users/{user_id}/profiles/{profile_id}/…` (`storage.py:279`);
  `APP_ENV` is `production` on prod, `staging` on staging. Omitting that prefix makes every HEAD
  404 and produces a completely false audit — it did exactly that earlier today.

## Acceptance criteria

1. A stated verdict — env-copy gap or export-durability bug — with the evidence that discriminates
   between them (specifically: did the object ever exist on the source env?).
2. If copy gap: the script either copies everything referenced, or fails loudly with the unmet list.
3. If durability bug: named precisely and reported BEFORE any fix — it is prod-reachable and
   outranks this task.
4. A post-copy verification that reports dangling refs, or a written argument for why it is not worth
   the cost.
5. Whatever you change, a test proving a partial copy is now detected rather than silent.
