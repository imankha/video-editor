# T4620: Same clip version everywhere

**Status:** TODO
**Impact:** 4
**Complexity:** 1
**Created:** 2026-07-03
**Updated:** 2026-11-13

## In plain words

A clip can have several saved versions. When two of them carry the same version number, the project list and the editor break the tie differently and can describe different versions of the same clip. It is rare, but the code's own notes say such ties exist. Use one rule in both places and add a test with a tie. Worked when the list and the editor agree on a tied clip.

## Implementer details

- `src/backend/app/routers/projects.py` hand-writes the latest-working-clip query ordered by `wc.version DESC, wc.id DESC`; the shared `latest_working_clips_subquery` in `src/backend/app/queries.py` orders by `version DESC` only, so it picks an arbitrary row on a tie. The editor reads through the shared one (`clips.py`).
- Add `, id DESC` to the shared query, switch `projects.py` to it, add one tied-version test. About ten lines.
- The 'not found' wording and enum parts of the old scope are done or cosmetic and are not part of this task.

## Acceptance Criteria

- [ ] With two rows sharing project, identity and version, the project list and the clip endpoint return the same row (the higher id).
- [ ] `projects.py` no longer contains its own copy of the query.
