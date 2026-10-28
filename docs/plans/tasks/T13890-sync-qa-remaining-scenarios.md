# T13890: Sync QA matrix: remaining scenarios S1, S3, S7, S8, S10, S11, plus the S9b 404 observation

**Status:** TODO
**Impact:** 7
**Complexity:** 5
**Tier:** M (e2e specs only, plus one seam tweak if needed; findings become their own tasks)
**Created:** 2026-10-28
**Updated:** 2026-10-28
**Milestone:** Release check bugs (bugs first), see PLAN.md
**Blocked by:**

## Why

T13820 shipped the suite, the `seed-published-highlight` seam and the helpers, and ran S2, S4, S5, S6, S9a and S12 on chromium + iphone-sync (4 findings filed: T13850-T13880). Six scenarios were not run because they need the real render, an export flow, or UI the suite does not drive yet. Pre-filed candidates still unconfirmed: Annotate copy while mounted (S1, S7), `selectedProject` copy (S11), rankings pool refresh (S10), export-fail ghost "In progress" (S8), duplicate version on re-finish (S3), and the 404 archive-missing half-change (S9b, argued from `downloads.py:2654`/`:2671`, never observed).

## Scope

Read first: `.claude/knowledge/persistence-sync.md` § "Sync trace + sync QA suite", `docs/plans/tasks/T13820-sync-qa-playwright-matrix.md` (scenario table, filing protocol), `docs/plans/tasks/T13820-design.md`, `.claude/knowledge/annotate.md`, `.claude/knowledge/export-pipeline.md`.

| # | Scenario | Needs |
|---|---|---|
| S1 | Make highlight (Portrait) -> Frame -> Finish through the real local-FFmpeg render, once per device | Drive Annotate "Make highlight", Framing export, Finish; long wait; may need a small real game fixture |
| S3 | S2 then Finish again: exactly one published version, badge +1, no duplicate tile | Re-finish from the restored draft (needs a working video, so build on S1's state, not the seed) |
| S7 | Export in flight with Annotate kept mounted: card "In progress" -> final stage without reload; Clips stage; badge unchanged | A real or stubbed in-flight export; `exportStore.activeExports` holder |
| S8 | Export fails (`sync-fault` or killed render): no ghost "In progress", Clips stage reverts | `failExport` path |
| S10 | Finish, then open Rankings/Confidence banner: pool size reflects the new highlight (own layer) or excludes it (Team layer, T11160) | Drive the banner; `refreshKey` only bumps on re-rank/move |
| S11 | Project open in Framing, publish/delete from another reachable surface, then read header + mode-switch dialog (`selectedProject` vs `projectsStore.projects`, `projectsStore.js:27`) | Find a reachable second surface; if none exists, record that as the evidence |
| S9b | 404 archive-missing restore (`seed-published-highlight {archive_missing:true}`): confirm `published_at` is nulled although the response is 404 | Un-fixme the T13870 spec once; if it fails as predicted, add the observation to T13870 |

Run each on `chromium` and `iphone-sync`. Same step contract (`syncStep`: trace wait, UI assertions, `__syncCheck`, server probe, evidence under `qa/sync/<scenario>/<device>/<step>/`), same filing protocol as T13820: a mismatch is a finding (reproduce once, classify (a)-(f), file `T13xxx` at the top of the bugs section, keep the spec as `test.fixme('<T-id>')` with the assertion intact).

## Notes from T13820 (do not rediscover)

- Run with `--workers=1` (one shared e2e account; each spec isolates in a fresh profile). Restart vite after editing `src/` (its watcher misses edits here).
- Helpers in `e2e/helpers/syncCheck.js`; guidance shade re-arms on every full load (`gotoHome`); restore navigates into the editor (`openTab` leaves via `editor-home`).
- Seeded games/projects have no working video, so the editor shows "Loading..." forever; S1/S3 must go through real Annotate -> Framing, not the seam.
- Non-goals: fixing findings (file them); staging/prod runs.

## Acceptance Criteria

- [ ] S1, S3, S7, S8, S10, S11 each run on chromium and iphone-sync, or a documented reason (with evidence) why a scenario cannot be driven
- [ ] Every step asserts UI text AND `__syncCheck` AND the server probe, before and after reload
- [ ] Each mismatch filed as its own task with attribution row, screenshots and `[STATE]` line; spec is `test.fixme('<T-id>')`
- [ ] S9b observed (confirmed or cleared) and T13870 updated accordingly
- [ ] Summary table appended to T13820's Progress Log or this file; command, exit code and HEAD recorded in `qa/proof.json`
