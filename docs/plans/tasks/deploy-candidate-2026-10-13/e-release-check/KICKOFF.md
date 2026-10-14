# Epic E kickoff: Release check (Deploy Candidate)

Prepared 2026-10-13. Not launched. Start with `/dotask T12590 T9720 T9730 T10320` (add `--capture` only if you want captured review/proof on the PR; this group changes mostly docs).

Read [EPIC.md](EPIC.md) first. Epic E gates the deploy and the all-user email. Run it only after Epics A to D are merged and on staging (they are, as of PR #601, 2026-10-13).

## Order and what each task must produce

| # | Task | Output | Needs the user? |
|---|------|--------|-----------------|
| 1 | [T12590](../../T12590-guide-coverage-and-responsive-sweep.md) | Re-run the staging walk at 1440x900, 1024x768, 768x1024, 390x844 plus the 320/360/375/390/768 overflow sweep. Update `docs/plans/ux/2026-10-11-guide-coverage-sweep/RESULTS.md` with the three open acceptance rows: screenshots for every screen and state, dialog-placement verdict per guided screen, parent-audit CRITICAL/HIGH findings proven fixed. Every failure becomes a filed fix task. | Staging login; reset the test account first (`scripts/reset-test-user.py`, confirm scope with the user) |
| 2 | [T9720](../../T9720-end-to-end-and-failure-path-release-check.md) | Full parent path on staging at desktop and mobile: upload, two plays, framed clip, effects, private save, reopen, authorized test publication. Also a direct clip with no game, a multi-clip reel, and slow network, interrupted upload, failed render, navigation during load, duplicate clicks, mid-flow reload. Credit use matches T9680. Record the staging-gate-lane decision. | Staging machine scaled to 4x/4096 first; fixture `wcfc-carlsbad-trimmed.mp4` |
| 3 | [T9730](../../T9730-product-review-and-traceability-signoff.md) | Mark every B1-B11, UX-01..UX-18 and this milestone's items exactly one of: fixed (with evidence), verified not reproducible, overridden (name the deciding task), or remaining limitation. Reconcile the 47 naming groups via T9570's table. | Sign-off is the user's judgment; draft it, then stop |
| 4 | [T10320](../../T10320-reshoot-tutorial-videos-v3.md) | Talk tracks re-baked against `displayNames.js` (zero retired nouns), UI-drift table, TTS, capture spec, `verify_assets.py` pass, landing launcher drift fixes. Four videos re-uploaded. | Recording and upload happen outside this repo (`C:\Users\imank\Videos\Captures\ReelBallersTutroials`); the worker prepares scripts and specs, then stops |

## Rules for the worker

- Bugs found here are FIXES for this build only if they block A/B behavior. File each as its own task (task-management skill) and list it in the task's results; do not fix inside these tasks.
- One task per conversation; read `/workspace/.dotask-notes.md` first and append a section after each commit.
- Verification evidence (screenshots, logs) goes under `docs/plans/ux/` or the task folder, not in chat.
- Do not mark anything DONE. Set `WAITING ON USER` the moment a task needs staging access, a sign-off, or recording.
- Commit subjects start with the task id (`T12590: ...`).

## Exit

All four rows complete or WAITING ON USER with exact steps. Then the deploy (`/deploy`) and the send gate in PLAN.md ("After the deploy") apply.
