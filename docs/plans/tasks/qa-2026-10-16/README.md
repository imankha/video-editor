# External QA intake, 2026-10-16

**Source:** a first-time-parent QA pass on staging (e2e@test.local, 1440x900 plus eight responsive
sizes, real touch at 390x844), run by an external agent. Report, running log and the evidence
screenshots: [docs/plans/ux/2026-10-16-external-qa/](../../ux/2026-10-16-external-qa/QA-REPORT.md).

**Verification (2026-10-16):** each finding was traced to code on staging (`origin/master`
83f230217) and compared against prod (`deploy/frontend/2026-10-05`, `deploy/backend/2026-10-05`).
Rule from the user: anything already on prod cannot block the release.

| QA id | Real? | On prod? | Task | Bucket |
|---|---|---|---|---|
| B01 sport picked in upload dialog not carried to tags | Yes | No (T12160 picker, Oct 8, is new) | T12810 | **Blocks deploy** |
| B05 "Highlight ready" View: "Couldn't open the preview" | Yes (backend race) | Yes | T12820 | Next build |
| B02 non-video file opens a blank /annotate | Yes | Yes | T12830 | Next build |
| C04 Spotlight on phones: sticky export band hides playback/timeline | Yes | Yes | T12840 | Next build |
| C05 no expiry date or Extend for games >14 days from expiry | Yes | Yes | T12850 | Next build (product call inside) |
| C06 clip card title click does not open; Clips/Finished naming | Needs repro (code says it should open) | Yes | T12860 | Next build |
| C02 opponent/date blank for "2026-10-10 Vs Rangers.mp4" | Needs repro (parser returns both on staging) | Prod never parses this format | T12870 | Next build |
| B03 reload on /annotate returns to Games | Yes, by design (no game id in URL) | Yes | T12880 | Next build |
| C01 landing promised position tagging / searchable library | Was real | Fixed | none | 7f96b5611, landing deploy succeeded 2026-10-16 18:42 UTC |
| (log only) edit lost on immediate navigation | Tester judged evidence insufficient | n/a | none | Watch for it in T9720 |

Ordering inside "Next build" is by user impact, then easier fix first on equal impact.
